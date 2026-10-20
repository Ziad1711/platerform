# B13 - enveloppe sure autour du pilote : validation de cible, etat persistant,
# restauration inconditionnelle des triggers et nettoyage, meme en cas d'echec.
param(
  [string]$Service = 'b13-isolated',
  [string]$Project = 'biqrgdopcvkrbgfxkzxm',
  [string]$OutDir  = 'C:\Users\HP-EXE\Documents\JISRA-QA\P79-B13-export\warmup-safe',
  [int]$Iterations = 20,
  [int]$ImportBatch = 20,
  [int]$ImportRounds = 2,
  [switch]$InjectFailureAfterMutation
)
$ErrorActionPreference = 'Stop'
$env:PGSERVICEFILE = "$env:APPDATA\postgresql\pg_service.conf"
$env:PGPASSFILE     = "$env:APPDATA\postgresql\pgpass.conf"
$psql  = 'C:\Users\HP-EXE\Tools\pg17\pgsql\bin\psql.exe'
$bench = 'C:\Users\HP-EXE\Documents\erp ecom\jisra-kpi-v5-consolidated\supabase\p79_delivery\b13\run_bench.ps1'
$svc   = "service=$Service"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$stateFile = Join-Path $OutDir 'run-state.json'

function Set-State([hashtable]$h) {
  $tmp = "$stateFile.tmp"
  ($h | ConvertTo-Json -Depth 4) | Set-Content -Path $tmp -Encoding utf8
  Move-Item -Force -Path $tmp -Destination $stateFile
}

function Sql([string]$q) { (& $psql -X -w $svc -A -t -c $q 2>$null | Out-String).Trim() }

# 1) Identite de la cible : seule preuve acceptee, avant toute mutation.
$identity = Sql "select current_database() || '|' || (select count(*) from public.stores)"
if ($identity -notlike 'postgres|*') { throw "identite de cible non confirmee : $identity" }

# 2) Etat initial capture (triggers) - echec => aucune mutation.
$initial = Sql "select p79_bench_capture_triggers()"
if ($initial -notlike '{*}') { throw "capture des triggers impossible : $initial" }

$tState  = 'validated'
$mutated = $false
$result  = 'pending'
Set-State @{ target = $Project; phase = $tState; mutated = $mutated; result = $result
             triggers_initial = $initial; started_at = (Get-Date).ToString('o') }

try {
  $mutated = $true
  Set-State @{ target = $Project; phase = 'mutating'; mutated = $mutated; result = 'pending'
               triggers_initial = $initial; started_at = (Get-Date).ToString('o') }

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $bench -Service $Service -Project $Project `
      -Iterations $Iterations -ImportBatch $ImportBatch -ImportRounds $ImportRounds `
      -Rounds 1 -StartRound 1 -OutDir (Join-Path $OutDir 'bench') *> (Join-Path $OutDir 'bench.log')
  $benchExit = $LASTEXITCODE

  if ($InjectFailureAfterMutation) { throw "ECHEC INJECTE APRES MUTATION (test de restauration)" }
  if ($benchExit -ne 0) { throw "pilote en echec (exit=$benchExit) - voir bench.log" }
  $result = 'ok'
}
catch {
  $result = 'error: ' + $_.Exception.Message
  Write-Output "ERREUR CAPTUREE : $result"
}
finally {
  # 3) Identite re-verifiee AVANT toute restauration.
  $restored = $false
  $id2 = Sql "select current_database() || '|' || (select count(*) from public.stores)"
  if ($id2 -notlike 'postgres|*') {
    Write-Output "RESTAURATION ANNULEE : identite non confirmee ($id2)"
  }
  else {
    # Transport sur par fichier SQL (aucun echappement de ligne de commande).
    $restoreSql = Join-Path $OutDir 'restore-triggers.sql'
    $literal = $initial.Replace("'", "''")
    Set-Content -Path $restoreSql -Encoding utf8 `
      -Value ("select public.p79_bench_restore_triggers('" + $literal + "');")
    & $psql -X -w $svc -v ON_ERROR_STOP=1 -f $restoreSql *> (Join-Path $OutDir 'restore.log')
    if ($LASTEXITCODE -eq 0) { $restored = $true }
    else { Write-Output 'RESTAURATION EN ECHEC - voir restore.log' }
  }
  & $psql -X -w $svc -c "select p79_bench_teardown()" *> (Join-Path $OutDir 'teardown.log')

  $after = Sql "select p79_bench_capture_triggers()"
  $counts = Sql "select (select count(*) from public.orders) || '|' || (select count(*) from public.order_items) || '|' || (select count(*) from public.dashboard_kpi_invalidation) || '|' || (select count(*) from public.stores)"
  Set-State @{ target = $Project; phase = 'restored'; mutated = $mutated; result = $result
               triggers_initial = $initial; triggers_after = $after
               restored = $restored; counts = $counts; finished_at = (Get-Date).ToString('o') }

  Write-Output "restauration=$restored"
  Write-Output "triggers_identiques=$($after -eq $initial)"
  Write-Output "counts(orders|items|events|stores)=$counts"
  Write-Output "resultat=$result"
}
