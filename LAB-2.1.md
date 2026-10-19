# Лабораторная 2.1 — Настройка CDN Cloudflare для статического сайта

Чек-лист по шагам методички, адаптированный под наш проект
(сайт-справочник «Документация Rust», файлы в папке `rust-docs/`).

Наш сайт = **свой вариант** (требование методички): 15 HTML-страниц,
`style.css` и `image.jpg` в корне — всё, что требует лабораторная.

---

## Шаг 1. Origin — исходный сервер (вариант A: GitHub Pages)

1. GitHub → **New repository**, имя строго `ВАШ_ЛОГИН.github.io`
   (логин в нижнем регистре), видимость **Public**.
2. Загрузите в корень репозитория **всё содержимое** папки `rust-docs/`:
   - `index.html` + ещё 14 страниц (`installation.html` … `cheat-sheet.html`)
   - `style.css`
   - `image.jpg`
   - `favicon.svg`, `README.md`, `_headers`, `scripts/` (не помешают)

   Через браузер: на странице репозитория **Add file → Upload files**,
   перетащить файлы → Commit. Или через git:
   ```bash
   git clone https://github.com/ЛОГИН/ЛОГИН.github.io.git
   cp -r rust-docs/* ЛОГИН.github.io/
   cd ЛОГИН.github.io && git add -A && git commit -m "lab 2.1 origin" && git push
   ```
3. **Settings → Pages**: Source = *Deploy from a branch*, ветка `main`, папка `/ (root)`.
4. Через 1–2 минуты сайт открывается на `https://ЛОГИН.github.io` — **это ваш Origin**.
   Запишите адрес: он понадобится в отчёте.
5. Самопроверка: F12 → Network → перезагрузка → `image.jpg` и `style.css` со статусом 200.

> Вариант B (свой VPS): в папке с сайтом `python3 -m http.server 8000`,
> Origin = `http://ВАШ_IP:8000`. Дальнейшие шаги одинаковы для A и B,
> отличается только IP в шаге 2.

## Шаг 2. Узнать IP Origin'а

```bash
ping ЛОГИН.github.io        # вариант A: IP GitHub Pages
# или ваш IP VPS            # вариант B
```
Запишите IPv4-адрес (например, `185.199.108.153`) — его укажем в A-записи.

## Шаг 3. Добавить сайт в Cloudflare

1. dashboard.cloudflare.com → **Add a Site** → введите **свой домен**
   (тот, что куплен у регистратора, например `mydomain.com`) → план **Free**.
2. Cloudflare просканирует DNS. **Удалите (или закомментируйте) все существующие
   A-записи** для `@` и `www`, указывающие на старый хостинг.
3. Создайте новую запись:
   | Поле | Значение |
   |---|---|
   | Type | `A` |
   | Name | `@` |
   | IPv4 address | IP из шага 2 |
   | Proxy status | **Proxied** (оранжевое облако) ← именно это включает CDN |
4. Опционально: `CNAME` `www` → `ЛОГИН.github.io`, тоже Proxied.
5. Cloudflare выдаст два nameserver'а (вида `lara.ns.cloudflare.com`,
   `virgil.ns.cloudflare.com`). **Запишите их.**

## Шаг 4. Смена NS у регистратора

1. Панель регистратора (где покупали домен) → **DNS Management / Name Servers**.
2. Замените текущие NS на пару от Cloudflare, сохраните.
3. Propagation: от минут до 24 ч (обычно 1–2 ч). Cloudflare пришлёт письмо
   об активации зоны.

## Шаг 5. Проверка: трафик идёт через CDN

1. Откройте `https://mydomain.com` — сайт открылся.
2. F12 → **Network** → перезагрузите страницу → кликните запрос `image.jpg`:
   - столбец **Remote Address** = IP Cloudflare (например, `104.21.x.x` / `172.67.x.x`),
     а **не** IP из шага 2. Это главное доказательство проксирования. Скрин!
3. Заголовки ответа (вкладка Headers или терминал):
   ```bash
   curl -sI https://mydomain.com/image.jpg | grep -iE 'server|cf-cache-status|age|cache-control'
   ```
   Ожидаем: `server: cloudflare`, `cf-cache-status: HIT|MISS`, наш `Cache-Control` из `_headers`…
   (на GitHub Pages `_headers` не действует — правила TTL задаются в Cloudflare:
   Rules → Cache Rules; на Netlify/CF Pages файл подхватился бы сам).
4. Бонус к защите (первая лаба): замер Cache Hit Ratio
   ```bash
   ./scripts/cache-test.sh https://mydomain.com 3
   ```

## Что показать на защите

- [ ] Репозиторий `ЛОГИН.github.io` и работающий Origin-адрес.
- [ ] Cloudflare → DNS: A-запись `@` с оранжевым облаком.
- [ ] DevTools Network: Remote Address запроса `image.jpg` = IP Cloudflare (скриншот).
- [ ] `curl -sI`: заголовок `server: cloudflare`.
- [ ] (бонус) вывод `cache-test.sh` с Cache Hit Ratio.

## Типовые проблемы

| Симптом | Причина / решение |
|---|---|
| Сайт не открылся после смены NS | Не закончился propagation: `dig NS mydomain.com`; проверьте, что NS сохранены у регистратора |
| «Too many redirects» | Cloudflare SSL/TLS: поставьте режим **Full** (Origin GitHub Pages умеет HTTPS) |
| Страница без стилей | `style.css` должен лежать в корне репозитория, в HTML — `href="style.css"` |
| Картинка 404 | `image.jpg` в корне, в HTML — `src="image.jpg"` |
| Remote Address = IP GitHub | Облако на A-записи серое (DNS only) — включите **Proxied** |
