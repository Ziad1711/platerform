#!/usr/bin/env bash
# Purge de la file email-outbox depuis un hôte autorisé (planification toutes les 5 minutes).
# À installer via /etc/cron.d/jisra-email sous un utilisateur système DÉDIÉ (ex. "jisra-cron").
# Le secret est lu depuis un fichier protégé, jamais passé en argument, jamais journalisé.
# Aucune adresse de destinataire ni corps de réponse n'est journalisé.
set -u

ENDPOINT="${JISRA_EMAIL_ENDPOINT:-https://jisra.io/api/cron/email-outbox}"
SECRET_FILE="${JISRA_CRON_SECRET_FILE:-/etc/jisra/email-cron.secret}"
LOCK_FILE="${JISRA_EMAIL_LOCK:-/run/lock/jisra-email.lock}"
LOG_FILE="${JISRA_EMAIL_LOG:-/var/log/jisra/email-cron.log}"
SUSPEND_FILE="/etc/jisra/email-cron.suspend"
MAX_SECONDS=30
ERR_TMP="$(mktemp)"

log() { printf '%s %s\n' "$(date -Is)" "$*" >> "$LOG_FILE"; }

# Suspension immédiate : la simple présence de ce fichier vide stoppe tout envoi.
[ -f "$SUSPEND_FILE" ] && exit 0

[ -r "$SECRET_FILE" ] || { log "ERROR secret_unreadable"; exit 1; }
SECRET="$(tr -d '\r\n' < "$SECRET_FILE")"
[ -n "$SECRET" ] || { log "ERROR secret_empty"; exit 1; }

# Anti-chevauchement : un seul run à la fois (flock non bloquant).
exec 9>"$LOCK_FILE"
flock -n 9 || { log "SKIP already_running"; exit 0; }

RESP="$(curl -fsS -w $'\n%{http_code}' --max-time "$MAX_SECONDS" \
  -H "Authorization: Bearer $SECRET" "$ENDPOINT" 2>"$ERR_TMP")"
CURL_RC=$?

if [ "$CURL_RC" -ne 0 ]; then
  log "ERROR curl_rc=$CURL_RC detail=$(head -c 160 "$ERR_TMP" | tr -d '\r\n')"
  rm -f "$ERR_TMP"
  exit 1
fi

HTTP_CODE="$(printf '%s' "$RESP" | tail -n 1)"
rm -f "$ERR_TMP"

if [ "$HTTP_CODE" != "200" ]; then
  log "ERROR http_code=$HTTP_CODE"
  exit 1
fi

# Supervision légère : succès seulement, jamais le corps (qui peut contenir des compteurs,
# mais on évite toute fuite de données métier dans les logs).
log "OK"
exit 0
