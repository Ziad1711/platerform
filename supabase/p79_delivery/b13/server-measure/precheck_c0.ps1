# B13 — pre-vol obligatoire avant toute optimisation ou campagne.
# Lecture seule : aucune ecriture, aucun declencheur modifie.
param(
  [string]$Service = 'b13-isolated',
  [string]$ExpectedC0 = '2536fe3c58c8af6b18acb844ac585049',
  [int]$ExpectedTriggers = 6
)
$ErrorActionPreference = 'Continue'
$env:PGSERVICEFILE = "$env:APPDATA\postgresql\pg_service.conf"
$env:PGPASSFILE     = "$env:APPDATA\postgresql\pgpass.conf"
$psql = 'C:\Users\HP-EXE\Tools\pg17\pgsql\bin\psql.exe'
$svc  = "service=$Service"
$fails = @()
function Q([string]$q) { (& $psql -X -w -q $svc -A -t -c $q 2>$null | Out-String).Trim() }

# 1) Identite : le ref doit figurer dans l'identifiant de connexion du pooler.
$svcFile = Get-Content "$env:APPDATA\postgresql\pg_service.conf" -Raw
$block = ($svcFile -split [regex]::Escape("[$Service]"))[1]
if ($block -notmatch 'user=postgres\.biqrgdopcvkrbgfxkzxm') { $fails += 'IDENTITE: ref B13 absent du user' }
$db = Q "select current_database()"
if ($db -ne 'postgres') { $fails += "IDENTITE: current_database=$db" }

# 2) Empreinte C0.
$md5 = Q "select md5(pg_get_functiondef('public.dashboard_kpi_invalidate_insert_stmt()'::regprocedure))"
if ($md5 -ne $ExpectedC0) { $fails += "C0: md5=$md5 attendu=$ExpectedC0" }

# 3) Proprietes.
$prop = Q "select pg_get_userbyid(p.proowner) || '|' || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig,','),'-') || '|' || coalesce(p.proacl::text,'-') from pg_proc p where p.oid='public.dashboard_kpi_invalidate_insert_stmt()'::regprocedure"
if ($prop -notmatch '^postgres\|true\|search_path=public, pg_temp\|') { $fails += "PROPRIETES: $prop" }
if ($prop -match 'anon=|authenticated=') { $fails += "ACL: anon/authenticated present" }

# 4) Triggers.
$trg = [int](Q "select count(*) filter (where t.tgenabled='O') from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and t.tgname like 'trg_kpi_%'")
if ($trg -ne $ExpectedTriggers) { $fails += "TRIGGERS: $trg/$ExpectedTriggers actifs" }

# 5) Residus.
$res = Q "select (select count(*) from public.orders) || '|' || (select count(*) from public.order_items) || '|' || (select count(*) from public.dashboard_kpi_invalidation)"
if ($res -ne '0|0|0') { $fails += "RESIDUS: orders|items|events=$res" }

if ($fails.Count -gt 0) {
  Write-Output ('P79_PRECHECK_FAIL ' + ($fails -join ' ; '))
  exit 1
}
Write-Output "P79_PRECHECK_PASS c0=$md5 triggers=$trg db=$db"
