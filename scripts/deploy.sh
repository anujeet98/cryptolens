#!/usr/bin/env bash
# Deploy to Vercel with a gate: nothing is promoted to production unless a smoke test passes on the staged build.
#
#   scripts/deploy.sh preview        build + deploy a preview, smoke test it
#   scripts/deploy.sh production     build + stage a production deployment, smoke test it, PROMOTE it, verify the public URL,
#                                    and roll back to the previous production deployment if that final check fails
#
# Env: VERCEL_TOKEN (CI; locally the CLI login is used), VERCEL_ORG_ID / VERCEL_PROJECT_ID (CI),
#      PROD_URL (public production URL), NO_PROMOTE=1 (production dry run: stop after the staged smoke test).
# Writes `url=<deployment url>` to $GITHUB_OUTPUT when set.
set -euo pipefail

MODE="${1:-}"
[[ "$MODE" == "preview" || "$MODE" == "production" ]] || { echo "usage: $0 preview|production" >&2; exit 2; }
PROD_URL="${PROD_URL:-https://cryptolens-silk.vercel.app}"
HERE="$(cd "$(dirname "$0")" && pwd)"

TOKEN_ARGS=()
[ -n "${VERCEL_TOKEN:-}" ] && TOKEN_ARGS=(--token "$VERCEL_TOKEN")
V() { vercel "$@" ${TOKEN_ARGS[@]+"${TOKEN_ARGS[@]}"}; }
log() { echo "▲ $*" >&2; }
set_output() { if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "$1=$2" >> "$GITHUB_OUTPUT"; fi; }

# Deploy prebuilt output without waiting, then poll until the deployment settles. `vercel deploy --skip-domain` waits for a
# READY state that a staged deployment never reports, so the CLI's own wait can hang; polling the API is deterministic.
DEPLOY_URL=""; DEPLOY_ID=""
deploy_and_wait() {
  # Deploy WITHOUT git author metadata. The CLI otherwise attaches the commit author, and Vercel refuses authors whose GitHub
  # account is not the one linked to the Vercel account ("commit author doesn't have permission"). The build is already done
  # and our token is the authorization, so the commit is recorded as plain labels instead. (GIT_DIR points at nothing so the
  # CLI finds no repository; a bare copy of .vercel/ does not work because the output symlinks into node_modules.)
  local sha ref msg json; sha=$(git rev-parse HEAD 2>/dev/null || echo unknown); ref=${GITHUB_REF_NAME:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)}; msg=$(git log -1 --format=%s 2>/dev/null | cut -c1-100 || true)
  json=$(GIT_DIR=/nonexistent V deploy --prebuilt --no-wait --format json -m "sha=$sha" -m "ref=$ref" -m "message=$msg" -m "by=${GITHUB_ACTOR:-local}" "$@" 2>/dev/null) || { log "vercel deploy failed"; return 1; }
  DEPLOY_URL=$(echo "$json" | jq -r '.deployment.url // .url // empty'); DEPLOY_ID=$(echo "$json" | jq -r '.deployment.id // .id // empty')
  [ -n "$DEPLOY_URL" ] && [ -n "$DEPLOY_ID" ] || { log "could not read the deployment from: $(echo "$json" | head -c 300)"; return 1; }
  log "created $DEPLOY_URL ($DEPLOY_ID)"
  local last="" d state sub reason
  for _ in $(seq 1 120); do            # up to ~10 minutes
    d=$(V api "/v13/deployments/$DEPLOY_ID" 2>/dev/null || true)
    state=$(echo "$d" | jq -r '.readyState // "UNKNOWN"' 2>/dev/null || echo UNKNOWN)
    sub=$(echo "$d" | jq -r '.readySubstate // ""' 2>/dev/null || true)
    reason=$(echo "$d" | jq -r '.readyStateReason // ""' 2>/dev/null || true)
    [ "$state/$sub" != "$last" ] && { log "state: $state${sub:+ ($sub)}"; last="$state/$sub"; }
    case "$state" in
      READY) return 0 ;;
      ERROR|CANCELED) log "deployment $state: ${reason:-no reason given}"; return 1 ;;
      BLOCKED)
        # STAGED is the healthy resting state of a --skip-domain deployment; any other block is a real refusal.
        if [ "$sub" = "STAGED" ] && [ -z "$reason" ]; then return 0; fi
        log "deployment BLOCKED: ${reason:-no reason given}"; return 1 ;;
    esac
    sleep 5
  done
  log "timed out waiting for the deployment to settle (last state: $last)"; return 1
}

if [ "$MODE" = "preview" ]; then
  V pull --yes --environment=preview >&2
  V build >&2
  deploy_and_wait
  set_output url "$DEPLOY_URL"
  DEPLOYMENT_URL="$DEPLOY_URL" "$HERE/smoke.sh"
  exit 0
fi

# ---- production ----
V pull --yes --environment=production >&2
V build --prod >&2

# Remember what is live now, so a bad promotion can be undone.
PREV_ID=$(V api "/v13/deployments/${PROD_URL#https://}" 2>/dev/null | jq -r '.id // empty' 2>/dev/null || true)
[ -n "$PREV_ID" ] && log "current production deployment: $PREV_ID" || log "no current production deployment found (first release?), rollback unavailable"

deploy_and_wait --prod --skip-domain
STAGED_URL="$DEPLOY_URL"; set_output url "$STAGED_URL"
log "smoke testing the STAGED deployment (not live yet)"
DEPLOYMENT_URL="$STAGED_URL" "$HERE/smoke.sh" || { log "staged smoke test FAILED. Production was not touched."; exit 1; }

if [ "${NO_PROMOTE:-}" = "1" ]; then log "NO_PROMOTE=1: stopping before promotion"; exit 0; fi

log "promoting $STAGED_URL"
V promote "$STAGED_URL" --yes --timeout 3m >&2
log "verifying the public URL $PROD_URL"
if BASE_URL="$PROD_URL" DEPLOYMENT_URL="" "$HERE/smoke.sh"; then log "production is live: $PROD_URL"; exit 0; fi

log "post-promotion check FAILED"
if [ -n "$PREV_ID" ]; then log "rolling back to $PREV_ID"; V rollback "$PREV_ID" --yes >&2 && log "rolled back" || log "ROLLBACK FAILED: intervene manually"; fi
exit 1
