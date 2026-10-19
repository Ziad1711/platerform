#!/usr/bin/env bash
# P7.3 — export strictement structurel de Production, en lecture seule.
# Ne contient aucun credential. Fournir PROD_DATABASE_URL (rôle lecture seule).
# Sortie : dump SQL sans données, sans commentaires, sans propriétaires.
set -euo pipefail

: "${PROD_DATABASE_URL:?PROD_DATABASE_URL is required}"
OUT="${1:-prod-structure.sql}"

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "BLOCKED: pg_dump absent. Installer un client PostgreSQL 17+ (sans Docker)." >&2
  exit 2
fi

echo "Export vers ${OUT}"
PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=120000' \
pg_dump "$PROD_DATABASE_URL" \
  --schema-only \
  --schema=public \
  --no-owner \
  --no-comments \
  --no-security-labels \
  --no-tablespaces \
  --no-publications \
  --no-subscriptions \
  --format=plain \
  --file="$OUT"

echo "Contrôles de non-fuite :"
DATA_HITS=$(grep -cE '^(COPY|INSERT INTO|CREATE DATABASE|CREATE ROLE|ALTER ROLE)' "$OUT" || true)
echo "  lignes de données/roles : ${DATA_HITS}"
if [ "$DATA_HITS" -ne 0 ]; then
  echo "FAIL: le dump contient des données ou des rôles." >&2
  exit 3
fi

if grep -nEi '(password|secret|api[_-]?key|private key|BEGIN [A-Z ]*PRIVATE KEY)' "$OUT"; then
  echo "REVIEW: motifs sensibles détectés. Inspection humaine obligatoire." >&2
  [ "${ALLOW_REVIEW:-0}" = "1" ] || exit 4
fi

if grep -nE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' "$OUT"; then
  echo "REVIEW: adresses e-mail potentielles dans le dump." >&2
fi

echo "  sha256 : $(sha256sum "$OUT" | awk '{print $1}')"
echo "  lignes : $(wc -l < "$OUT")"
echo "PASS: dump structurel généré. Ne pas restaurer avant revue de preflight-export.sql."
