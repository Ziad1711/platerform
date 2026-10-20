# B13 - campagne serveur par invocation, avec verification d etat apres CHAQUE tir.
param(
  [string]$Service   = 'b13-isolated',
  [string]$Owner     = 'c45355f3-6ab5-4dda-8861-d52e283bf163',
  [int]$N            = 100,
  [int]$ImportN      = 10,
  [int]$Reps         = 5,
  [string]$Kinds     = 'create_unit,update_rounding,update_subtotal,update_unrelated,import_bulk,import_loop',
  [string]$OutDir    = 'C:\Users\HP-EXE\Documents\JISRA-QA\P79-B13-export\server-campaign'
)
$ErrorActionPreference = 'Stop'
$env:PGSERVICEFILE = "$env:APPDATA\postgresql\pg_service.conf"
$env:PGPASSFILE     = "$env:APPDATA\postgresql\pgpass.conf"
$psql = 'C:\Users\HP-EXE\Tools\pg17\pgsql\bin\psql.exe'
$sql  = 'C:\Users\HP-EXE\Documents\erp ecom\jisra-kpi-v5-consolidated\supabase\p79_delivery\b13\server-measure\server_measure.sql'
$svc  = "service=$Service"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$csv = Join-Path $OutDir 'results.csv'
if (-not (Test-Path $csv)) { 'ts,kind,variant,rep,samples,mean_ms,median_ms,p95_ms,min_ms,max_ms' | Set-Content $csv -Encoding ascii }

function Log([string]$m) { Add-Content (Join-Path $OutDir 'campaign.log') ((Get-Date).ToString('u') + ' ' + $m) -Encoding ascii }
function Q([string]$q) { (& $psql -X -w $svc -A -t -c $q 2>$null | Out-String).Trim() }

$id = Q "select current_database() || '|' || (select count(*) from public.stores)"
if ($id -notlike 'postgres|*') { throw "identite non confirmee : $id" }
$dl0 = [long](Q "select coalesce(sum(deadlocks),0) from pg_stat_database where datname=current_database()")
Log "campagne demarree identite=$id deadlocks0=$dl0"

$allowedKinds = @('create_unit','update_rounding','update_subtotal','update_unrelated','import_bulk','import_loop')
$kindList = @($Kinds.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
if ($kindList.Count -eq 0) { throw 'P79_BAD_KINDS_EMPTY' }
foreach ($k in $kindList) {
  if ($allowedKinds -notcontains $k) { throw "P79_BAD_KIND_PARAM: $k" }
}
if (($kindList | Sort-Object -Unique).Count -ne $kindList.Count) { throw 'P79_BAD_KINDS_DUPLICATE' }
Log ("scenarios demandes = " + ($kindList -join ','))

foreach ($kind in $kindList) {
  $n = if ($kind -like 'import_*') { $ImportN } else { $N }
  for ($rep = 1; $rep -le $Reps; $rep++) {
    $order = if ($rep % 2 -eq 1) { @('A','C') } else { @('C','A') }
    foreach ($v in $order) {
      $log = Join-Path $OutDir ("$kind-$v-r$rep.log")
      & $psql -X -w $svc -v ON_ERROR_STOP=1 --single-transaction `
        -c "set p79.bench_env='isolated'" -c "set p79.bench_confirm='SCHEDULED-ISOLATED-RUN'" `
        -c "set p79.bench_project='biqrgdopcvkrbgfxkzxm'" -c "set p79.bench_allow='biqrgdopcvkrbgfxkzxm'" `
        -c "set p79.bench_owner='$Owner'" -c "set p79.bench_variant='$v'" `
        -v kind=$kind -v n=$n -f $sql 1> $log 2> ($log + '.err')
      $code = $LASTEXITCODE

      $st = Q "select count(*) filter (where t.tgenabled='O') || '|' || (select count(*) from public.orders) || '|' || (select count(*) from public.order_items) || '|' || (select count(*) from public.dashboard_kpi_invalidation) from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and t.tgname like 'trg_kpi_%'"
      if ($st -ne '6|0|0|0') {
        Log "ETAT INCERTAIN apres $kind/$v/r$rep : $st - ARRET"
        throw "etat incertain apres $kind/$v/r$rep : $st"
      }
      if ($code -ne 0) {
        Log "ECHEC $kind/$v/r$rep exit=$code (etat propre) - ARRET"
        throw "echec $kind/$v/r$rep exit=$code"
      }

      $line = Select-String -Path $log -Pattern "^\s*$kind\s*\|\s*$v\s*\|" | Select-Object -First 1
      if (-not $line) { Log "MESURE ABSENTE $kind/$v/r$rep - ARRET"; throw "mesure absente $kind/$v/r$rep" }
      $p = ($line.Line -split '\|') | ForEach-Object { $_.Trim() }
      $rec = (Get-Date).ToString('s') + ",$kind,$v,$rep," + ($p[2..7] -join ',')
      Add-Content $csv $rec -Encoding ascii
      Log "OK $kind/$v/r$rep median=$($p[4]) p95=$($p[5])"
    }
  }
}

$dl1 = [long](Q "select coalesce(sum(deadlocks),0) from pg_stat_database where datname=current_database()")
Log "campagne terminee deadlocks1=$dl1 delta=$($dl1 - $dl0)"
'TERMINE' | Set-Content (Join-Path $OutDir 'DONE') -Encoding ascii
