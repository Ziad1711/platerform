# B13 - enveloppe sure autour du pilote : validation de cible, etat persistant,
# restauration inconditionnelle des triggers et nettoyage, meme en cas d'echec.
param(
  [string]$Service = 'b13-isolated',
  [string]$Project = 'biqrgdopcvkrbgfxkzxm',
  [string]$Owner = '',
  [string]$OutDir  = 'C:\Users\HP-EXE\Documents\JISRA-QA\P79-B13-export\warmup-safe',
  [int]$Iterations = 20,
  [int]$ImportBatch = 20,
  [int]$ImportRounds = 2,
  [switch]$InjectFailureAfterMutation
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'b13-common.ps1')

if ($Service -ne 'b13-isolated') { throw 'B13_SERVICE_REQUIRED' }
if ($Project -ne 'biqrgdopcvkrbgfxkzxm') { throw 'B13_PROJECT_REQUIRED' }
if ([string]::IsNullOrWhiteSpace($Owner)) { throw 'B13_OWNER_REQUIRED' }

$env:PGSERVICEFILE = "$env:APPDATA\postgresql\pg_service.conf"
$env:PGPASSFILE     = "$env:APPDATA\postgresql\pgpass.conf"
$psql  = 'C:\Users\HP-EXE\Tools\pg17\pgsql\bin\psql.exe'
$bench = Join-Path $PSScriptRoot 'run_bench.ps1'
if (-not (Test-Path -LiteralPath $psql))  { throw "psql introuvable : $psql" }
if (-not (Test-Path -LiteralPath $bench)) { throw "pilote introuvable : $bench" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$stateFile = Join-Path $OutDir 'run-state.json'

function Set-State([hashtable]$h) {
  $tmp = "$stateFile.tmp"
  ($h | ConvertTo-Json -Depth 4) | Set-Content -Path $tmp -Encoding utf8
  Move-Item -Force -Path $tmp -Destination $stateFile
}

function Sql([string]$q, [string]$name = 'query') {
  return Invoke-B13Scalar -Psql $psql -Service $Service -Sql $q -OutDir $OutDir -Name $name
}

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

  $runToken = [guid]::NewGuid().ToString('N')
  $env:B13_WRAPPER_TOKEN = $runToken
  $benchLog = Join-Path $OutDir 'bench.log'
  $benchErr = Join-Path $OutDir 'bench.err.log'
  $benchArgs = @(
    '-NoProfile','-ExecutionPolicy','Bypass','-File',(Quote-NativeArg $bench),
    '-Service',(Quote-NativeArg $Service),'-Project',(Quote-NativeArg $Project),
    '-Owner',(Quote-NativeArg $Owner),'-Iterations',"$Iterations",
    '-ImportBatch',"$ImportBatch",'-ImportRounds',"$ImportRounds",
    '-Rounds','1','-StartRound','1','-OutDir',(Quote-NativeArg (Join-Path $OutDir 'bench')),
    '-WrapperToken',(Quote-NativeArg $runToken),'-ProtectedBy','run_warmup_safe'
  )
  if ($InjectFailureAfterMutation) { $benchArgs += '-InjectFailureAfterVariant' }
  $benchProc = Start-B13Process -FilePath 'powershell.exe' -ArgumentString ($benchArgs -join ' ') `
    -StdOut $benchLog -StdErr $benchErr
  $benchExit = $benchProc.ExitCode

  $reportFile = Get-ChildItem -LiteralPath (Join-Path $OutDir 'bench') -Filter 'b13-*.json' `
    -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($InjectFailureAfterMutation) {
    if ($benchExit -eq 0) { throw 'injection demandee mais le pilote a reussi' }
    throw "echec injecte attendu (exit=$benchExit) - voir $benchLog et $benchErr"
  }
  if ($benchExit -ne 0 -and $benchExit -ne 2) {
    throw "pilote en echec (exit=$benchExit) - voir $benchLog et $benchErr"
  }
  if (-not $reportFile) {
    throw "pilote sans rapport JSON (exit=$benchExit) - voir $benchLog et $benchErr"
  }
  $report = Get-Content -LiteralPath $reportFile.FullName -Raw | ConvertFrom-Json
  $result = 'completed:' + $report.verdict
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
    Write-B13Text $restoreSql ("select public.p79_bench_restore_triggers('" + $literal + "');")
    try {
      Invoke-B13File -Psql $psql -Service $Service -SqlFile $restoreSql `
        -OutDir $OutDir -Name 'restore-triggers' | Out-Null
      $restored = $true
    } catch {
      Write-Output "RESTAURATION EN ECHEC : $($_.Exception.Message)"
    }
  }

  $teardownSql = Join-Path $OutDir 'teardown.sql'
  Write-B13Text $teardownSql 'select public.p79_bench_teardown();'
  try {
    Invoke-B13File -Psql $psql -Service $Service -SqlFile $teardownSql `
      -OutDir $OutDir -Name 'teardown' | Out-Null
  } catch {
    $result = 'error: teardown - ' + $_.Exception.Message
  }

  $after = Sql "select p79_bench_capture_triggers()" 'capture-after'
  $counts = Sql "select (select count(*) from public.orders where store_id = '7f000000-0000-4000-8000-0000000000b1') || '|' || (select count(*) from public.order_items where store_id = '7f000000-0000-4000-8000-0000000000b1') || '|' || (select count(*) from public.dashboard_kpi_invalidation where store_id = '7f000000-0000-4000-8000-0000000000b1') || '|' || (select count(*) from public.stores where id = '7f000000-0000-4000-8000-0000000000b1')" 'counts-after'
  $triggersIdentical = ($after -eq $initial)
  $residual = ($counts -ne '0|0|0|0')
  if (-not $triggersIdentical -or $residual) {
    $result = 'error: restauration non conforme'
  }
  Set-State @{ target = $Project; phase = 'restored'; mutated = $mutated; result = $result
               triggers_initial = $initial; triggers_after = $after
               restored = $restored; triggers_identical = $triggersIdentical
               counts = $counts; residual = $residual; finished_at = (Get-Date).ToString('o') }

  Write-Output "restauration=$restored"
  Write-Output "triggers_identiques=$triggersIdentical"
  Write-Output "counts(orders|items|events|stores)=$counts"
  Write-Output "resultat=$result"
}

if ($result -like 'error:*' -or -not $restored -or $residual) { exit 2 }
