#!/usr/bin/env bash
# End-to-end check of the authentication gate against a REAL, throwaway local Postgres (no Docker, no external services).
# Starts Postgres in a temp dir, migrates, builds and starts the app with auth ON, then attacks it from the outside.
#
#   npm run test:auth-e2e            (needs Postgres binaries; set PGBIN if they are not in the default Homebrew path)
#
# Uses dummy OAuth credentials: it proves the gate and the start of the OAuth handshake, not a completed provider login.
set -uo pipefail

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}"
PGPORT="${PGPORT:-5544}"; APPPORT="${APPPORT:-3040}"
[ -x "$PGBIN/initdb" ] || { echo "Postgres binaries not found in $PGBIN (set PGBIN)"; exit 2; }

WORK="$(mktemp -d)"; APP_PID=""
cleanup() { [ -n "$APP_PID" ] && kill "$APP_PID" 2>/dev/null; "$PGBIN/pg_ctl" -D "$WORK/pg" -m immediate stop >/dev/null 2>&1; rm -rf "$WORK"; }
trap cleanup EXIT

export DATABASE_URL="postgres://postgres@127.0.0.1:$PGPORT/e2e"
export BETTER_AUTH_SECRET="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 48)"
export BETTER_AUTH_URL="http://localhost:$APPPORT"
export GITHUB_CLIENT_ID="e2e-github-id" GITHUB_CLIENT_SECRET="e2e-github-secret"
export GOOGLE_CLIENT_ID="e2e-google-id" GOOGLE_CLIENT_SECRET="e2e-google-secret"
export ADMIN_EMAILS="e2e-admin@example.test"
export CONTACT_ALLOWED_ORIGINS="https://landing.example.test"
export SMOKE_TOKEN="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)"
BASE="http://localhost:$APPPORT"

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then printf '  \033[32m✓\033[0m %s\n' "$1"; pass=$((pass+1)); else printf '  \033[31m✗\033[0m %s (expected %s, got %s)\n' "$1" "$2" "$3"; fail=$((fail+1)); fi; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@"; }

echo "1. Postgres"; "$PGBIN/initdb" -D "$WORK/pg" -U postgres --auth=trust >/dev/null 2>&1
"$PGBIN/pg_ctl" -D "$WORK/pg" -o "-p $PGPORT -k $WORK" -l "$WORK/pg.log" -w start >/dev/null 2>&1 || { echo "postgres failed to start"; tail -5 "$WORK/pg.log"; exit 2; }
"$PGBIN/createdb" -h 127.0.0.1 -p "$PGPORT" -U postgres e2e && echo "  database ready"

echo "2. Migrate (twice: the second run must be a no-op)"
npm run -s db:migrate 2>&1 | sed 's/^/  /'
second="$(npm run -s db:migrate 2>&1)"; check "second migration is idempotent" "1" "$(echo "$second" | grep -c 'Auth tables are up to date.')"  # (Better Auth prints a harmless int8 type note first)

echo "3. Build and start the app with authentication ON"
npm run -s build >"$WORK/build.log" 2>&1 || { echo "build failed"; tail -20 "$WORK/build.log"; exit 2; }
npx next start -p "$APPPORT" >"$WORK/app.log" 2>&1 & APP_PID=$!
for _ in $(seq 1 30); do [ "$(code "$BASE/api/health")" != "000" ] && break; sleep 1; done

echo "4. Anonymous visitors are kept out"
check "GET / redirects to sign-in" "307" "$(code "$BASE/")"
check "redirect target is /sign-in" "/sign-in" "$(curl -s -o /dev/null -w '%{redirect_url}' "$BASE/" | sed "s|$BASE||")"
check "deep link is remembered in ?next=" "/sign-in?next=%2Fsomething%3Fa%3D1" "$(curl -s -o /dev/null -w '%{redirect_url}' "$BASE/something?a=1" | sed "s|$BASE||")"
for r in ticker candles derivatives oi symbols xchange depth; do check "GET /api/$r is refused (401)" "401" "$(code "$BASE/api/$r?symbol=BTCUSDT&market=perp&tf=15m&base=BTC")"; done
check "sign-in page is public" "200" "$(code "$BASE/sign-in")"
check "health is public (monitors and smoke tests)" "200" "$(code "$BASE/api/health")"
health="$(curl -s "$BASE/api/health")"
check "health reports auth enabled" "true" "$(echo "$health" | jq -r '.auth.enabled')"
check "health lists the configured providers" "google,github" "$(echo "$health" | jq -r '.auth.providers | join(",")')"
check "health never leaks a secret" "0" "$(echo "$health" | grep -c "e2e-github-secret\|$BETTER_AUTH_SECRET")"

