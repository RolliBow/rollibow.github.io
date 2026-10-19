#!/usr/bin/env bash
# =============================================================================
# cache-test.sh — замер Cache Hit Ratio через CDN-заголовки
#
# Использование:
#   ./cache-test.sh https://ваш-сайт.pages.dev [число_кругов]
#
# Скрипт обходит все 15 HTML-страниц и статические ресурсы, читает заголовок
# cf-cache-status (Cloudflare) и считает соотношение HIT / MISS.
# Для Netlify замените cf-cache-status на x-nf-cache-status (или age).
# =============================================================================
set -u

BASE="${1:?Укажите URL сайта, например: ./cache-test.sh https://rust-docs.pages.dev 3}"
ROUNDS="${2:-3}"

PAGES=(index installation variables types functions control-flow ownership \
       borrowing structs enums-match collections generics-traits errors \
       modules cheat-sheet)
ASSETS=(style.css image.jpg favicon.svg)

hit=0; miss=0; other=0

get_status() {
  curl -sI --max-time 15 "$1" \
    | tr -d '\r' \
    | awk -F': ' 'tolower($1)=="cf-cache-status"{print toupper($2)}'
}

echo "Сайт:   $BASE"
echo "Кругов: $ROUNDS"
echo "-----------------------------------------"

for ((r=1; r<=ROUNDS; r++)); do
  for p in "${PAGES[@]}"; do
    s=$(get_status "$BASE/$p.html")
    case "$s" in
      HIT)  hit=$((hit+1));;
      MISS) miss=$((miss+1));;
      *)    other=$((other+1)); echo "  [круг $r] $p.html → ${s:-нет заголовка (не Cloudflare?)}";;
    esac
  done
  for a in "${ASSETS[@]}"; do
    s=$(get_status "$BASE/$a")
    case "$s" in
      HIT)  hit=$((hit+1));;
      MISS) miss=$((miss+1));;
      *)    other=$((other+1)); echo "  [круг $r] $a → ${s:-нет заголовка}";;
    esac
  done
done

total=$((hit+miss))
echo "-----------------------------------------"
echo "HIT: $hit   MISS: $miss   прочее/без заголовка: $other"
if [ "$total" -gt 0 ]; then
  awk "BEGIN{printf \"Cache Hit Ratio: %.1f%% (из %d запросов с заголовком)\n\", $hit*100/$total, $total}"
fi
