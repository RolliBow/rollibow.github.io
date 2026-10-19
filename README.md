# Практикум: статический сайт за CDN — «Документация Rust»

Учебный статический сайт из **15 однотипных HTML-страниц** с подсветкой кода,
общим CSS и веб-шрифтами. Материал практикума — наблюдение за **Cache Hit Ratio**
и политиками **TTL** на границе CDN.

## Что внутри

```
rust-docs/
├── index.html … cheat-sheet.html   # 15 страниц документации Rust
├── style.css                       # единственный CSS на весь сайт (~7 КБ)
├── image.jpg                       # иллюстрация (требование лабы 2.1)
├── favicon.svg
├── _headers                        # политика Cache-Control (Cloudflare Pages / Netlify)
├── LAB-2.1.md                      # чек-лист лабораторной 2.1 (Cloudflare CDN)
├── LABS-WORKERS.md                 # лабы 2.1–3.4 без своего домена (вариант B, Workers)
├── worker/
│   └── worker.js                   # учебный «CDN»: кэш, purge, WAF, rate-limit
└── scripts/
    ├── cache-test.sh               # замер Cache Hit Ratio (зона Cloudflare)
    ├── worker-cache-test.sh        # замер Cache Hit Ratio (вариант B, X-Cache)
    └── k6-test.js                  # нагрузочный тест для ЛР 3.2
```

Особенности, важные для практикума:

- **0 JavaScript.** Подсветка синтаксиса — статические `<span class="kw|str|ty|…">`,
  поэтому HTML полностью самодостаточен и кэшируем.
- **15 страниц тянут одни и те же ресурсы**: `style.css`, `image.jpg`, `favicon.svg`
  и шрифты Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`).
  Один посетитель, обошедший весь справочник, даёт 1 MISS и 14+ HIT на ассеты.
- **Шрифты** подключены через `preconnect` + `display=swap`; Google отдаёт их
  с `max-age=31536000` — готовый пример «долгого TTL».
- **`_headers`** задаёт разную политику: год для `/style.css`, `/image.jpg`, `/favicon.svg`, 5 минут для HTML.

## Развёртывание (любой вариант)

### Cloudflare Pages (рекомендуется — виден `cf-cache-status`)
1. dashboard.cloudflare.com → Workers & Pages → Create → Pages → **Upload assets**.
2. Перетащить содержимое папки `rust-docs/` (или zip) → Deploy.
3. Готово: `https://<имя>.pages.dev`.

Или из терминала:
```bash
npx wrangler pages deploy rust-docs --project-name=rust-docs
```

### Netlify
1. app.netlify.com → **Sites** → перетащить zip папки `rust-docs` (Netlify Drop).
2. Файл `_headers` подхватится автоматически.

### Локально (без CDN, для сравнения)
```bash
cd rust-docs && python3 -m http.server 8080
# открыть http://localhost:8080
```

## Задания практикума

1. **Первый проход.** Обойдите все 15 страниц сайта в браузере. Откройте DevTools →
   Network: сколько запросов, какие из них `from disk/memory cache`,
   какой размер передан повторно?
2. **Заголовки кэша.** Выполните и сравните:
   ```bash
   curl -sI https://<ваш-домен>/style.css | grep -iE 'cache-control|cf-cache-status|age'
   curl -sI https://<ваш-домен>/index.html    | grep -iE 'cache-control|cf-cache-status|age'
   ```
   Почему для CSS и HTML задан разный `max-age`? (спойлер: частота изменений)
3. **Замер Cache Hit Ratio.** Запустите скрипт в 2–3 круга:
   ```bash
   chmod +x scripts/cache-test.sh
   ./scripts/cache-test.sh https://<ваш-домен> 3
   ```
   Первый круг — MISS (прогрев кэша), последующие — HIT. Посчитайте итоговый
   hit ratio и сравните с дашбордом CDN (Cloudflare: Analytics → Caching).
4. **Сброс кэша.** Очистите кэш (Cloudflare: Caching → Purge Everything) и
   повторите замер. Как изменилось соотношение HIT/MISS? Зачем нужен purge?
5. **Cache busting.** Измените цвет в `style.css`, задеплойте заново.
   Увидели ли вы изменение сразу? Обсудите два решения: короткий TTL vs
   версионирование имени файла (`style.css?v=2`).
6. **Шрифты.** В DevTools → Network → фильтр Font найдите ответы
   `fonts.gstatic.com`. Какой у них `cache-control`? Почему сторонний CDN
   для шрифтов — это и польза (кэш, HTTP/2), и риск (приватность, доступность)?

## Контрольные вопросы

- Что такое Cache Hit Ratio и как его считает CDN?
- Чем `Cache-Control: max-age=31536000, immutable` отличается от `max-age=300`?
- Почему HTML кэшируют коротко, а статику — длинно?
- Что произойдёт при деплое новой версии сайта с `immutable`-кэшем и старым именем CSS-файла?
- Какие ресурсы на этом сайте дают наибольший прирост hit ratio и почему?

## Пересборка сайта

Страницы генерируются скриптом `build_site.py` (лежит рядом с папкой):
контент, шаблон и подсветка синтаксиса описаны в нём же. После правок:

```bash
python3 build_site.py   # пересоберёт rust-docs/*.html
```

---
Тема варианта: «Документация языка программирования» (справочник по Rust).
