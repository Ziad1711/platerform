#!/usr/bin/env bash
set -u
export PGSERVICEFILE="C:/Users/HP-EXE/AppData/Roaming/postgresql/pg_service.conf"
PSQL="$HOME/Tools/pg17/pgsql/bin/psql.exe"
cd "$(dirname "$0")"
run_one() {
  local r="$1" v="$2"
  "$PSQL" -X -w -v ON_ERROR_STOP=1 "service=b13-isolated" -v variant="$v" -f variant.sql > "out/tail-${r}-${v}.var.log" 2>&1 || { echo "VARIANT_FAIL $r $v"; return 1; }
  "$PSQL" -X -w -v ON_ERROR_STOP=1 "service=b13-isolated" -v iters=400 -v rounds=0 -v large=600 -f bench.sql > "out/tail-${r}-${v}.log" 2>&1 || { echo "BENCH_FAIL $r $v"; return 1; }
  echo "done tail $r $v $(date +%H:%M:%S)"
}
for v in A C0 CF; do run_one 4 "$v" || exit 1; done
for v in CF C0 A; do run_one 5 "$v" || exit 1; done
echo TAIL_DONE