echo "5. The sign-in page"
page="$(curl -s "$BASE/sign-in")"
check "shows a GitHub button" "1" "$(echo "$page" | grep -c 'Continue with GitHub')"
check "shows a Google button" "1" "$(echo "$page" | grep -c 'Continue with Google')"
check "shows no password field" "0" "$(echo "$page" | grep -ci 'type="password"')"
evil="$(curl -s "$BASE/sign-in?next=//evil.example")"
# The props handed to the sign-in buttons are embedded with escaped quotes: \"next\":\"/\"
check "an open-redirect ?next= never reaches the sign-in buttons" "0" "$(echo "$evil" | grep -c 'next\\":\\"//')"
check "the safe destination (/) is used instead" "yes" "$([ "$(echo "$evil" | grep -c 'next\\":\\"/\\"')" -gt 0 ] && echo yes || echo no)"

echo "6. The OAuth handshake starts correctly (redirects to the real provider)"
start="$(curl -s -X POST "$BASE/api/auth/sign-in/social" -H 'content-type: application/json' -H "origin: $BASE" -d '{"provider":"github","callbackURL":"/"}')"
url="$(echo "$start" | jq -r '.url // empty')"
check "points at github.com's authorize endpoint" "1" "$(echo "$url" | grep -c '^https://github.com/login/oauth/authorize')"
check "carries our client id" "1" "$(echo "$url" | grep -c 'client_id=e2e-github-id')"
check "carries the correct callback URL" "1" "$(echo "$url" | grep -c "redirect_uri=http%3A%2F%2Flocalhost%3A$APPPORT%2Fapi%2Fauth%2Fcallback%2Fgithub")"
check "uses PKCE/state (anti-CSRF)" "1" "$(echo "$url" | grep -c 'state=')"
check "an unconfigured provider is refused" "404" "$(code -X POST "$BASE/api/auth/sign-in/social" -H 'content-type: application/json' -H "origin: $BASE" -d '{"provider":"discord","callbackURL":"/"}')"
check "a hostile callbackURL is refused (no open redirect after login)" "403" "$(code -X POST "$BASE/api/auth/sign-in/social" -H 'content-type: application/json' -H "origin: $BASE" -d '{"provider":"github","callbackURL":"https://evil.example/steal"}')"

echo "7. Layered protection: a FORGED cookie"
forged="cryptolens.session_token=forgedtoken.forgedsignature"
check "the fast layer lets the page shell through (it only sees a cookie)" "200" "$(code -H "Cookie: $forged" "$BASE/")"
check "the strict layer still refuses the data API" "401" "$(code -H "Cookie: $forged" "$BASE/api/ticker?symbol=BTCUSDT&market=perp")"

echo "7b. REGRESSION: a stale cookie must not cause a redirect loop between / and /sign-in"
check "sign-in still renders for a forged cookie (no bounce)" "200" "$(code -H "Cookie: $forged" "$BASE/sign-in")"
check "and shows the provider buttons" "1" "$(curl -s -H "Cookie: $forged" "$BASE/sign-in" | grep -c 'Continue with GitHub')"

echo "8. A real signed-in session"
cookie="$(npm run -s auth:seed -- e2e-user@example.test 2>&1 | tail -1)"
check "seed produced a session cookie" "1" "$(echo "$cookie" | grep -c '^cryptolens.session_token=')"
check "dashboard loads" "200" "$(code -H "Cookie: $cookie" "$BASE/")"
check "the sign-in page bounces a signed-in user to /" "307" "$(code -H "Cookie: $cookie" "$BASE/sign-in")"
check "data API answers (real exchange data)" "200" "$(code -H "Cookie: $cookie" "$BASE/api/ticker?symbol=BTCUSDT&market=perp")"
price="$(curl -s -H "Cookie: $cookie" "$BASE/api/ticker?symbol=BTCUSDT&market=perp" | jq -r '.price // 0')"
check "and it is a real price" "1" "$(awk "BEGIN{print ($price > 1000) ? 1 : 0}")"

echo "9. A cross-site request that rides on a real session is refused (CSRF)"
csrfcookie="$(npm run -s auth:seed -- csrf-user@example.test 2>&1 | tail -1)"
check "sign-out with a hostile Origin is refused" "403" "$(code -X POST "$BASE/api/auth/sign-out" -H "Cookie: $csrfcookie" -H 'origin: https://evil.example' -H 'content-type: application/json' -d '{}')"
check "and the session survived that attempt" "200" "$(code -H "Cookie: $csrfcookie" "$BASE/api/ticker?symbol=BTCUSDT&market=perp")"

