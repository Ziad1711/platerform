#!/usr/bin/env bash
# =============================================================================
# Prévalidation de connexion — LECTURE SEULE (aucune écriture, aucune migration).
#
#   1. résolution des binaires psql / pg_dump (PATH, puis installation locale) ;
#   2. garde d'hôte : endpoint DIRECT (aucun "-pooler") ;
#   3. TLS vérifié (sslmode=verify-full + bundle CA lisible) ;
#   4. identité, version, attributs du rôle ;
#   5. session épinglée (détection de pooler) ;
#   6. prévol SQL complet (00_preflight.sql).
#
# Modes :
#   * hors ligne (PGHOST/PGDATABASE absents) : seuls les outils sont vérifiés,
#     les contrôles réseau sont marqués SKIP — le script sort 0 ;
#   * en ligne : tous les contrôles sont bloquants.
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
skip() { echo "SKIP  $*"; }

# --- Résolution des binaires (PATH, sinon installation locale documentée) ----
PGCLIENT_BIN="${PGCLIENT_BIN:-$HOME/AppData/Local/pgclient/pgsql/bin}"

resolve_bin() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then command -v "$name"; return 0; fi
  if [ -x "$PGCLIENT_BIN/$name.exe" ]; then printf '%s' "$PGCLIENT_BIN/$name.exe"; return 0; fi
  if [ -x "$PGCLIENT_BIN/$name" ]; then printf '%s' "$PGCLIENT_BIN/$name"; return 0; fi
  return 1
}

PSQL_BIN="$(resolve_bin psql || true)"
PGDUMP_BIN="$(resolve_bin pg_dump || true)"

ONLINE=1
if [ -z "${PGHOST:-}" ] || [ -z "${PGDATABASE:-}" ]; then
  ONLINE=0
fi

echo "=== 1. Outils clients ==="
if [ -n "$PSQL_BIN" ]; then
  ok "psql : $("$PSQL_BIN" --version 2>/dev/null) [${PSQL_BIN}]"
else
  ko "psql introuvable (PATH ni $PGCLIENT_BIN) — voir connection/INSTALL_CLIENT.md"
fi
if [ -n "$PGDUMP_BIN" ]; then
  ok "pg_dump : $("$PGDUMP_BIN" --version 2>/dev/null) [${PGDUMP_BIN}]"
else
  info "pg_dump absent — requis uniquement pour produire l'export de schéma"
fi

echo
echo "=== 2. Garde d'hôte (connexion directe) ==="
if [ "$ONLINE" -eq 0 ]; then
  skip "PGHOST/PGDATABASE absents : contrôles réseau non exécutés (mode hors ligne)"
elif printf '%s' "$PGHOST" | grep -qi -- '-pooler'; then
  ko "PGHOST contient '-pooler' : endpoint mutualisé, verrous de session non fiables"
else
  ok "hôte direct : $PGHOST (aucun suffixe -pooler)"
fi

echo
echo "=== 3. TLS ==="
if [ "$ONLINE" -eq 0 ]; then
  skip "mode hors ligne"
