# Лабораторные 2.1–3.4 на Cloudflare Workers (вариант B, без своего домена)

Вместо зоны с доменом и NS-делегированием используется **Worker** — код, который
выполняется на Edge-серверах Cloudflare и получает бесплатный публичный адрес
`https://<имя>.workers.dev`. Это та же сеть Cloudflare (те же `server: cloudflare`,
`cf-ray`, тот же кэш Edge), поэтому все темы лабораторных выполняются честно,
а требование методички «используем бесплатный функционал Cloudflare» соблюдено.

**Обозначение:** во всех командах уже подставлен полный адрес вашего воркера
`https://rollibow-cdn.anivan2003.workers.dev` — копируйте команды как есть.
**Важно:** адрес пишется БЕЗ слэша на конце; если дописать `/` и добавить `/style.css`,
получится двойной слэш `//style.css`, Origin вернёт 404 и вы увидите `x-cache: BYPASS`
(начиная с версии воркера от 19.10.2026 двойные слэши нормализуются автоматически).
Origin — `https://rollibow.github.io`.

## Терминал и Windows (прочитать один раз)

Все команды методички выполняются в **терминале операционной системы**, а НЕ в
консоли браузера: F12 → Console исполняет JavaScript, и команда `curl …` там
даст `SyntaxError: Unexpected identifier`.

- **Linux / macOS:** обычное приложение Terminal.
- **Windows, вариант 1 (рекомендуется):** Git Bash — все команды работают дословно, включая `grep`.
- **Windows, вариант 2:** `cmd` (`Win+R` → `cmd`): заменяйте `grep -iE 'a|b'` на `findstr /i "a b"`, например
  `curl -sI https://rollibow-cdn.anivan2003.workers.dev/ | findstr /i "server cf-ray x-cache"`.
- **Windows, вариант 3:** PowerShell: пишите `curl.exe` (голое `curl` — псевдоним Invoke-WebRequest) и
  `Select-String`: `curl.exe -sI https://rollibow-cdn.anivan2003.workers.dev/ | Select-String 'server|cf-ray|x-cache'`.
- **Без терминала:** F12 → Network → клик по запросу → Response Headers: заголовки
  `server`, `cf-ray`, `x-cache` видны там (хватит для скриншотов отчёта).
  Служебные маршруты воркера вызываются просто открытием URL в браузере,
  например `https://rollibow-cdn.anivan2003.workers.dev/__purge`.

**Соответствие оригинальных шагов и варианта B:**

| Было в методичке (зона + домен) | Стало в варианте B |
|---|---|
| Add a Site + смена NS у регистратора | Create Worker + Deploy (шаг 0) |
| `cf-cache-status: HIT/MISS` | заголовок `X-Cache: HIT/MISS` |
| Caching → Purge Everything / Custom Purge | маршрут `/__purge` и `/__purge?url=…` |
| Security → WAF → Firewall rules | правила в `worker/worker.js` (блок WAF) |
| Security → Events | вкладка **Logs** воркера (console.log каждого запроса) |
| Analytics → Traffic | вкладка **Metrics/Analytics** воркера |
| «I'm Under Attack Mode» | `CONFIG.UNDER_ATTACK = true` |
| Rate limiting rules | `CONFIG.RATE` / `CONFIG.LOGIN_RATE` |
| Transform Rules → security-заголовки | `SECURITY_HEADERS` в коде |
| SSL/TLS, Always HTTPS | workers.dev отдаёт только HTTPS + заголовок HSTS |

---

## Шаг 0 (общий для всех лабораторных): деплой воркера

1. Убедитесь, что Origin работает: откройте `https://rollibow.github.io` — сайт открылся.
2. Дашборд Cloudflare → **Workers & Pages** → **Create** → вкладка **Workers**
   (шаблон «Hello World») → имя, например `rollibow-cdn` → **Deploy**.
3. Откройте воркер → **Edit code** (Quick edit): удалите шаблонный код,
   вставьте целиком содержимое файла `worker/worker.js` → **Save and Deploy**.
   > В начале файла проверьте `CONFIG.ORIGIN` — там должен быть ваш логин GitHub.
4. Скопируйте публичный адрес: кнопка **Visit** / вкладка **Settings → Triggers & Domains**
   (вида `https://rollibow-cdn.<ваш-аккаунт>.workers.dev`). Это и есть `https://rollibow-cdn.anivan2003.workers.dev`.
