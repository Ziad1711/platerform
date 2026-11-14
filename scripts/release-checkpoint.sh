#!/usr/bin/env bash
# Read-only snapshot of the selected source; never changes source DB/files.
# Execute only against an approved isolated target, or after explicit Q3 approval.
set -euo pipefail
: "${CHECKPOINT_DB_CONTAINER:?}"
: "${CHECKPOINT_DB_NAME:?}"
: "${CHECKPOINT_STORAGE_CONTAINER:?}"
: "${CHECKPOINT_STORAGE_PATH:?}"
: "${CHECKPOINT_DIR:?}"
: "${CHECKPOINT_CERT:?Public encryption certificate required}"
[[ ! -e "$CHECKPOINT_DIR" ]] || { echo 'CHECKPOINT_DIR must be new'; exit 2; }
[[ "$CHECKPOINT_STORAGE_PATH" == /* && "$CHECKPOINT_STORAGE_PATH" != / ]] || exit 2
umask 077
mkdir -p "$CHECKPOINT_DIR"
docker exec "$CHECKPOINT_DB_CONTAINER" pg_dump -U supabase_admin -d "$CHECKPOINT_DB_NAME" -Fc \
  | openssl cms -encrypt -binary -aes-256-gcm -outform DER -out "$CHECKPOINT_DIR/postgres.cms" "$CHECKPOINT_CERT"
docker exec "$CHECKPOINT_DB_CONTAINER" pg_dumpall -U supabase_admin --roles-only \
  | openssl cms -encrypt -binary -aes-256-gcm -outform DER -out "$CHECKPOINT_DIR/roles.cms" "$CHECKPOINT_CERT"
docker exec "$CHECKPOINT_STORAGE_CONTAINER" tar -C "$CHECKPOINT_STORAGE_PATH" -czf - . \
  | openssl cms -encrypt -binary -aes-256-gcm -outform DER -out "$CHECKPOINT_DIR/storage.cms" "$CHECKPOINT_CERT"
(cd "$CHECKPOINT_DIR"; sha256sum postgres.cms roles.cms storage.cms > SHA256SUMS)
printf 'CHECKPOINT_COMPLETE=%s\n' "$CHECKPOINT_DIR"
# A local complete checkpoint is NOT off-host disaster protection.
# Copy ciphertext + SHA256SUMS off-host, decrypt/restore isolated and verify before GO.