#!/usr/bin/env bash
# Timer/loop on a trusted host. Never source the production application env.
set -euo pipefail
: "${JISRA_RECOVERY_URL:?Exact HTTPS application /api/cron/webhook-recovery URL required}"
: "${JISRA_RECOVERY_AUTH_FILE:?0600 curl config containing Authorization header required}"
[[ "$JISRA_RECOVERY_URL" == https://*/api/cron/webhook-recovery ]] || exit 2
[[ -f "$JISRA_RECOVERY_AUTH_FILE" && "$(stat -c %a "$JISRA_RECOVERY_AUTH_FILE")" == 600 ]] || exit 2
exec 9>"${JISRA_RECOVERY_LOCK:-/run/jisra-webhook-recovery.lock}"
flock -n 9 || exit 0
response=$(curl --config "$JISRA_RECOVERY_AUTH_FILE" --silent --show-error --fail \
  --connect-timeout 5 --max-time 55 --max-redirs 0 "$JISRA_RECOVERY_URL")
python3 -c 'import json,sys; x=json.load(sys.stdin); assert isinstance(x.get("processed"),int); assert x.get("failed")==0, "pending webhook failures"; print("WEBHOOK_RECOVERY", "paused" if x.get("paused") else "ok", x["processed"])' <<< "$response"