5. Быстрая проверка в терминале (терминал ОС, см. раздел «Терминал и Windows»;
   не консоль F12):
   ```bash
   curl -sI https://rollibow-cdn.anivan2003.workers.dev/ | grep -iE 'server|cf-ray|x-cache'
   curl -sI https://rollibow-cdn.anivan2003.workers.dev/ | grep -i x-cache     # второй запрос
   ```
   Ожидание: `server: cloudflare`, есть `cf-ray`, первый запрос `x-cache: MISS`,
   второй — `x-cache: HIT`.
6. Проверка «как в методичке»: F12 → Сеть → перезагрузить `https://rollibow-cdn.anivan2003.workers.dev/` → у запроса
   столбца или вкладки Headers смотрите **Remote Address** — это IP Cloudflare,
   а не IP GitHub Pages (`185.199.111.153`).

Дальше шаг 0 не повторяем — он считается выполненным.

---

## ЛР 2.1 — Настройка CDN для статического сайта

**Цель (адаптированная):** трафик к сайту идёт через Edge-сервера Cloudflare;
доказано заголовками и Remote Address.

1. **Origin** уже готов (репозиторий `rollibow.github.io`, 17 страниц) — шаг 1 методички.
2. **Подключение к CDN** — шаг 0 выше (заменяет «Add a Site» и создание A-записи).
3. **Шаг «смена NS» пропускается осознанно:** домен `workers.dev` принадлежит самому
   Cloudflare и уже делегирован его серверам — доказательством владения здесь
   является ваш аккаунт, а не NS-записи. Запишите это в отчёт как отличие варианта.
4. **Проверка работоспособности (шаг 4 методички):**
   ```bash
   # заголовки Origin напрямую — CDN не видно:
   curl -sI https://rollibow.github.io/style.css | grep -iE 'server|cache'
   #   → server: GitHub.com, x-cache отсутствует
   # те же файлы через CDN:
   curl -sI https://rollibow-cdn.anivan2003.workers.dev/style.css | grep -iE 'server|cf-ray|x-cache'
   #   → server: cloudflare, cf-ray: …, x-cache: HIT|MISS
   ```
   И в браузере: F12 → Сеть → Remote Address = IP Cloudflare.
5. Откройте 2–3 страницы через `https://rollibow-cdn.anivan2003.workers.dev` — сайт полностью работает через Edge.

**В отчёт:** скриншоты пары «заголовки Origin vs заголовки CDN», Remote Address
из DevTools, адрес воркера и скриншот Deploy в дашборде.

---

## ЛР 2.2 — Кэширование и инвалидация

**Цель:** увидеть HIT/MISS, «протухший» кэш, TTL и ручную очистку.

1. **Прогрев кэша:**
   ```bash
   curl -sI https://rollibow-cdn.anivan2003.workers.dev/style.css | grep -i x-cache   # MISS (первый раз)
   curl -sI https://rollibow-cdn.anivan2003.workers.dev/style.css | grep -i x-cache   # HIT
   ```
   Скриншот заголовков со статусом HIT — обязательный пункт отчёта.
2. **Изменение файла на Origin:** GitHub → ваш репозиторий → `style.css` → Edit:
   найдите строку `--bg: #ffffff;` и замените на `--bg: lightcoral;` → Commit.
3. **Наблюдаем работу кэша:** обновите `https://rollibow-cdn.anivan2003.workers.dev/` в браузере (Ctrl+F5 не нужен:
   воркер шлёт браузеру `Cache-Control: no-cache`, так что решает именно Edge-кэш).
   Фон **остался белым**, `x-cache: HIT` — Cloudflare отдаёт старую версию,
   не зная об изменениях. Скриншот «старого» вида.
4. **Purge Everything (не ждём TTL):**
   ```bash
   curl -s "https://rollibow-cdn.anivan2003.workers.dev/__purge"
   # → {"purged_all": N, "note": "кэш Edge очищен"}
   ```
   Обновите сайт — фон **сразу стал lightcoral**, первый ответ `x-cache: MISS`,
   следующий HIT. Скриншот «нового» вида.
5. **Custom Purge (точечный, «для продвинутых»):** измените на Origin цвет ещё раз
   (`lightblue`, commit), затем очистите только один файл:
   ```bash
   curl -s "https://rollibow-cdn.anivan2003.workers.dev/__purge?url=https://rollibow-cdn.anivan2003.workers.dev/style.css"
   ```
   Обновление страницы покажет lightblue, хотя остальной кэш не тронут.
6. **Истечение TTL без ручной очистки:** в коде воркера поставьте
   `CACHE_TTL: 60` → Save and Deploy → сделайте `/__purge` → убедитесь, что версия
   свежая → измените цвет на Origin ещё раз (`lightgreen`) → обновите сразу
   (увидите старую, HIT) → **подождите 70 секунд** → обновите: новая версия пришла
   сама, без purge (аналог `EXPIRED`). Верните `CACHE_TTL: 3600`.

