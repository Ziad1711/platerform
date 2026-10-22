#!/usr/bin/env bash
set -u
export PGSERVICEFILE="C:/Users/HP-EXE/AppData/Roaming/postgresql/pg_service.conf"
PSQL="$HOME/Tools/pg17/pgsql/bin/psql.exe"
cd "$(dirname "$0")"
mkdir -p out
run_one() {
  local r="$1" v="$2" tag="$3"
  "$PSQL" -X -w -v ON_ERROR_STOP=1 "service=b13-isolated" -v variant="$v" -f variant.sql > "out/${tag}-${v}.var.log" 2>&1 || { echo "VARIANT_FAIL $tag $v"; return 1; }
  "$PSQL" -X -w -v ON_ERROR_STOP=1 "service=b13-isolated" -v iters=100 -v rounds=20 -v large=600 -f bench.sql > "out/${tag}-${v}.log" 2>&1 || { echo "BENCH_FAIL $tag $v"; return 1; }
  echo "done $tag $v $(date +%H:%M:%S)"
}
run_one 0 A warmup || exit 1
for r in 1 2 3; do
  if [ $((r % 2)) -eq 1 ]; then order="A C0 CF"; else order="CF C0 A"; fi
  for v in $order; do
    run_one "$r" "$v" "perf-$r" || exit 1
  done
done
echo CAMPAIGN_DONE
