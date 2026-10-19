// k6-скрипт нагрузочного теста для ЛР 3.2 (учебный CDN на Workers)
// Запуск:  k6 run -e CDN_URL=https://<имя>.workers.dev k6-test.js
import http from 'k6/http';
import { sleep } from 'k6';

const BASE = __ENV.CDN_URL || 'https://example.workers.dev';

export const options = {
  stages: [
    { duration: '1m', target: 10 }, // плавно до 10 виртуальных пользователей
    { duration: '2m', target: 10 }, // держим 10 пользователей
    { duration: '1m', target: 0 },  // плавно в ноль
  ],
};

const pages = [
  '/', '/installation.html', '/variables.html', '/ownership.html',
  '/cheat-sheet.html', '/about/', '/blog/post1.html',
];

export default function () {
  const page = pages[Math.floor(Math.random() * pages.length)];
  http.get(`${BASE}${page}`);   // HTML-страницы (кэшируются)
  http.get(`${BASE}/style.css`); // общий CSS — максимум HIT
  http.get(`${BASE}/image.jpg`); // картинка
  sleep(1);
}
