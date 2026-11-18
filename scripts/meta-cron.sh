#!/usr/bin/env bash
set -euo pipefail

# Run as jisra-cron. Do not install until the corresponding feature is enabled.
case "${1:-}" in
  capi) endpoint=meta-outbox ;;
  acquisition) endpoint=jisra-acquisition ;;
  *) exit 2 ;;
esac
[[ ! -e /etc/jisra/meta-"$1".suspend ]] || exit 0
exec 9>"/var/log/jisra/meta-$1.lock"
flock -n 9 || exit 0
secret=$(tr -d '\r\n' </etc/jisra/email-cron.secret)
[[ "$secret" =~ ^[a-zA-Z0-9_+=/.-]{24,256}$ ]] || exit 1
set +e
status=$(printf 'header = "Authorization: Bearer %s"\n' "$secret" |
  curl --disable --config - --silent --output /dev/null --write-out '%{http_code}' \
    --proto '=https' --connect-timeout 10 --max-time 60 "https://jisra.io/api/cron/$endpoint")
rc=$?
set -e
unset secret
logger -t "jisra-meta-$1" -- "HTTP ${status:-000}; curl=$rc"
[[ "$rc" -eq 0 && "$status" == 200 ]]