> Нюанс: реестр ключей для «purge everything» живёт в памяти isolate воркера.
> Если `/__purge` вернул `purged_all: 0`, а кэш всё равно старый — повторите запрос
> страницы и purge ещё раз (изолят мог смениться). Точечный `?url=` работает всегда.

**В отчёт:** заголовки с HIT; скриншоты до/после инвалидации; значения TTL;
выводы — зачем нужен TTL, когда полезна ручная инвалидация, какой метод
очистки предпочтительнее (точечный: не сбрасывает весь кэш).

---

## ЛР 3.1 — Защита от DDoS и WAF

**Цель:** активировать и протестировать правила фильтрации и защиту от ботов.

1. Правила уже встроены в `worker.js` (аналог Managed Ruleset + кастомных правил):
   - `403` на путь `/admin` и `/admin/…`;
   - `403` на User-Agent сканеров (`sqlmap|nmap|metasploit|burpsuite|nikto|masscan`);
   - `403` на path traversal (`../`, `%2e%2e`, `/etc/passwd`, `/wp-admin`);
   - режим JS-challenge (`UNDER_ATTACK`);
   - rate limiting (см. ЛР 3.4).
2. **Тесты кастомных правил:**
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "https://rollibow-cdn.anivan2003.workers.dev/admin"              # 403
   curl -s -o /dev/null -w '%{http_code}\n' -A "sqlmap/1.7" "https://rollibow-cdn.anivan2003.workers.dev/"    # 403
   curl -s -o /dev/null -w '%{http_code}\n' --path-as-is "https://rollibow-cdn.anivan2003.workers.dev/../../etc/passwd"  # 403
   curl -s -o /dev/null -w '%{http_code}\n' "https://rollibow-cdn.anivan2003.workers.dev/"                    # 200
   ```
3. **Сценарий «бот-трафик» (I'm Under Attack):** в коде воркера
   `UNDER_ATTACK: true` → Save and Deploy.
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "https://rollibow-cdn.anivan2003.workers.dev/"   # 503 — challenge без JS/cookie
   ```
   Откройте `https://rollibow-cdn.anivan2003.workers.dev/` в браузере: мелькнёт страница «проверка браузера», JS поставит
   cookie на 30 минут (Challenge Passage) — и сайт откроется (200).
   Верните `UNDER_ATTACK: false` → Deploy.
4. **Логи безопасности (аналог Security → Events):** дашборд → воркер → вкладка
   **Logs**: видны записи каждого запроса, включая заблокированные (`status: 403`,
   `status: 503`) с IP, страной и User-Agent. Скриншот ленты с вашими 403.

**В отчёт:** таблицу тестов «запрос → код ответа», скриншот 403-страницы воркера,
скриншот 503-challenge и ленты Logs, вывод о многоуровневости защиты.

---

## ЛР 3.2 — Анализ трафика и производительности

**Цель:** сгенерировать нагрузку и проанализировать её на Edge.

1. **Генерация трафика.** Вариант А (проще):
   ```bash
   chmod +x scripts/worker-cache-test.sh
   ./scripts/worker-cache-test.sh https://rollibow-cdn.anivan2003.workers.dev 3     # 3 круга × 18 URL ≈ 54 запроса/круг
   ```
   Вариант Б (как в методичке, k6):
   ```bash
   k6 run -e CDN_URL=https://rollibow-cdn.anivan2003.workers.dev scripts/k6-test.js  # 4 минуты, до 10 виртуальных пользователей
   ```
2. **Графики в реальном времени:** дашборд → воркер → **Metrics/Analytics**:
   во время теста виден всплеск запросов. Скриншот графика.
3. **Сырые логи:** вкладка **Logs** во время теста — поток записей
   `{ip, country, method, path, ua, status, cache}`. Это аналог «Cloudflare Logs»
   из методички: по полям видно, какие файлы запрашивают чаще (`path`),
   откуда идут запросы (`country`), были ли ошибки (`status`).
4. **Cache Hit Ratio:** скрипт из варианта А печатает итог, например
   `Cache Hit Ratio: 88.9% (из 108 кэшируемых запросов)`.
   Сравните круг 1 (много MISS — прогрев) и круги 2–3 (почти все HIT) —
   это и есть наблюдение «Cached vs Uncached» из методички.
