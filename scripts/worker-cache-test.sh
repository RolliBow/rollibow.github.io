#!/usr/bin/env bash
# =============================================================================
# worker-cache-test.sh — замер Cache Hit Ratio учебного CDN на Workers
#
# Использование:
#   ./worker-cache-test.sh https://<имя>.workers.dev [число_кругов]
#
# Считает значения заголовка X-Cache (HIT / MISS / BYPASS / DYNAMIC),
# который выставляет наш worker.js.
# =============================================================================
set -u

BASE="${1:?Укажите URL воркера: ./worker-cache-test.sh https://rollibow-cdn.workers.dev 3}"
ROUNDS="${2:-3}"

PAGES=(index.html installation.html variables.html types.html functions.html
       control-flow.html ownership.html borrowing.html structs.html
       enums-match.html collections.html generics-traits.html errors.html
       modules.html cheat-sheet.html about/ blog/post1.html)
ASSETS=(style.css image.jpg favicon.svg)

hit=0; miss=0; other=0

get_status() {
  curl -sI --max-time 20 "$1" \
    | tr -d '\r' \
    | awk -F': ' 'tolower($1)=="x-cache"{print toupper($2)}'
}

echo "CDN (Worker): $BASE"
echo "Кругов:       $ROUNDS"
echo "-----------------------------------------"

for ((r=1; r<=ROUNDS; r++)); do
  for p in "${PAGES[@]}"; do
    s=$(get_status "$BASE/$p")
    case "$s" in
      HIT)  hit=$((hit+1));;
      MISS) miss=$((miss+1));;
      *)    other=$((other+1));;
    esac
  done
  for a in "${ASSETS[@]}"; do
    s=$(get_status "$BASE/$a")
    case "$s" in
      HIT)  hit=$((hit+1));;
      MISS) miss=$((miss+1));;
      *)    other=$((other+1));;
    esac
  done
done

total=$((hit+miss))
echo "-----------------------------------------"
echo "HIT: $hit   MISS: $miss   прочее (BYPASS/DYNAMIC): $other"
if [ "$total" -gt 0 ]; then
  awk "BEGIN{printf \"Cache Hit Ratio: %.1f%% (из %d кэшируемых запросов)\n\", $hit*100/$total, $total}"
fi
