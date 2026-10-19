/**
 * Учебный «CDN-прокси» на Cloudflare Workers (вариант B, без своего домена).
 *
 * Что умеет (номера лабораторных — из методички):
 *  - проксирует запросы на Origin (GitHub Pages) и кэширует статику на Edge  → ЛР 2.1, 2.2
 *  - заголовок X-Cache: HIT / MISS / BYPASS / DYNAMIC                        → ЛР 2.2, 3.2
 *  - служебный маршрут /__purge (точечная и полная инвалидация)              → ЛР 2.2
 *  - WAF-правила: 403 на /admin, сканеры по User-Agent, path traversal       → ЛР 3.1, 3.4
 *  - rate limiting (глобальный и на /login) → 429                            → ЛР 3.1, 3.4
 *  - режим «Under Attack» (JS-challenge, 503 для curl)                       → ЛР 3.1
 *  - security-заголовки на всех ответах                                      → ЛР 3.4
 *  - «медленное» динамическое API /api/time (задержка 1 c)                   → ЛР 3.3
 *  - console.log каждого запроса → вкладка Logs в дашборде                   → ЛР 3.2
 *
 * Деплой: дашборд Cloudflare → Workers & Pages → Create → Hello World →
 *         заменить код на этот файл → Save and Deploy.
 */

const CONFIG = {
  ORIGIN: 'https://rollibow.github.io', // ваш Origin из ЛР 2.1 (шаг 1)
  CACHE_TTL: 3600,          // ЛР 2.2: TTL кэша Edge для статики, секунд
  CLIENT_CACHE: 'no-cache',// браузер каждый раз спрашивает Edge — так виден HIT/MISS
  RATE: { windowSec: 10, max: 30 },        // общий rate limit: 30 запр/10 c с IP
  LOGIN_RATE: { windowSec: 60, max: 5 },   // ЛР 3.4: «брутфорс логина»: 5 запр/мин
  UNDER_ATTACK: false,      // ЛР 3.1: true → JS-challenge для всех без cookie
  CHALLENGE_COOKIE: 'cdnc_challenge',
  CHALLENGE_PASSAGE_MIN: 30,
  BLOCKED_UA: /sqlmap|nmap|metasploit|burpsuite|nikto|masscan/i,
  BLOCKED_PATH: /(\.\.\/|\.\.\\|%2e%2e|%252e|\/etc\/passwd|\/wp-admin)/i,
  SLOW_API_MS: 1000,        // ЛР 3.3: имитация медленной обработки на «бэкенде»
};

const cache = caches.default;
const rateMap = new Map();   // IP+правило → {start, n} (хранится в isolate; для демо достаточно)
const cachedKeys = new Set();// реестр ключей кэша для «Purge Everything»