else
  if [ "${PGSSLMODE:-}" = "verify-full" ]; then
    ok "sslmode=verify-full"
  else
    ko "sslmode='${PGSSLMODE:-}' — verify-full exigé"
  fi
  if [ -n "${PGSSLROOTCERT:-}" ] && [ -r "${PGSSLROOTCERT}" ]; then
    ok "bundle CA lisible : $PGSSLROOTCERT"
  else
    ko "PGSSLROOTCERT absent ou illisible : verify-full échouera"
  fi

  # Vérification cryptographique indépendante de libpq.
  # `pg_stat_ssl` n'est PAS probant chez Neon : l'endpoint termine le TLS au
  # proxy, la liaison proxy→backend est interne et apparaît sans TLS.
  if command -v openssl >/dev/null 2>&1 && [ -r "${PGSSLROOTCERT:-/nonexistent}" ]; then
    TLS_OUT="$(echo | openssl s_client -starttls postgres \
        -connect "${PGHOST}:${PGPORT:-5432}" -servername "$PGHOST" \
        -CAfile "$PGSSLROOTCERT" -verify_hostname "$PGHOST" \
        -verify_return_error 2>&1 || true)"
    if printf '%s' "$TLS_OUT" | grep -q 'Verify return code: 0 (ok)'; then
      TLS_PROTO="$(printf '%s' "$TLS_OUT" | grep -m1 '^Protocol:' | cut -d: -f2 | tr -d ' ')"
      TLS_CN="$(printf '%s' "$TLS_OUT" | grep -m1 '^subject=' | cut -d= -f2-)"
      ok "TLS vérifié (chaîne + nom d'hôte) — ${TLS_PROTO:-?} — $TLS_CN"
    else
      ko "TLS non vérifié (chaîne de certification ou nom d'hôte)"
    fi
  else
    info "openssl indisponible : vérification TLS limitée à sslmode=verify-full"
  fi
fi

echo
echo "=== 4. Identité et privilèges (lecture seule) ==="
if [ "$ONLINE" -eq 0 ] || [ -z "$PSQL_BIN" ]; then
  skip "mode hors ligne"
else
  if ! "$PSQL_BIN" --no-psqlrc --quiet --set=ON_ERROR_STOP=1 -c "
      select current_database() as base, current_user as role,
             current_setting('server_version') as version,
             pg_is_in_recovery() as replica,
             (select ssl from pg_stat_ssl where pid = pg_backend_pid()) as tls,
             (select rolsuper or rolbypassrls from pg_roles where rolname = current_user) as bypass_rls;"; then
    ko "connexion impossible (hôte, TLS, mot de passe ou rôle)"
  else
    ok "connexion établie"
  fi
fi

echo
echo "=== 5. Épinglage de session (informatif) ==="
if [ "$ONLINE" -eq 0 ] || [ -z "$PSQL_BIN" ]; then
  skip "mode hors ligne"
else
  # Deux transactions dans UNE session : même backend = session épinglée.
  # Non discriminant chez Neon (le proxy garde la connexion serveur au repos) :
  # seul le nom d'hôte, testé en §2, fait foi.
  PIDS="$("$PSQL_BIN" --no-psqlrc -tA -c 'select pg_backend_pid()' \
            -c 'select pg_backend_pid()' 2>/dev/null | tr -d '\r')"
  FIRST="$(printf '%s\n' "$PIDS" | sed -n 1p)"
  SECOND="$(printf '%s\n' "$PIDS" | sed -n 2p)"
  if [ -n "$FIRST" ] && [ "$FIRST" = "$SECOND" ]; then
    info "même backend sur deux transactions ($FIRST) — non probant chez Neon"
  else
    info "backends différents ($FIRST/$SECOND) — signe possible de pooler"
  fi
fi

echo
echo "=== 6. Prévol SQL complet (lecture seule) ==="
if [ "$ONLINE" -eq 0 ] || [ -z "$PSQL_BIN" ]; then
  skip "mode hors ligne"
elif [ -n "${AUDIT_URL:-}" ]; then
  if "$PSQL_BIN" "$AUDIT_URL" --no-psqlrc --quiet --set=ON_ERROR_STOP=1 -f "$HERE/sql/00_preflight.sql"; then
    ok "prévol exécuté (lire PASS/FAIL ci-dessus)"
  else
    ko "prévol en échec"
  fi
else
  ko "AUDIT_URL absent"
fi

echo
echo "=== Résultat ==="
if [ "$FAIL" -eq 0 ]; then
  if [ "$ONLINE" -eq 0 ]; then
    echo "PREVALIDATION: OK (outils) — contrôles réseau en attente des informations de connexion"
  else
    echo "PREVALIDATION: OK (aucune écriture effectuée)"
  fi
  exit 0
fi
echo "PREVALIDATION: $FAIL contrôle(s) en échec — voir PROTOCOL.md §2"
exit 1