echo "9b. Sign-out really ends the session"
check "sign-out succeeds" "200" "$(code -X POST "$BASE/api/auth/sign-out" -H "Cookie: $cookie" -H "origin: $BASE" -H 'content-type: application/json' -d '{}')"
check "a revoked session's cookie still gets the sign-in page (no loop)" "200" "$(code -H "Cookie: $cookie" "$BASE/sign-in")"
check "the same cookie is now refused" "401" "$(code -H "Cookie: $cookie" "$BASE/api/ticker?symbol=BTCUSDT&market=perp")"

echo "10. The smoke-test bypass"
check "correct token is accepted" "200" "$(code -H "x-smoke-token: $SMOKE_TOKEN" "$BASE/api/ticker?symbol=BTCUSDT&market=perp")"
check "wrong token is refused" "401" "$(code -H "x-smoke-token: nope" "$BASE/api/ticker?symbol=BTCUSDT&market=perp")"

echo "11. Users are recorded"
report="$(npm run -s users 2>&1)"
check "the users report counts the seeded users" "1" "$(echo "$report" | grep -c 'Users: 2 total')"
check "it masks the email" "0" "$(echo "$report" | grep -c 'e2e-user@example.test')"

echo "12. The deploy smoke test understands the gate"
sm="$(BASE_URL="$BASE" SMOKE_TOKEN="$SMOKE_TOKEN" scripts/smoke.sh 2>&1 | sed 's/\x1b\[[0-9;]*m//g')"
check "smoke passes on a protected deployment when given the token" "1" "$(echo "$sm" | grep -c 'Smoke test passed')"
check "and it verified the anonymous gate" "1" "$(echo "$sm" | grep -c 'gate: an anonymous API request is refused')"
sm2="$(env -u SMOKE_TOKEN BASE_URL="$BASE" scripts/smoke.sh 2>&1 | sed 's/\x1b\[[0-9;]*m//g')"
check "smoke FAILS on a protected deployment without the token (cannot pass by accident)" "1" "$(echo "$sm2" | grep -c 'SMOKE TEST FAILED')"

echo "13. Feedback and the admin inbox"
fbcookie="$(npm run -s auth:seed -- fb-user@example.test 2>&1 | tail -1)"   # section 9b revoked the earlier session
post() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST -H "content-type: application/json" -H "Origin: $BASE" "$@"; }
fb='{"kind":"feature","title":"Telegram alerts","body":"Please add Telegram push alerts for signals.","page":"/"}'
check "anonymous feedback is refused (401)" "401" "$(post -d "$fb" "$BASE/api/feedback")"
check "invalid feedback is rejected (400)" "400" "$(post -H "Cookie: $fbcookie" -d '{"kind":"nope","body":"x"}' "$BASE/api/feedback")"
check "a message needs no title (201)" "201" "$(post -H "Cookie: $fbcookie" -d '{"kind":"message","body":"Hello there, quick question about alerts."}' "$BASE/api/feedback")"
check "a valid idea is stored (201)" "201" "$(post -H "Cookie: $fbcookie" -d "$fb" "$BASE/api/feedback")"
for _ in 1 2 3; do post -H "Cookie: $fbcookie" -d "$fb" "$BASE/api/feedback" >/dev/null; done
check "the sixth item within the hour is rate limited (429)" "429" "$(post -H "Cookie: $fbcookie" -d "$fb" "$BASE/api/feedback")"
check "the report lists what was sent (4 ideas)" "4" "$(npm run -s feedback 2>&1 | grep -c 'Telegram alerts')"
check "a non-admin gets 404 for the inbox page" "404" "$(code -H "Cookie: $fbcookie" "$BASE/admin/feedback")"
check "a non-admin cannot change a status (404)" "404" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH -H "content-type: application/json" -H "Origin: $BASE" -H "Cookie: $fbcookie" -d '{"source":"feedback","id":1,"status":"done"}' "$BASE/api/admin/feedback")"
check "anonymous gets no inbox (redirected to sign-in)" "307" "$(code "$BASE/admin/feedback")"
admincookie="$(npm run -s auth:seed -- e2e-admin@example.test 2>&1 | tail -1)"
check "an admin sees the inbox (200)" "200" "$(code -H "Cookie: $admincookie" "$BASE/admin/feedback")"
check "the inbox shows the submission" "1" "$(curl -s -H "Cookie: $admincookie" "$BASE/admin/feedback" | grep -c 'Telegram alerts')"
check "an admin can set a status (200)" "200" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH -H "content-type: application/json" -H "Origin: $BASE" -H "Cookie: $admincookie" -d '{"source":"feedback","id":1,"status":"done"}' "$BASE/api/admin/feedback")"
check "an invalid status is rejected (400)" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH -H "content-type: application/json" -H "Origin: $BASE" -H "Cookie: $admincookie" -d '{"source":"feedback","id":1,"status":"deleted"}' "$BASE/api/admin/feedback")"

