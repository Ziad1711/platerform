# P7.9 - Pilote B13 apparie (v3). ENVIRONNEMENT ISOLE UNIQUEMENT.
# Aucun secret : service PostgreSQL local deja configure.
# psql est invoque via Start-Process avec des arguments explicitement quotes,
# compatible Windows PowerShell 5.1 et chemins contenant des espaces.
param(
  [string]$Service   = 'b13-isolated',
  [string]$Project   = 'biqrgdopcvkrbgfxkzxm',
  [string]$Owner     = '',
  [int]$Iterations   = 100,
  [int]$ImportBatch  = 200,
  [int]$ImportRounds = 10,
  [int]$Rounds       = 3,
  [int]$StartRound   = 1,
  [string]$OutDir    = "$PSScriptRoot\out",
  [string]$WrapperToken = '',
  [string]$ProtectedBy  = '',
  [switch]$InjectFailureAfterVariant
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'b13-common.ps1')

$psql = Join-Path $HOME 'Tools\pg17\pgsql\bin\psql.exe'
if (-not (Test-Path -LiteralPath $psql)) { throw "psql introuvable : $psql" }
if ($Service -ne 'b13-isolated') { throw 'B13_SERVICE_REQUIRED' }
if ($Project -ne 'biqrgdopcvkrbgfxkzxm') { throw 'B13_PROJECT_REQUIRED' }
if ([string]::IsNullOrWhiteSpace($Owner)) { throw 'B13_OWNER_REQUIRED' }
if ([string]::IsNullOrWhiteSpace($WrapperToken) -or $env:B13_WRAPPER_TOKEN -ne $WrapperToken) {
  throw 'B13_WRAPPER_REQUIRED : utiliser run_campaign.ps1 ou run_warmup_safe.ps1'
}
if (@('run_campaign','run_warmup_safe') -notcontains $ProtectedBy) {
  throw 'B13_WRAPPER_REQUIRED : appel direct non protege refuse'
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$sql = Join-Path $PSScriptRoot 'scenarios.sql'
$sectionsExpected = @{
  create_unit       = $Iterations
  update_rounding   = $Iterations
  update_subtotal   = $Iterations
  update_unrelated  = $Iterations
  import_bulk       = $ImportRounds
  import_loop       = $ImportRounds
}

function Invoke-Variant([string]$variant) {
  $log = Join-Path $OutDir ("log-" + $variant + "-" + [guid]::NewGuid().ToString('N').Substring(0,6) + ".txt")
  $err = $log + '.err'
  $argString = New-B13PsqlArgumentString -Service $Service -Project $Project -Owner $Owner `
    -Variant $variant -Iterations $Iterations -ImportBatch $ImportBatch `
    -ImportRounds $ImportRounds -SqlFile $sql
  $process = Start-B13Process -FilePath $psql -ArgumentString $argString -StdOut $log -StdErr $err
  if ($process.ExitCode -ne 0) {
    throw "Variante $variant : psql exit $($process.ExitCode) - voir $log et $err"
  }

  $parsed = Read-B13Log -LogPath $log
  $data = $parsed.Data
  $metrics = $parsed.Metrics
  foreach ($key in $sectionsExpected.Keys) {
    $expected = $sectionsExpected[$key]
    $count = if ($data.ContainsKey($key)) { $data[$key].Count } else { 0 }
    if ($count -ne $expected) {
      throw "Variante ${variant} / section ${key} : $count mesures au lieu de $expected (voir $log)"
    }
  }
  [pscustomobject]@{ Variant = $variant; Data = $data; Metrics = $metrics; Log = $log; Err = $err }
}

function Get-Percentile([double[]]$values, [double]$p) {
  if (-not $values -or $values.Count -eq 0) { return $null }
  $sorted = $values | Sort-Object
  $rank = [math]::Ceiling($p * $sorted.Count)
  if ($rank -lt 1) { $rank = 1 }
  return [double]$sorted[$rank - 1]
}

$budgets = Get-Content (Join-Path $PSScriptRoot 'thresholds.json') -Raw | ConvertFrom-Json

# Etat initial des six producteurs : capture AVANT toute modification.
$trigState = Invoke-B13Scalar -Psql $psql -Service $Service `
  -Sql 'select public.p79_bench_capture_triggers()' -OutDir $OutDir -Name 'capture-before'
if ([string]::IsNullOrWhiteSpace($trigState) -or $trigState -notlike '{*}') {
  throw 'capture de l etat des triggers impossible : campagne annulee'
}
Write-Output "etat initial captures : $trigState"

$deadlocksBase = [long](Invoke-B13Scalar -Psql $psql -Service $Service `
  -Sql 'select public.p79_bench_deadlocks()' -OutDir $OutDir -Name 'deadlocks-before')
