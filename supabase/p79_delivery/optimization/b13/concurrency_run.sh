#!/usr/bin/env bash
# P7.10 : scenarios de concurrence reelle sur B13 (sessions paralleles).
set -u
export PGSERVICEFILE="C:/Users/HP-EXE/AppData/Roaming/postgresql/pg_service.conf"
PSQL="$HOME/Tools/pg17/pgsql/bin/psql.exe"
cd "$(dirname "$0")"
mkdir -p out
A1=7e000000-0000-4000-8000-0000000000a1
A2=7e000000-0000-4000-8000-0000000000a2
FAILED=0
P() { "$PSQL" -X -w -At -v ON_ERROR_STOP=1 "service=b13-isolated" "$@"; }
chk() {
  if [ "$1" = "$2" ]; then echo "PASS $3 (=$1)"; else echo "FAIL $3 (attendu=$2 obtenu=$1)"; FAILED=$((FAILED+1)); fi
}
chkge() {
  if [ "${1:-0}" -ge "$2" ] 2>/dev/null; then echo "PASS $3 (>=$1)"; else echo "FAIL $3 (attendu>=$2 obtenu=$1)"; FAILED=$((FAILED+1)); fi
}

DL0=$(P -c "select p710_deadlocks()")

# --- S1 : evenement tardif entre claim et acquittement ---------------------
P -c "select p710_reset_ev()" > /dev/null
P -c "select p710_mk_order('$A1','2035-01-04','S1 initial')" > /dev/null
P -c "select p710_cycle_slow(3)" > out/s1-cycle.json 2>&1 &
sleep 1
P -c "select p710_mk_order('$A1','2035-01-04','S1 tardif')" > /dev/null
wait
chk "$(P -c "select p710_pending('$A1','2035-01-04')")" "1" "S1_late_event_pending"
P -c "select p710_drain()" > /dev/null
chk "$(P -c "select p710_pending('$A1','2035-01-04')")" "0" "S1_drained"
chk "$(P -c "select p710_agg('$A1','2035-01-04')")" "2" "S1_aggregate_two_orders"

# --- S2 : ecritures pendant un cycle de rebuild ----------------------------
P -c "select p710_reset_ev()" > /dev/null
P -c "select p710_mk_order('$A1','2035-01-05','S2 base')" > /dev/null
P -c "select p710_cycle_slow(2)" > out/s2-cycle.json 2>&1 &
sleep 0.4
for i in 1 2 3 4 5 6; do P -c "select p710_write_one('$A1','2035-01-05',$i)" > /dev/null 2>&1 & done
wait
chkge "$(P -c "select p710_pending_total()")" 1 "S2_writes_registered"
P -c "select p710_drain()" > /dev/null
chk "$(P -c "select p710_pending_total()")" "0" "S2_drained"
chk "$(P -c "select p710_agg('$A1','2035-01-05')")" "1" "S2_aggregate_single_order"

# --- S3 : deux workers concurrents ----------------------------------------
P -c "update public.dashboard_kpi_worker_config set enabled = true where id = 1" > /dev/null
P -c "select p710_reset_ev()" > /dev/null
P -c "select p710_mk_order('$A1','2035-01-06','S3 a')" > /dev/null
P -c "select p710_mk_order('$A1','2035-01-07','S3 b')" > /dev/null
P -c "select stop_reason||'|'||partitions_rebuilt||'|'||partitions_failed from public.dashboard_kpi_worker_run('w1',10,1000,5)" > out/w1.txt 2>&1 &
P -c "select stop_reason||'|'||partitions_rebuilt||'|'||partitions_failed from public.dashboard_kpi_worker_run('w2',10,1000,5)" > out/w2.txt 2>&1 &
wait
W1=$(tr -d '\r\n' < out/w1.txt); W2=$(tr -d '\r\n' < out/w2.txt)
echo "INFO worker_runs w1=$W1 w2=$W2"
case "$W1$W2" in
  *concurrent_run*) echo "PASS S3_mutual_exclusion (concurrent_run observe)" ;;
  *) echo "INFO S3_no_overlap_observed (runs sequentiels)" ;;
esac
chk "$(P -c "select p710_pending_total()")" "0" "S3_backlog_drained"
chk "$(P -c "select p710_agg('$A1','2035-01-06')")" "1" "S3_aggregate_day06"
chk "$(P -c "select p710_agg('$A1','2035-01-07')")" "1" "S3_aggregate_day07"
P -c "update public.dashboard_kpi_worker_config set enabled = false where id = 1" > /dev/null

# --- S4 : deux transactions inserent la meme boutique/jour ---------------
P -c "select p710_reset_ev()" > /dev/null
P -c "select p710_bulk('$A1','2035-01-08',50,'S4a')" > out/s4a.txt 2>&1 &
P -c "select p710_bulk('$A1','2035-01-08',50,'S4b')" > out/s4b.txt 2>&1 &
wait
chk "$(P -c "select count(*) from public.dashboard_kpi_invalidation where store_id='$A1' and business_date='2035-01-08'")" "2" "S4_two_transactions_two_events"
P -c "select p710_drain()" > /dev/null
chk "$(P -c "select p710_agg('$A1','2035-01-08')")" "100" "S4_aggregate_100_orders"

# --- S5 : changement de boutique pendant un cycle -------------------------
P -c "select p710_reset_ev()" > /dev/null
ZID=$(P -c "select p710_mk_order('$A1','2035-01-09','S5')")
P -c "select p710_cycle_slow(3)" > out/s5-cycle.json 2>&1 &
sleep 1
P -c "update public.orders set store_id='$A2' where id='$ZID'" > /dev/null
wait
chkge "$(P -c "select count(*) from public.dashboard_kpi_invalidation where store_id='$A1' and business_date='2035-01-09' and processed_at is null")" 1 "S5_old_store_event_pending"
chkge "$(P -c "select count(*) from public.dashboard_kpi_invalidation where store_id='$A2' and business_date='2035-01-09' and processed_at is null")" 1 "S5_new_store_event_pending"
P -c "select p710_drain()" > /dev/null
chk "$(P -c "select p710_agg('$A1','2035-01-09')")" "0" "S5_old_store_aggregate_empty"
chk "$(P -c "select p710_agg('$A2','2035-01-09')")" "1" "S5_new_store_aggregate_one"

# --- Delta deadlocks ------------------------------------------------------
DL1=$(P -c "select p710_deadlocks()")
chk "$((DL1-DL0))" "0" "deadlock_delta"

echo "CONCURRENCY_FAILED=$FAILED"
