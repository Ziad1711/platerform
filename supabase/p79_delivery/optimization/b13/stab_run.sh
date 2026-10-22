#!/usr/bin/env bash
set -u
export PGSERVICEFILE="C:/Users/HP-EXE/AppData/Roaming/postgresql/pg_service.conf"
PSQL="$HOME/Tools/pg17/pgsql/bin/psql.exe"
cd "$(dirname "$0")"
mkdir -p out
P() { "$PSQL" -X -w -At -v ON_ERROR_STOP=1 "service=b13-isolated" "$@"; }
for r in 1 2; do
  if [ $((r % 2)) -eq 1 ]; then order="A C0 CF"; else order="CF C0 A"; fi
  for v in $order; do
    P -v variant="$v" -f variant.sql > /dev/null 2>&1 || { echo "VARIANT_FAIL $r $v"; exit 1; }
    P -v iters=40 -f stab_bench.sql > "out/stab-${r}-${v}.log" 2>&1 || { echo "BENCH_FAIL $r $v"; exit 1; }
    echo "done stab $r $v $(date +%H:%M:%S)"
  done
done
echo STAB_DONE