$results = @()
try {
  for ($r = $StartRound; $r -lt ($StartRound + $Rounds); $r++) {
    $order = if ($r % 2 -eq 1) { @('A','C') } else { @('C','A') }
    foreach ($v in $order) {
      Write-Output "round=$r variant=$v"
      $results += Invoke-Variant $v
      if ($InjectFailureAfterVariant) {
        throw 'B13_INJECTED_FAILURE_AFTER_MUTATION'
      }
    }
  }
}
finally {
  $restoreFailure = $null
  if ($trigState -like '{*}') {
    # Restauration inconditionnelle, meme si la premiere variante a echoue.
    try {
      $restoreFile = Join-Path $OutDir 'restore-triggers.sql'
      $literal = $trigState.Replace("'", "''")
      Write-B13Text $restoreFile ("select public.p79_bench_restore_triggers('" + $literal + "');")
      Invoke-B13File -Psql $psql -Service $Service -SqlFile $restoreFile `
        -OutDir $OutDir -Name 'restore-triggers' | Out-Null
    } catch {
      $restoreFailure = $_.Exception.Message
    }

    try {
      $teardownFile = Join-Path $OutDir 'teardown.sql'
      Write-B13Text $teardownFile 'select public.p79_bench_teardown();'
      Invoke-B13File -Psql $psql -Service $Service -SqlFile $teardownFile `
        -OutDir $OutDir -Name 'teardown' | Out-Null
    } catch {
      if (-not $restoreFailure) { $restoreFailure = $_.Exception.Message }
    }

    try {
      $after = Invoke-B13Scalar -Psql $psql -Service $Service `
        -Sql 'select public.p79_bench_capture_triggers()' -OutDir $OutDir -Name 'capture-after'
      if ($after -ne $trigState) {
        $restoreFailure = "triggers non restaures : attendu $trigState, obtenu $after"
      }
    } catch {
      if (-not $restoreFailure) { $restoreFailure = $_.Exception.Message }
    }
  }

  if ($restoreFailure) {
    Write-Warning "restauration en echec : $restoreFailure"
    throw "B13_RESTORE_FAILED : $restoreFailure"
  }
  Write-Output 'restauration: etats tgenabled identiques a la capture initiale'
}

$summary = [ordered]@{}
$verdictFail = $false
foreach ($section in $sectionsExpected.Keys) {
  $a = @($results | Where-Object Variant -eq 'A' | ForEach-Object { $_.Data[$section] })
  $c = @($results | Where-Object Variant -eq 'C' | ForEach-Object { $_.Data[$section] })
  $mA = Get-Percentile $a 0.5; $mC = Get-Percentile $c 0.5
  $pA = Get-Percentile $a 0.95; $pC = Get-Percentile $c 0.95
  $overMedian = if ($mA -and $mA -gt 0) { [math]::Round((($mC - $mA) / $mA) * 100, 2) } else { $null }
  $overP95    = if ($pA -and $pA -gt 0) { [math]::Round((($pC - $pA) / $pA) * 100, 2) } else { $null }
  if ($null -ne $overMedian -and $overMedian -gt $budgets.budgets.median_overcost_pct_max) { $verdictFail = $true }
  if ($null -ne $overP95    -and $overP95    -gt $budgets.budgets.p95_overcost_pct_max)    { $verdictFail = $true }
  $summary[$section] = [ordered]@{
    median_A = [math]::Round($mA, 3); median_C = [math]::Round($mC, 3); median_overcost_pct = $overMedian
    p95_A = [math]::Round($pA, 3);    p95_C = [math]::Round($pC, 3);    p95_overcost_pct = $overP95
    samples_A = $a.Count; samples_C = $c.Count
  }
}

$drain = @($results | Where-Object Variant -eq 'C' | ForEach-Object { $_.Metrics['drain_seconds'] })
$deadlocks = @($results | ForEach-Object { [long]$_.Metrics['deadlocks_after'] })
$deadlockMax = if ($deadlocks.Count -gt 0) { ($deadlocks | Measure-Object -Maximum).Maximum } else { $deadlocksBase }
$deadlockDelta = $deadlockMax - $deadlocksBase
if ($deadlockDelta -gt 0) { $verdictFail = $true }

$report = [ordered]@{
  generated_at = (Get-Date).ToString('o')
  service = $Service; iterations = $Iterations; import_batch = $ImportBatch
  import_rounds = $ImportRounds; rounds = $Rounds
  sections = $summary
  observations = [ordered]@{
    drain_seconds = $drain
    deadlocks_max_after = $deadlockDelta
    lock_wait = 'NOT COVERED - aucune instrumentation pg_locks dans cette campagne'
  }
  verdict = if ($verdictFail) { 'FAIL' } else { 'PASS_UNDER_BUDGETS' }
}
$json = $report | ConvertTo-Json -Depth 6
$out = Join-Path $OutDir ("b13-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + ".json")
$json | Set-Content -Path $out -Encoding utf8
Write-Output "rapport: $out"
Write-Output $json
if ($verdictFail) { exit 2 }
