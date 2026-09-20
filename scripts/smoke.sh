#!/usr/bin/env bash
# Post-deploy smoke test. Fails (non-zero exit) if the deployment cannot do the app's real work.
#
#   BASE_URL=http://localhost:3000 scripts/smoke.sh                       # any reachable URL
#   DEPLOYMENT_URL=https://x.vercel.app VERCEL_TOKEN=... scripts/smoke.sh # protected Vercel deployment (uses `vercel curl`)
#
# It checks the things that break in real life: exchange reachability from the deployed region (Binance refuses some
# countries with HTTP 451), the API routes returning sane data, and the page being served with security headers.
set -uo pipefail

fails=0
pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; fails=$((fails + 1)); }

# fetch PATH -> body on stdout. Non-2xx or transport errors print nothing and return non-zero.
fetch() {
  if [ -n "${DEPLOYMENT_URL:-}" ]; then
    vercel curl "$1" --deployment "$DEPLOYMENT_URL" ${VERCEL_TOKEN:+--token "$VERCEL_TOKEN"} -- -sS --fail --max-time 40 2>/dev/null
  else
    curl -sS --fail --max-time 40 "${BASE_URL%/}$1" 2>/dev/null
  fi
}
# Like fetch, but keeps the body of non-2xx responses: /api/health answers 503 with the reason attached.
fetch_any() {
  if [ -n "${DEPLOYMENT_URL:-}" ]; then
    vercel curl "$1" --deployment "$DEPLOYMENT_URL" ${VERCEL_TOKEN:+--token "$VERCEL_TOKEN"} -- -sS --max-time 40 2>/dev/null
  else
    curl -sS --max-time 40 "${BASE_URL%/}$1" 2>/dev/null
  fi
}
headers() {
  if [ -n "${DEPLOYMENT_URL:-}" ]; then
    vercel curl "$1" --deployment "$DEPLOYMENT_URL" ${VERCEL_TOKEN:+--token "$VERCEL_TOKEN"} -- -sSI --max-time 40 2>/dev/null
  else
    curl -sSI --max-time 40 "${BASE_URL%/}$1" 2>/dev/null
  fi
}

if [ -z "${DEPLOYMENT_URL:-}" ] && [ -z "${BASE_URL:-}" ]; then echo "Set BASE_URL or DEPLOYMENT_URL" >&2; exit 2; fi
command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }
echo "Smoke test: ${DEPLOYMENT_URL:-$BASE_URL}"

# 1. Exchange reachability from wherever this is deployed
body=$(fetch_any /api/health)
if [ -n "${body:-}" ] && [ "$(echo "$body" | jq -r '.ok // false' 2>/dev/null)" = "true" ]; then
  pass "health: exchanges reachable from region $(echo "$body" | jq -r '.region // "local"') ($(echo "$body" | jq -r '[.exchanges[] | select(.ok) | .id] | join(", ")'))"
  d=$(echo "$body" | jq -r '.degraded | join(", ")'); [ -n "$d" ] && printf '  \033[33m!\033[0m degraded (non-core): %s\n' "$d"
else
  reason=$(echo "${body:-}" | jq -r '[.exchanges[]? | select(.ok | not) | "\(.id): \(.error)"] | join("; ")' 2>/dev/null)
  [ -n "$reason" ] || reason="no valid health response (got: $(echo "${body:-nothing}" | tr -d '\n' | cut -c1-120))"
  fail "health: core exchanges NOT reachable from this deployment: $reason"
fi

# 2. Live price
p=$(fetch "/api/ticker?symbol=BTCUSDT&market=perp" | jq -r '.price // empty' 2>/dev/null)
if [ -n "$p" ] && awk "BEGIN{exit !($p > 0)}"; then pass "ticker: BTCUSDT perp = $p"; else fail "ticker: no valid BTCUSDT price"; fi

# 3. Candles: enough of them, ascending, positive closes
c=$(fetch "/api/candles?symbol=BTCUSDT&market=perp&tf=15m&limit=200")
if echo "$c" | jq -e 'length >= 100 and (map(.close) | all(. > 0)) and ([.[].time] == ([.[].time] | sort))' >/dev/null 2>&1; then
  pass "candles: $(echo "$c" | jq 'length') bars, ascending, valid closes"
else fail "candles: missing, too few, unsorted or invalid"; fi

# 4. Market listing (exercises pagination across three exchanges)
s=$(fetch /api/symbols)
if echo "$s" | jq -e 'length > 200 and any(.[]; .base == "BTC")' >/dev/null 2>&1; then
  venues=$(echo "$s" | jq -r '[.[] | select(.base=="BTC") | .markets[].exchange] | unique | join(", ")')
  pass "symbols: $(echo "$s" | jq 'length') coins, exchanges on BTC: $venues"
  # Known issue #16: the listing silently drops an exchange that failed. Warn, do not block a release on it.
  [ "$(echo "$s" | jq '[.[] | select(.base=="BTC") | .markets[].exchange] | unique | length')" -ge 2 ] || printf '  \033[33m!\033[0m symbols: BTC listed on only one exchange, the listing may be partial (see issue #16)\n'
else fail "symbols: listing missing or too small"; fi

# 5. Cross-exchange aggregation
x=$(fetch "/api/xchange?base=BTC")
if echo "$x" | jq -e '(.rows | length) >= 1' >/dev/null 2>&1; then pass "cross-exchange: $(echo "$x" | jq '.rows | length') venue(s) for BTC"; else fail "cross-exchange: no venue returned data"; fi

# 6. Derivatives (funding + open interest)
d=$(fetch "/api/derivatives?symbol=BTCUSDT")
if echo "$d" | jq -e '.snapshot.markPrice > 0 and (.funding | length) > 0 and (.oi5m | length) > 0' >/dev/null 2>&1; then pass "derivatives: mark price, funding and OI history present"; else fail "derivatives: incomplete"; fi

# 7. The page itself, and hardening headers
# Match markers only THIS app emits. A "Deployment is building" placeholder or an error page must not pass.
if fetch / | grep -q "<title>CryptoLens</title>"; then pass "page: served (app title present)"; else fail "page: not our app (title missing; a placeholder or error page?)"; fi
# Permissions-Policy comes from next.config.ts; Vercel does not set it, so it proves the app's own headers are being served.
h=$(headers /)
echo "$h" | grep -qi '^permissions-policy: camera=()' && pass "headers: app security headers present" || fail "headers: app security headers missing"

echo
if [ "$fails" -gt 0 ]; then echo "SMOKE TEST FAILED ($fails check(s))"; exit 1; fi
echo "Smoke test passed"