echo "14. The public contact form"
LAND="https://landing.example.test"
cpost() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST -H "content-type: application/json" "$@"; }
c1='{"name":"Asha","email":"asha@example.com","message":"How do I connect my exchange account?"}'
check "the endpoint is reachable without signing in (201)" "201" "$(cpost -H "Origin: $LAND" -d "$c1" "$BASE/api/contact")"
check "a preflight from the landing page is allowed (204)" "204" "$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS -H "Origin: $LAND" -H "Access-Control-Request-Method: POST" "$BASE/api/contact")"
check "and answers with that origin in the CORS header" "$LAND" "$(curl -s -D - -o /dev/null -X OPTIONS -H "Origin: $LAND" "$BASE/api/contact" | tr -d '\r' | awk -F': ' 'tolower($1)=="access-control-allow-origin"{print $2}')"
check "a browser from another site is refused (403)" "403" "$(cpost -H "Origin: https://evil.example" -d "$c1" "$BASE/api/contact")"
check "and gets no CORS header" "0" "$(curl -s -D - -o /dev/null -X OPTIONS -H "Origin: https://evil.example" "$BASE/api/contact" | grep -ci 'access-control-allow-origin')"
check "a bad email is rejected (400)" "400" "$(cpost -H "Origin: $LAND" -d '{"email":"nope","message":"long enough message here"}' "$BASE/api/contact")"
check "a too-short message is rejected (400)" "400" "$(cpost -H "Origin: $LAND" -d '{"email":"a@b.co","message":"hi"}' "$BASE/api/contact")"
check "a filled honeypot looks successful (201)" "201" "$(cpost -H "Origin: $LAND" -d '{"email":"bot@example.com","message":"buy cheap pills now please","website":"http://spam"}' "$BASE/api/contact")"
check "but the honeypot message was not stored" "0" "$(npm run -s feedback 2>&1 | grep -c 'buy cheap pills')"
cpost -H "Origin: $LAND" -d "$c1" "$BASE/api/contact" >/dev/null
check "the third message within the hour is still accepted (201)" "201" "$(cpost -H "Origin: $LAND" -d "$c1" "$BASE/api/contact")"
check "the fourth from the same address is rate limited (429)" "429" "$(cpost -H "Origin: $LAND" -d "$c1" "$BASE/api/contact")"
check "another address is not affected by that limit (201)" "201" "$(cpost -H "Origin: $LAND" -H "X-Forwarded-For: 203.0.113.9" -d "$c1" "$BASE/api/contact")"
check "the report shows contact messages (4 stored)" "4" "$(npm run -s feedback 2>&1 | grep -c 'contact, not signed in')"
psqlq() { "$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -U postgres e2e -tAc "$1" 2>&1; }
check "every stored address is a 32-character hash, never a raw IP" "4" "$(psqlq "select count(*) from contact where \"ipHash\" ~ '^[0-9a-f]{32}$'")"
check "the admin inbox lists the contact message" "1" "$(curl -s -H "Cookie: $admincookie" "$BASE/admin/feedback" | grep -c 'from the website')"
cid="$(psqlq "select id from contact order by id limit 1")"
cbody="{\"source\":\"contact\",\"id\":$cid,\"status\":\"seen\"}"
check "an admin can set a contact status (200)" "200" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH -H "content-type: application/json" -H "Origin: $BASE" -H "Cookie: $admincookie" -d "$cbody" "$BASE/api/admin/feedback")"
check "a request without a source is rejected (400)" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH -H "content-type: application/json" -H "Origin: $BASE" -H "Cookie: $admincookie" -d '{"id":1,"status":"seen"}' "$BASE/api/admin/feedback")"

echo; if [ "$fail" -gt 0 ]; then echo "AUTH E2E FAILED: $fail failed, $pass passed"; exit 1; fi; echo "Auth e2e passed: $pass checks"