5. **Мини-анализ для отчёта:** выпишите из логов топ-3 пути по частоте,
   долю HIT, страну клиента; объясните, почему `style.css` и `image.jpg`
   дают максимум HIT (одни и те же URL запрашивают все страницы).

**В отчёт:** график Metrics, вывод скрипта с Hit Ratio, фрагмент логов, выводы.

---

## ЛР 3.3 — Динамическое ускорение и оптимизация

**Цель:** понять, что CDN ускоряет не вычисления, а доставку.

1. **«Медленный бэкенд»** уже встроен в воркер: маршрут `/api/time` «обрабатывает»
   запрос 1 секунду (`CONFIG.SLOW_API_MS`) — аналог Flask-примера методички,
   только без отдельного хостинга.
2. **Замер «динамического» ответа (аналог замера TTFB в методичке):**
   ```bash
   curl -o /dev/null -s -w "connect: %{time_connect}\nTTFB: %{time_starttransfer}\ntotal: %{time_total}\n" "https://rollibow-cdn.anivan2003.workers.dev/api/time"
   ```
   TTFB ≈ 1.0–1.3 c. **Вывод методички подтверждается:** Edge не ускоряет обработку
   на «сервере» — задержка никуда не делась (`X-Cache: DYNAMIC`).
3. **Ускорение коротким TTL на Edge** (то, что CDN всё же может сделать
   с «условно-динамическим» контентом):
   ```bash
   time curl -s "https://rollibow-cdn.anivan2003.workers.dev/api/time?ttl=10" > /dev/null   # ~1 c, X-Cache: MISS
   time curl -s "https://rollibow-cdn.anivan2003.workers.dev/api/time?ttl=10" > /dev/null   # ~0.05 c, X-Cache: HIT
   # через 10 секунд снова ~1 c — кэш истёк
   ```
   Оформите таблицей из 3–4 замеров.
4. **Статика: MISS против HIT:**
   ```bash
   curl -s "https://rollibow-cdn.anivan2003.workers.dev/__purge?url=https://rollibow-cdn.anivan2003.workers.dev/image.jpg" > /dev/null
   curl -o /dev/null -s -w 'MISS: %{time_total}\n' "https://rollibow-cdn.anivan2003.workers.dev/image.jpg"
   curl -o /dev/null -s -w 'HIT:  %{time_total}\n' "https://rollibow-cdn.anivan2003.workers.dev/image.jpg"
   ```
5. **Протокольные оптимизации (аналог Speed → Optimization):**
   ```bash
   curl -sI -H 'Accept-Encoding: br' "https://rollibow-cdn.anivan2003.workers.dev/style.css" | grep -i content-encoding  # br (Brotli)
   curl -sI "https://rollibow-cdn.anivan2003.workers.dev/" | grep -i strict-transport   # HSTS: только HTTPS
   ```
   В браузере: F12 → Сеть → колонка Protocol у запросов к `https://rollibow-cdn.anivan2003.workers.dev` — `h3`/`h2`
   (HTTP/3 с QUIC включён на Edge по умолчанию).
6. **Вывод:** динамический контент ускоряется не кэшированием вычислений,
   а (а) коротким TTL там, где это допустимо, (б) современными протоколами,
   сжатием и близостью Edge к клиенту.

**В отчёт:** таблицы замеров TTFB/total (DYNAMIC, HIT, MISS, ttl=10),
скриншот protocol h3, выводы.

---

## ЛР 3.4 — Комплексная защита веб-приложения

**Цель:** многоуровневая безопасность; всё ниже уже реализовано в `worker.js`,
ваша задача — проверить, задокументировать и показать срабатывания.

**Чек-лист включённых мер (соответствие частям методички):**

| Мера | Где в коде | Часть методички |
|---|---|---|
| HTTPS + HSTS (`max-age=31536000`) | workers.dev + `SECURITY_HEADERS` | 1.2 |
| WAF: block `/admin`, traversal, UA-сканеры | блок WAF в обработчике | 2 |
| Rate limiting: `/login` 5 запр/мин → 429 + `Retry-After` | `CONFIG.LOGIN_RATE` | 3.2 |
| Общий rate limit 30 запр/10 c | `CONFIG.RATE` | 3.1 |
| Bot-защита: JS-challenge, passage 30 мин | `UNDER_ATTACK`, cookie | 4 |
| Security-заголовки: X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy | `SECURITY_HEADERS` | 5.2 |

1. **Тест rate limiting (брутфорс логина):**
   ```bash
   for i in $(seq 1 7); do curl -s -o /dev/null -w '%{http_code} ' "https://rollibow-cdn.anivan2003.workers.dev/login"; done; echo
   # ожидание: 200 200 200 200 200 429 429
   ```
   Подождите минуту — лимит сбросится.
