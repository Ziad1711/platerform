#!/usr/bin/env bash
# P7.10 : echec de rebuild sous verrou, backoff, absence de perte, reprise.
set -u
export PGSERVICEFILE="C:/Users/HP-EXE/AppData/Roaming/postgresql/pg_service.conf"
PSQL="$HOME/Tools/pg17/pgsql/bin/psql.exe"
cd "$(dirname "$0")"
mkdir -p out
A1=7e000000-0000-4000-8000-0000000000a1
FAILED=0
P() { "$PSQL" -X -w -At -v ON_ERROR_STOP=1 "service=b13-isolated" "$@"; }
chk() {
  if [ "$1" = "$2" ]; then echo "PASS $3 (=$1)"; else echo "FAIL $3 (attendu=$2 obtenu=$1)"; FAILED=$((FAILED+1)); fi
}
chkge() {
  if [ "${1:-0}" -ge "$2" ] 2>/dev/null; then echo "PASS $3 (>=$1)"; else echo "FAIL $3 (attendu>=$2 obtenu=$1)"; FAILED=$((FAILED+1)); fi
}

P -c "delete from public.dashboard_kpi_invalidation" > /dev/null
P -c "select p710_mk_order('$A1','2035-04-01','WF')" > /dev/null
P -c "update public.dashboard_kpi_worker_config set enabled = true where id = 1" > /dev/null
chk "$(P -c 'select count(*) from public.dashboard_kpi_invalidation where processed_at is null')" "1" "WF_single_pending_partition"

rm -f out/wf-lock.txt
P -c "begin" -c "select 1 from public.dashboard_kpi_store_state where store_id='$A1' for update" \
  -c "select 'LOCKED'" -c "select pg_sleep(10)" -c "commit" > out/wf-lock.txt 2>&1 &
LOCKPID=$!
for i in $(seq 1 100); do grep -q LOCKED out/wf-lock.txt 2>/dev/null && break; sleep 0.2; done
grep -q LOCKED out/wf-lock.txt || { echo "FAIL WF_lock_not_acquired"; FAILED=$((FAILED+1)); }

P -c "select stop_reason||'|'||partitions_failed from public.dashboard_kpi_worker_run('failtest',5,1000,15)" > out/wf-run.txt 2>&1
RUN=$(tr -d '\r\n' < out/wf-run.txt)
echo "INFO worker_run=$RUN"
chkge "${RUN#*|}" 1 "WF_failure_observed (stop=$RUN)"
chkge "$(P -c "select count(*) from public.dashboard_kpi_invalidation where store_id='$A1' and processed_at is null")" 1 "WF_event_not_lost"
chkge "$(P -c "select coalesce(max(attempts),0) from public.dashboard_kpi_invalidation where store_id='$A1' and processed_at is null")" 1 "WF_attempt_counted"
chkge "$(P -c "select count(*) from public.dashboard_kpi_invalidation where store_id='$A1' and processed_at is null and last_error is not null")" 1 "WF_error_recorded"
chkge "$(P -c "select count(*) from public.dashboard_kpi_invalidation where store_id='$A1' and processed_at is null and lease_expires_at > clock_timestamp()")" 1 "WF_backoff_set"

wait $LOCKPID
echo "INFO backoff wait"
sleep 7

P -c "select stop_reason||'|'||partitions_rebuilt||'|'||partitions_failed from public.dashboard_kpi_worker_run('recovery',10,5000,20)" > out/wf-recovery.txt 2>&1
REC=$(tr -d '\r\n' < out/wf-recovery.txt)
echo "INFO recovery_run=$REC"
chk "$(P -c "select count(*) from public.dashboard_kpi_invalidation where store_id='$A1' and processed_at is null")" "0" "WF_recovered_backlog_empty"
AGG=$(P -c "select coalesce((select m.orders_count::text from public.dashboard_daily_metrics m where m.store_id='$A1' and m.business_date='2035-04-01' and m.axis='order'),'ABSENT')")
DIR=$(P -c "select d.orders_count::text from public.dashboard_kpi_direct_day('$A1','2035-04-01','Africa/Casablanca') d")
chk "$AGG" "$DIR" "WF_aggregate_matches_direct"
P -c "update public.dashboard_kpi_worker_config set enabled = false where id = 1" > /dev/null

echo "WORKER_FAILURE_FAILED=$FAILED"
