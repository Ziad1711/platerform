# P7.9 - Pilote B13 apparie (v2). ENVIRONNEMENT ISOLE UNIQUEMENT.
# Aucun secret : utilise un service PostgreSQL local deja configure.
param(
  [string]$Service   = 'jisra-bench',
  [int]$Iterations   = 100,
  [int]$ImportBatch  = 200,
  [int]$ImportRounds = 10,
  [int]$Rounds       = 3,
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
  & $psql -X -w $svc -v ON_ERROR_STOP=1 `
    -c "set p79.bench_env='isolated'" `
    -c "set p79.bench_confirm='SCHEDULED-ISOLATED-RUN'" `
    -c "set p79.bench_variant='$variant'" `
    -v iterations=$Iterations -v import_batch=$ImportBatch -v import_rounds=$ImportRounds `
    -f $sql *> $log
  if ($LASTEXITCODE -ne 0) { throw "Variante $variant en echec - voir $log" }

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
$results = @()
try {
  for ($r = 1; $r -le $Rounds; $r++) {
    $order = if ($r % 2 -eq 1) { @('A','C') } else { @('C','A') }
    foreach ($v in $order) {
      Write-Output "round=$r variant=$v"
      $results += Invoke-Variant $v
    }
  }
}
finally {
  # Restauration garantie, meme en cas d'erreur.
  # 1) tous les triggers trg_kpi_* metier sont reactives sans dependre du paquet ;
  # 2) les fixtures de benchmark sont supprimees si les fonctions existent.
  $restore = @'
do $$
declare t record;
begin
  for t in
    select c.relname as rel, tg.tgname
      from pg_trigger tg
      join pg_class c on c.oid = tg.tgrelid
     where not tg.tgisinternal
       and tg.tgname like 'trg_kpi_%'
       and c.relname in ('orders', 'order_items', 'ad_spend_daily')
  loop
    execute format('alter table public.%I enable trigger %I', t.rel, t.tgname);
  end loop;
  if to_regprocedure('public.p79_bench_teardown()') is not null then
    perform public.p79_bench_teardown();
  end if;
end
$$;
'@
  $restore | & $psql -X -w $svc -v ON_ERROR_STOP=1 -f - *> $null
  Write-Output 'restauration: triggers KPI actifs, fixtures de benchmark supprimees'
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
$deadlockDelta = if ($deadlocks.Count -gt 0) { ($deadlocks | Measure-Object -Maximum).Maximum } else { 0 }

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