const SECURITY_HEADERS = {
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

/* ---------- вспомогательные функции ---------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sec(resp) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) resp.headers.set(k, v);
  return resp;
}

function withCache(resp, status) {
  resp.headers.set('X-Cache', status);
  return resp;
}

// сквозные заголовки Origin'а (GitHub Pages), чтобы не путали студентов
function stripOriginHeaders(resp) {
  resp.headers.delete('x-cache-hits');
  resp.headers.delete('x-served-by');
  resp.headers.delete('x-timer');
  resp.headers.delete('x-origin-cache');
  return resp;
}

function htmlPage(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function blockPage(msg, status = 403) {
  return sec(htmlPage(
    `<h1>${status}</h1><p>Учебный WAF (Cloudflare Workers): запрос заблокирован.</p><p>Причина: ${msg}</p>`,
    status,
  ));
}

function rateLimited() {
  const r = sec(htmlPage('<h1>429</h1><p>Слишком много запросов (учебный rate limit).</p>', 429));
  r.headers.set('Retry-After', '30');
  return r;
}

function hasCookie(request, name) {
  const c = request.headers.get('Cookie') || '';
  return c.split(';').some((p) => p.trim().startsWith(name + '='));
}

function safeDecode(p) {
  try { return decodeURIComponent(p); } catch (e) { return p; }
}

function challengePage() {
  // Браузер выполнит JS, получит cookie и пройдёт; curl без JS/cookie останется на 503.
  return sec(htmlPage(
    `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Проверка браузера</title>
<script>document.cookie='${CONFIG.CHALLENGE_COOKIE}=1;max-age=${CONFIG.CHALLENGE_PASSAGE_MIN * 60};path=/';location.reload();</script>
</head><body><h1>503 — проверка браузера…</h1>
<p>Учебный аналог режима «I'm Under Attack Mode»: страница сама ставит cookie и перезагружается.</p>
</body></html>`,
    503,
  ));
}

function hitLimit(ip, rule, tag) {
  const now = Date.now();
  const key = ip + '|' + tag;
  const e = rateMap.get(key);
  if (!e || now - e.start > rule.windowSec * 1000) {
    rateMap.set(key, { start: now, n: 1 });
    return false;
  }
  e.n += 1;
  return e.n > rule.max;
}

/* ---------- служебные маршруты ---------- */

async function handlePurge(url) {
  const target = url.searchParams.get('url');
  if (target) {
    const ok = await cache.delete(new Request(target, { method: 'GET' }));
    cachedKeys.delete(target);
    return sec(new Response(JSON.stringify({ purged: target, deleted: ok }), {
      headers: { 'Content-Type': 'application/json' },
    }));
  }
  let n = 0;
  for (const k of cachedKeys) {
    if (await cache.delete(new Request(k, { method: 'GET' }))) n++;
  }
  cachedKeys.clear();
  return sec(new Response(JSON.stringify({ purged_all: n, note: 'кэш Edge очищен' }), {
    headers: { 'Content-Type': 'application/json' },
  }));
}

async function slowApi(url) {
  // ЛР 3.3: динамический ответ с задержкой. ?ttl=N — закэшировать на N секунд на Edge.
  const ttl = parseInt(url.searchParams.get('ttl') || '0', 10);
  const keyUrl = url.toString();
  if (ttl > 0) {
    const c = await cache.match(new Request(keyUrl, { method: 'GET' }));
    if (c) {
      const r = new Response(c.body, c); // копия: у кэша immutable-заголовки
      r.headers.set('Cache-Control', CONFIG.CLIENT_CACHE);
      return withCache(sec(r), 'HIT');
    }
  }
  const t0 = Date.now();
  await sleep(CONFIG.SLOW_API_MS); // «обработка» на бэкенде
  const body = {
    current_time: new Date().toISOString(),
    processed_ms: Date.now() - t0,
    note: 'динамический ответ с задержкой 1 c (ЛР 3.3)',
  };
  const resp = new Response(JSON.stringify(body, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
  if (ttl > 0) {
    resp.headers.set('Cache-Control', 'public, max-age=' + ttl);
    await cache.put(new Request(keyUrl, { method: 'GET' }), resp.clone());
    cachedKeys.add(keyUrl);
    return withCache(sec(resp), 'MISS');
  }
  return withCache(sec(resp), 'DYNAMIC');
}

function loginPage() {
  return sec(htmlPage(
    `<h1>Вход</h1><p>Демо-страница для правила rate limiting (ЛР 3.4): 5 запросов в минуту с IP.</p>
<form><input name="login" placeholder="логин"><input name="password" type="password" placeholder="пароль"><button>Войти</button></form>`,
  ));
}

/* ---------- прокси с кэшированием ---------- */

async function proxyCache(request, url) {
  const target = CONFIG.ORIGIN + url.pathname + (url.pathname === '/' ? '' : '') + url.search;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const up = await fetch(target, { method: request.method, headers: request.headers, body: request.body });
    return withCache(sec(new Response(up.body, up)), 'BYPASS');
  }
  const key = new Request(url.toString(), { method: 'GET' });
  const cached = await cache.match(key);
  if (cached) {
    // у ответов из кэша заголовки immutable — сначала делаем копию
    const r = new Response(cached.body, cached);
    withCache(r, 'HIT');
    r.headers.set('Cache-Control', CONFIG.CLIENT_CACHE);
    return sec(r);
  }
  const up = await fetch(target, {
    headers: {
      Accept: request.headers.get('Accept') || '*/*',
      'User-Agent': request.headers.get('User-Agent') || 'edu-cdn-worker',
    },
  });
  const resp = stripOriginHeaders(new Response(up.body, up));
  const cacheable = up.status === 200 && !url.pathname.startsWith('/api/');
  if (cacheable) {
    resp.headers.set('Cache-Control', 'public, max-age=' + CONFIG.CACHE_TTL);
    await cache.put(key, resp.clone());
    cachedKeys.add(url.toString());
    withCache(resp, 'MISS');
  } else {
    withCache(resp, 'BYPASS');
  }
  resp.headers.set('Cache-Control', CONFIG.CLIENT_CACHE);
  return sec(resp);
}

/* ---------- главный обработчик ---------- */

async function handle(request) {
    const url = new URL(request.url);
    // защита от двойного слэша: адрес с хвостовым "/" + "/file" давали "//file"
    const clean = url.pathname.replace(/\/{2,}/g, '/');
    if (clean !== url.pathname) url.pathname = clean;
    const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
    const country = (request.cf && request.cf.country) || '--';
    let resp;

    if (url.pathname === '/__purge') {
      resp = await handlePurge(url);                       // ЛР 2.2: инвалидация
    } else if (CONFIG.BLOCKED_PATH.test(safeDecode(url.pathname))) {
      resp = blockPage('path traversal / запрещённый путь'); // ЛР 3.1/3.4
    } else if (CONFIG.BLOCKED_UA.test(request.headers.get('User-Agent') || '')) {
      resp = blockPage('User-Agent сканера уязвимостей');     // ЛР 3.1/3.4
    } else if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      resp = blockPage('путь /admin закрыт правилом WAF');    // ЛР 3.1/3.4
    } else if (CONFIG.UNDER_ATTACK && !hasCookie(request, CONFIG.CHALLENGE_COOKIE)) {
      resp = challengePage();                                 // ЛР 3.1
    } else if (url.pathname === '/login' && hitLimit(ip, CONFIG.LOGIN_RATE, 'login')) {
      resp = rateLimited();                                   // ЛР 3.4
    } else if (url.pathname !== '/login' && hitLimit(ip, CONFIG.RATE, 'global')) {
      resp = rateLimited();                                   // ЛР 3.4
    } else if (url.pathname === '/api/time') {
      resp = await slowApi(url);                              // ЛР 3.3
    } else if (url.pathname === '/login') {
      resp = loginPage();
    } else {
      resp = await proxyCache(request, url);                  // ЛР 2.1/2.2: кэш Edge
    }

    console.log(JSON.stringify({
      ip, country,
      method: request.method,
      path: url.pathname + url.search,
      ua: (request.headers.get('User-Agent') || '').slice(0, 48),
      status: resp.status,
      cache: resp.headers.get('X-Cache') || '-',
    }));
    return resp;
}

export default {
  async fetch(request) {
    try {
      return await handle(request);
    } catch (e) {
      // вместо Error 1101 — читаемая страница с текстом исключения
      const msg = (e && e.message) || String(e);
      console.error('worker error: ' + msg);
      return new Response(
        '<h1>500</h1><p>Ошибка воркера (подробности в Logs): ' + msg + '</p>',
        { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      );
    }
  },
};
