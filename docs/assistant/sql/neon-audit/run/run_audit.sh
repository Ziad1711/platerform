#!/usr/bin/env bash
# =============================================================================
# Orchestrateur d'audit transactionnel — base PostgreSQL distante jetable
#
# Prérequis :
#   * psql (client seul) dans le PATH ;
#   * AUDIT_URL : URL complète, TLS vérifié (sslmode=verify-full) ;
#   * AUDIT_DB  : nom exact de la base jetable (garde de sûreté) ;
#   * schéma cible déjà restauré (voir DEPENDENCIES.md) et migrations
#     01→02→03b→05b appliquées dans CETTE base uniquement.
#
# N'exécute AUCUNE migration et ne touche AUCUNE base de production : toutes
# les commandes utilisent $AUDIT_URL.
# =============================================================================
set -euo pipefail

: "${AUDIT_URL:?AUDIT_URL manquant (postgresql://.../jisra_assistant_audit?sslmode=verify-full)}"
: "${AUDIT_DB:?AUDIT_DB manquant (nom exact de la base jetable)}"
export AUDIT_DB
export AUDIT_ENV="${AUDIT_ENV:-neon-audit}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGS="$HERE/run/logs"
mkdir -p "$LOGS"

PSQL=(psql "$AUDIT_URL" --set=ON_ERROR_STOP=1 --no-psqlrc --quiet)

step() { echo; echo "=== $* ==="; }

step "00 Prévol (identité, TLS, version, rôles, base vide)"
"${PSQL[@]}" -f "$HERE/sql/00_preflight.sql"

step "05 Rôles émulés + shim auth (idempotent)"
"${PSQL[@]}" -f "$HERE/sql/05_auth_shim.sql"

step "10 Harnais d'audit"
"${PSQL[@]}" -f "$HERE/sql/10_bootstrap_audit.sql"

step "20 Vérification du schéma cible"
"${PSQL[@]}" -f "$HERE/sql/20_verify_schema_ready.sql" | tee "$LOGS/schema_ready.log"

step "30 Fixtures synthétiques"
"${PSQL[@]}" -f "$HERE/sql/30_fixtures.sql" | tee "$LOGS/fixtures.log"

step "Scénarios séquentiels (R1,R3,R4,R7,R8,R9,R10,R11,S1,R13,R14)"
"${PSQL[@]}" -f "$HERE/scenarios/sequential.sql" | tee "$LOGS/sequential.log"

step "Concurrents R2/R6/R12 — sessions A et B"
# A doit détenir les barrières avant que B ne démarre : 3 s de décalage.
"${PSQL[@]}" -f "$HERE/scenarios/concurrent_a.sql" >"$LOGS/concurrent_a.log" 2>&1 &
A_PID=$!
sleep 3
"${PSQL[@]}" -f "$HERE/scenarios/concurrent_b.sql" >"$LOGS/concurrent_b.log" 2>&1 &
B_PID=$!
wait "$A_PID" || { echo "SESSION A en échec — voir $LOGS/concurrent_a.log"; exit 1; }
wait "$B_PID" || { echo "SESSION B en échec — voir $LOGS/concurrent_b.log"; exit 1; }

step "R5 Bail expirant pendant l'attente (≈130 s)"
"${PSQL[@]}" -f "$HERE/scenarios/lease_a.sql" >"$LOGS/lease_a.log" 2>&1 &
L_PID=$!
sleep 3
"${PSQL[@]}" -f "$HERE/scenarios/lease_b.sql" >"$LOGS/lease_b.log" 2>&1 &
LB_PID=$!
wait "$L_PID" || { echo "SESSION A (bail) en échec — voir $LOGS/lease_a.log"; exit 1; }
wait "$LB_PID" || { echo "SESSION B (bail) en échec — voir $LOGS/lease_b.log"; exit 1; }

step "90 Invariants, réconciliation et verdict"
"${PSQL[@]}" -f "$HERE/sql/90_assertions.sql" | tee "$LOGS/assertions.log"

step "Archivage des résultats"
"${PSQL[@]}" --command="\\copy (select case_name, status, sqlstate, detail, recorded_at from audit.results order by case_name) to '$LOGS/results.csv' csv header"

echo
echo "Preuves : $LOGS"
echo "Nettoyage : psql \$AUDIT_URL -f $HERE/sql/99_cleanup.sql (puis suppression du projet)"
