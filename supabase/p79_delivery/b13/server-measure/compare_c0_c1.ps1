# B13 — campagne comparative C0/C1 (3 scenarios), avec restauration garantie.
# Securite : precheck C0, detection de campagne interrompue, try/finally,
# verification d'empreinte apres restauration.
param(
  [string]$Service = 'b13-isolated',
  [string]$OutDir = 'C:\Users\HP-EXE\Documents\JISRA-QA\P79-B13-export\perf-c1',
  [string]$C0 = '2536fe3c58c8af6b18acb844ac585049',
  [string]$C1 = '578763df7d0c7431f626ba87429e0f2f',
  [int]$Reps = 5,
  [int]$N = 100,
  [int]$Batches = 10,
  [int]$Size = 200
)
$ErrorActionPreference = 'Continue'
$env:PGSERVICEFILE = "$env:APPDATA\postgresql\pg_service.conf"
$env:PGPASSFILE     = "$env:APPDATA\postgresql\pgpass.conf"
$base = 'C:\Users\HP-EXE\Documents\erp ecom\jisra-kpi-v5-consolidated\supabase\p79_delivery\b13\server-measure'
$psql = 'C:\Users\HP-EXE\Tools\pg17\pgsql\bin\psql.exe'
$svc  = "service=$Service"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
function Log([string]$m) { Add-Content (Join-Path $OutDir 'compare.log') ((Get-Date).ToString('u') + ' ' + $m) -Encoding ascii }
function Md5() { (& $psql -X -w -q $svc -A -t -c "select md5(pg_get_functiondef('public.dashboard_kpi_invalidate_insert_stmt()'::regprocedure))" 2>$null | Out-String).Trim() }
function Clean() {
  $r = (& $psql -X -w -q $svc -A -t -c "select (select count(*) from public.orders) || '|' || (select count(*) from public.order_items) || '|' || (select count(*) from public.dashboard_kpi_invalidation) || '|' || (select count(*) from public.stores)" 2>$null | Out-String).Trim()
  return ($r -eq '0|0|0|0')
}
function Set-C0() {
  & $psql -X -w -q $svc -v ON_ERROR_STOP=1 --single-transaction -f (Join-Path $base 'opt1\c0-reference.sql') *> $null
  & $psql -X -w -q $svc -c "revoke all on function public.dashboard_kpi_invalidate_insert_stmt() from public, anon, authenticated;" *> $null
  & $psql -X -w -q $svc -c "grant execute on function public.dashboard_kpi_invalidate_insert_stmt() to service_role;" *> $null
  return (Md5)
}

# 1) Precheck strict.
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $base 'precheck_c0.ps1') -Service $Service *> (Join-Path $OutDir 'precheck.log')
if ($LASTEXITCODE -ne 0) { Log 'PRECHECK_FAIL - arret avant ecriture'; exit 2 }

# 2) Campagne precedente interrompue ?
$current = Md5
Log "demarrage md5=$current c0=$C0 c1=$C1"
if ($current -eq $C1) { Log 'C1 DEJA INSTALLEE (campagne interrompue) - recuperation controlee requise'; exit 3 }
if ($current -ne $C0) { Log "EMPREINTE INCONNUE ($current) - arret"; exit 4 }
if (-not (Clean)) { Log 'RESIDUS PRESENTS - arret'; exit 5 }

$kinds = 'create_unit,import_bulk,import_loop'
$ok = $false
try {
  Log '--- mesures C0 ---'
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $base 'run_campaign_v2.ps1') `
      -Service $Service -OutDir (Join-Path $OutDir 'c0') -Kinds $kinds -Reps $Reps -N $N -Batches $Batches -Size $Size
  if ($LASTEXITCODE -ne 0) { throw 'CAMPAGNE_C0_ECHEC' }
  if (-not (Clean)) { throw 'RESIDUS_APRES_C0' }
  if ((Md5) -ne $C0) { throw 'C0_MODIFIEE_APRES_MESURES' }

  Log '--- application C1 ---'
  & $psql -X -w -q $svc -v ON_ERROR_STOP=1 --single-transaction -f (Join-Path $base 'opt1\c1-optimized.sql') *> (Join-Path $OutDir 'c1-apply.log')
  if ($LASTEXITCODE -ne 0) { throw 'C1_APPLICATION_ECHEC' }
  $m1 = Md5
  if ($m1 -ne $C1) { throw "C1_EMPREINTE_INATTENDUE ($m1)" }
  Log "C1 installee md5=$m1"

  Log '--- mesures C1 ---'
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $base 'run_campaign_v2.ps1') `
      -Service $Service -OutDir (Join-Path $OutDir 'c1') -Kinds $kinds -Reps $Reps -N $N -Batches $Batches -Size $Size
  if ($LASTEXITCODE -ne 0) { throw 'CAMPAGNE_C1_ECHEC' }
  if (-not (Clean)) { throw 'RESIDUS_APRES_C1' }
  $ok = $true
}
catch {
  Log ('ECHEC: ' + $_.Exception.Message)
}
finally {
  $after = Set-C0
  Log "restauration C0 md5=$after"
  if ($after -ne $C0) { Log 'RESTAURATION_NON_CONFORME - arret'; exit 6 }
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $base 'precheck_c0.ps1') -Service $Service *> (Join-Path $OutDir 'precheck-final.log')
  Log ('precheck final exit=' + $LASTEXITCODE)
}
if ($ok) { Log 'CAMPAGNE_COMPLETE'; 'TERMINE' | Set-Content (Join-Path $OutDir 'DONE') -Encoding ascii }
else { Log 'CAMPAGNE_INCOMPLETE' }
