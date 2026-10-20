# P7.9 - Pilote B13 apparie (v2). ENVIRONNEMENT ISOLE UNIQUEMENT.
# Aucun secret : utilise un service PostgreSQL local deja configure.
param(
  [string]$Service   = 'jisra-bench',
  [string]$Project   = '',
  [int]$Iterations   = 100,
  [int]$ImportBatch  = 200,
  [int]$ImportRounds = 10,
  [int]$Rounds       = 3,
  [int]$StartRound   = 1,
  [string]$OutDir    = "$PSScriptRoot\out"
)
$ErrorActionPreference = 'Stop'
$psql = Join-Path $HOME 'Tools\pg17\pgsql\bin\psql.exe'
if (-not (Test-Path $psql)) { throw "psql introuvable : $psql" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$sql = Join-Path $PSScriptRoot 'scenarios.sql'
$svc = "service=$Service"
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
  $ErrorActionPreference = "Continue"
    & $psql -X -w $svc -v ON_ERROR_STOP=1 ` $psql -X -w $svc -v ON_ERROR_STOP=1 `
    -c "set p79.bench_env='isolated'" `
    -c "set p79.bench_confirm='SCHEDULED-ISOLATED-RUN'" `
    -c "set p79.bench_project='$Project'" `
    -c "set p79.bench_allow='$Project'" `
    -c "set p79.bench_variant='$variant'" `
    -v iterations=$Iterations -v import_batch=$ImportBatch -v import_rounds=$ImportRounds `
    -f $sql *> $log
  if ($LASTEXITCODE -ne 0) { throw "Variante $variant en echec - voir $log" }
  if (-not (Select-String -Path $log -Pattern 'P79_GUARD_OK' -Quiet)) {
    throw "Variante ${variant}: marqueur de garde-fou absent - voir $log"
  }

  $data = @{}; $current = $null; $metrics = @{}
  foreach ($line in Get-Content -LiteralPath $log) {
    if ($line -match '^SECTION:([a-z_]+)') {
      $current = $Matches[1]
      if (-not $data.ContainsKey($current)) { $data[$current] = New-Object System.Collections.ArrayList }
      continue
    }
    if ($current -and $line -match '^Time:\s+([0-9.]+)\s+ms') {
      [void]$data[$current].Add([double]$Matches[1]); continue
    }
    if ($line -match '^(pending_events|orders|items|deadlocks_after|drain_seconds)\s*\|\s*(\S+)') {
      $metrics[$Matches[1]] = $Matches[2]
    }
  }

  foreach ($key in $sectionsExpected.Keys) {
    $expected = $sectionsExpected[$key]
    $count = if ($data.ContainsKey($key)) { $data[$key].Count } else { 0 }
    if ($count -ne $expected) {
      throw "Variante ${variant} / section ${key} : $count mesures au lieu de $expected (voir $log)"
    }
  }
  [pscustomobject]@{ Variant = $variant; Data = $data; Metrics = $metrics; Log = $log }
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
$trigState = (& $psql -X -w $svc -A -t -c "select p79_bench_capture_triggers()" 2>$null | Out-String).Trim()
if ([string]::IsNullOrWhiteSpace($trigState) -or $trigState -notlike '{*}') {
  throw 'capture de l etat des triggers impossible : campagne annulee'
}
Write-Output "etat initial captures : $trigState"

$deadlocksBase = [long]((& $psql -X -w $svc -A -t -c "select p79_bench_deadlocks()" 2>$null | Out-String).Trim())
$envValidated = $false
$results = @()
try {
  for ($r = $StartRound; $r -lt ($StartRound + $Rounds); $r++) {
    $order = if ($r % 2 -eq 1) { @('A','C') } else { @('C','A') }
    foreach ($v in $order) {
      Write-Output "round=$r variant=$v"
      $results += Invoke-Variant $v
      # Le marqueur P79_GUARD_OK a ete vu : la cible est validee pour cette campagne.
      $envValidated = $true
    }
  }
}
finally {
  if ($envValidated) {
    # Restauration EXACTE des valeurs tgenabled capturees, puis nettoyage.
    $sqlRestore = 'select p79_bench_restore_triggers(' + [char]39 + $trigState + [char]39 + ')'
    & $psql -X -w $svc -v ON_ERROR_STOP=1 -c $sqlRestore *> $null
    & $psql -X -w $svc -c "select p79_bench_teardown()" *> $null
    $after = (& $psql -X -w $svc -A -t -c "select p79_bench_capture_triggers()" 2>$null | Out-String).Trim()
    if ($after -ne $trigState) {
      Write-Warning "restauration des triggers NON conforme : attendu $trigState, obtenu $after"
    } else {
      Write-Output 'restauration: etats tgenabled identiques a la capture initiale'
    }
  }
  else {
    Write-Output 'restauration NON tentee : controle d environnement non valide (aucune modification appliquee)'
  }
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