2. **Тесты WAF** — команды из ЛР 3.1 (403 на `/admin`, сканер-UA, traversal).
3. **Проверка security-заголовков на любом ответе:**
   ```bash
   curl -sI "https://rollibow-cdn.anivan2003.workers.dev/" | grep -iE 'x-frame-options|x-content-type-options|referrer-policy|permissions-policy|strict-transport'
   ```
4. **Bot-режим:** кратковременно `UNDER_ATTACK: true` → Deploy → показать 503 для
   curl и проход браузера → вернуть `false`.
5. **Мониторинг:** вкладка **Logs** — срабатывания правил (403/429/503) с IP и UA;
   отфильтруйте глазами записи со статусами ≠ 200 — аналог «Security → Events».
6. **Документирование конфигурации (часть 7.2 методички).** Включите в отчёт таблицу:
   | Правило | Условие | Действие |
   |---|---|---|
   | WAF-1 | path contains `/admin` | 403 |
   | WAF-2 | UA ~ `sqlmap\|nmap\|…` | 403 |
   | WAF-3 | path ~ traversal/`/etc/passwd` | 403 |
   | RL-1 | `/login` > 5 запр/мин | 429, Retry-After 30 |
   | RL-2 | любой путь > 30 запр/10 c | 429 |
   | BOT-1 | `UNDER_ATTACK` и нет cookie | 503 + JS-challenge |
   | HDR-1 | все ответы | +5 security-заголовков |
7. **План реагирования (часть 7.1):** шаблон для отчёта —
   «при всплеске 403/429 в Logs: (1) идентифицировать IP/UA по логам,
   (2) при атаке включить `UNDER_ATTACK=true`, (3) ужесточить `CONFIG.RATE`,
   (4) задеплоить, (5) после отражения атаки вернуть значения и оформить отчёт
   об инциденте: время, вектор, принятые меры».

**Критерии успешного выполнения (из методички):** правила блокируют тестовые
запросы (403/429 видны и в curl, и в Logs); security-заголовки присутствуют;
bot-режим работает; конфигурация и план реагирования задокументированы.

---

## Troubleshooting

| Симптом | Причина / решение |
|---|---|
| Error 1101 «Worker threw exception» при повторных открытиях | В дашборде старая версия кода: ветка HIT правила заголовки кэша напрямую. Замените код воркера на актуальный `worker/worker.js` (там ответы кэша сначала копируются: `new Response(cached.body, cached)`) → Save and Deploy |
| Error 1101 сразу на всех запросах | Откройте воркер → Logs: виден текст исключения; в актуальной версии кода вместо 1101 показывается страница 500 с сообщением |
| `x-cache: BYPASS` вместо MISS/HIT | Либо двойной слэш в пути (`//style.css` — см. примечание в начале), либо запрашивается `/api/…` (не кэшируется по замыслу), либо Origin вернул не 200 |
| В ответе есть заголовок `x-cache-hits: 0` | Сквозной заголовок Origin'а (GitHub Pages); наш заголовок — только `x-cache`. В версии воркера от 19.10.2026 сквозные заголовки Origin вырезаются |
| Воркер отдаёт 404 на страницах | Неверный `CONFIG.ORIGIN` (логин GitHub); репозиторий не Public; Pages не включён |
| `x-cache` всегда MISS | Каждый запрос с уникальным query-стрингом; или запрашиваете `/api/…` (не кэшируется по замыслу) |
| `/__purge` вернул `purged_all: 0`, кэш старый | Сменился isolate: повторите запрос страницы + purge; точечный `?url=` работает всегда |
| Весь сайт 503 | Забыли вернуть `UNDER_ATTACK: false` после ЛР 3.1 |
| При тестах прилетает 429 | Сработал rate limit: подождите 10 c (или 60 c для `/login`) либо поднимите лимиты в CONFIG |
| Logs пусты | Вкладка Logs показывает live-поток: откройте её **до** генерации запросов |
| Deploy не публикуется | Кнопка Save and Deploy нажата не в редакторе кода воркера, а в черновике; проверьте вкладку Deployments |

## Файлы варианта B

```
rust-docs/
├── worker/worker.js              # код «CDN»: кэш, purge, WAF, rate-limit, challenge
├── scripts/worker-cache-test.sh  # прогрев + замер Cache Hit Ratio по X-Cache
├── scripts/k6-test.js            # нагрузочный тест для ЛР 3.2
└── LABS-WORKERS.md               # этот документ
```
