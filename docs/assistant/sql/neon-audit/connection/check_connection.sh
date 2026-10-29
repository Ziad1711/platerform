#!/usr/bin/env bash
# =============================================================================
# Prévalidation de connexion — LECTURE SEULE, aucune écriture, aucune migration.
#
# Vérifie :
#   1. présence de psql / pg_dump ;
#   2. garde d'hôte : endpoint DIRECT (aucun "-pooler") ;
#   3. TLS vérifié (sslmode=verify-full + bundle CA lisible) ;
#   4. identité de la base, version PostgreSQL, attributs du rôle ;
#   5. session épinglée (détection de pooler) ;
#   6. base vide (aucune donnée métier).
#
# Usage :
#   source ~/jisra-audit/env.local
#   bash docs/assistant/sql/neon-audit/connection/check_connection.sh
# =============================================================================
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAIL=0
ok()   { echo "PASS  $*"; }
ko()   { echo "FAIL  $*"; FAIL=$((FAIL + 1)); }
info() { echo "INFO  $*"; }

echo "=== 1. Outils clients ==="
if command -v psql >/dev/null 2>&1; then
  ok "psql disponible : $(psql --version 2>/dev/null)"
else
  ko "psql ABSENT (requis pour le protocole)"
fi
if command -v pg_dump >/dev/null 2>&1; then
  ok "pg_dump disponible : $(pg_dump --version 2>/dev/null)"
else
  info "pg_dump absent — nécessaire uniquement pour produire l'export de schéma, pas pour les tests"
fi

echo
echo "=== 2. Garde d'hôte (connexion directe) ==="
if [ -z "${PGHOST:-}" ]; then
  ko "PGHOST non défini (source env.local d'abord)"
elif printf '%s' "$PGHOST" | grep -qi -- '-pooler'; then
  ko "PGHOST contient '-pooler' : endpoint mutualisé, les verrous de session ne sont pas fiables"
else
  ok "hôte direct : $PGHOST (aucun suffixe -pooler)"
fi

echo
echo "=== 3. TLS ==="
if [ "${PGSSLMODE:-}" = "verify-full" ]; then
  ok "sslmode=verify-full"
else
  ko "sslmode='${PGSSLMODE:-}' — verify-full exigé (sinon dégradation à autoriser explicitement)"
fi
if [ -n "${PGSSLROOTCERT:-}" ] && [ -r "${PGSSLROOTCERT}" ]; then
  ok "bundle CA lisible"
else
  info "PGSSLROOTCERT absent ou illisible : verify-full échouera côté libpq"
fi

echo
echo "=== 4. Connexion et identité (lecture seule) ==="
if ! command -v psql >/dev/null 2>&1; then
  ko "connexion non testée (psql absent)"
else
  psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 -c "
    select current_database() as base,
           current_user as role,
           inet_server_addr() as adresse,
           current_setting('server_version') as version,
           pg_is_in_recovery() as replica,
           (select ssl from pg_stat_ssl where pid = pg_backend_pid()) as tls,
           (select version from pg_stat_ssl where pid = pg_backend_pid()) as tls_version,
           (select rolsuper or rolbypassrls from pg_roles where rolname = current_user) as bypass_rls;" \
    || { ko "connexion impossible"; }
fi

echo
echo "=== 5. Session épinglée (détection de pooler) ==="
if command -v psql >/dev/null 2>&1 && [ -n "${PGHOST:-}" ]; then
  P1=$(psql --no-psqlrc --quiet -tAc "select pg_backend_pid()" 2>/dev/null)
  P2=$(psql --no-psqlrc --quiet -tAc "select pg_backend_pid()" 2>/dev/null)
  if [ -n "$P1" ] && [ "$P1" = "$P2" ]; then
    ok "PID stable entre deux connexions ($P1) — comportement attendu en direct"
  else
    info "PID différents ($P1/$P2) : normal entre deux connexions distinctes ; le prévol SQL refait le test dans UNE session"
  fi
fi

echo
echo "=== 6. Prévol SQL complet (lecture seule) ==="
if command -v psql >/dev/null 2>&1; then
  if psql "$([ -n "${AUDIT_URL:-}" ] && printf '%s' "$AUDIT_URL" || printf '%s' "postgresql://${PGUSER:-}:${PGPASSWORD:-}@${PGHOST:-}:${PGPORT:-5432}/${PGDATABASE:-}")" \
        --no-psqlrc --quiet --set=ON_ERROR_STOP=1 -f "$HERE/sql/00_preflight.sql"; then
    ok "prévol exécuté (voir PASS/FAIL ci-dessus)"
  else
    ko "prévol en échec"
  fi
fi

echo
echo "=== Résultat ==="
if [ "$FAIL" -eq 0 ]; then
  echo "PREVALIDATION: OK (aucune écriture effectuée)"
  exit 0
fi
echo "PREVALIDATION: $FAIL contrôle(s) en échec — voir PROTOCOL.md §2"
exit 1
