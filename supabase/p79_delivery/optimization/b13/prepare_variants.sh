#!/usr/bin/env bash
# Prepare les trois variantes de mesure (A, C0, CF) sur B13.
set -u
export PGSERVICEFILE="C:/Users/HP-EXE/AppData/Roaming/postgresql/pg_service.conf"
PSQL="$HOME/Tools/pg17/pgsql/bin/psql.exe"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
B13="$(dirname "$0")"
cd "$B13"
P() { "$PSQL" -X -w -At -v ON_ERROR_STOP=1 "service=b13-isolated" "$@"; }
P1() { "$PSQL" -X -w -At -1 -v ON_ERROR_STOP=1 "service=b13-isolated" "$@"; }

P -c "select public.dashboard_kpi_producer_arm(false)" > /dev/null 2>&1 || true
P -c "drop trigger if exists trg_kpi_invalidate_ad_spend on public.ad_spend_daily" \
  -c "drop trigger if exists trg_kpi_invalidate_order_items on public.order_items" \
  -c "drop trigger if exists trg_kpi_invalidate_orders on public.orders" \
  -c "drop trigger if exists trg_kpi_invalidate_orders_insert on public.orders" \
  -c "drop trigger if exists trg_kpi_invalidate_orders_quality on public.orders" \
  -c "drop trigger if exists trg_kpi_mark_order_insert on public.orders" > /dev/null

# Copie C0 (base Casablanca) puis copies de mesure.
P1 -c "set kpi.tz_compat_authorized='yes'" -f "$ROOT/../release/TZ-COMPAT-PATCH.sql" > /dev/null || exit 1
P -f capture/c0_mark.sql > /dev/null || exit 1
P -c "do \$\$ declare d text; begin
  d := pg_get_functiondef('public.dashboard_kpi_invalidate_trg()'::regprocedure); execute replace(d,'dashboard_kpi_invalidate_trg','p710_c0_invalidate_trg');
  d := pg_get_functiondef('public.dashboard_kpi_invalidate_insert_stmt()'::regprocedure); execute replace(d,'dashboard_kpi_invalidate_insert_stmt','p710_c0_invalidate_insert_stmt');
  d := pg_get_functiondef('public.dashboard_kpi_invalidate_orders_quality_trg()'::regprocedure); execute replace(d,'dashboard_kpi_invalidate_orders_quality_trg','p710_c0_quality_trg');
  d := pg_get_functiondef('public.dashboard_kpi_mark_order_insert()'::regprocedure); execute replace(d,'dashboard_kpi_mark_order_insert','p710_c0_mark_order_insert');
end \$\$" > /dev/null || exit 1

# Retour a P7.10 (producteurs optimises + worker resilient).
# La postcondition d installation exige une capture vierge : on retire
# temporairement l eligibilite des boutiques de fixtures.
P -c "delete from public.dashboard_kpi_producer_stores where store_id::text like '7e000000-%'" > /dev/null
P1 -c "set kpi.producers_opt_authorized='yes'" -f "$ROOT/10_install_producer_optimization.sql" > /dev/null || exit 1
P1 -c "set kpi.producers_opt_authorized='yes'" -f "$ROOT/11_worker_failure_resilience.sql" > /dev/null || exit 1
P1 -c "set kpi.producers_authorized='biqrgdopcvkrbgfxkzxm'" -c "set kpi.global_write_risk_accepted='yes'" \
  -f "$ROOT/20_activate_producers_optimized.sql" > /dev/null || exit 1
P -c "select public.dashboard_kpi_producer_enable_store('7e000000-0000-4000-8000-0000000000a1'::uuid, null, 'stab')" > /dev/null
P -c "select public.dashboard_kpi_producer_enable_store('7e000000-0000-4000-8000-0000000000a2'::uuid, null, 'stab')" > /dev/null
echo PREPARE_VARIANTS_OK
