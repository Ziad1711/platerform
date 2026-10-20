# P7.9 — Pilote de campagne B13 appariée (environnement ISOLÉ uniquement).
# Aucun secret : utilise un service PostgreSQL local déjà configuré.
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

function Invoke-Variant([string]$variant) {
  $log = Join-Path $OutDir "log-$variant-$([guid]::NewGuid().ToString('N').Substring(0,6)).txt"
  & $psql -X -w "service=$Service" -v ON_ERROR_STOP=1 `
    -c "set p79.bench_env='isolated'" `
    -c "set p79.bench_variant='$variant'" `
    -v iterations=$Iterations -v import_batch=$ImportBatch -v import_rounds=$ImportRounds `
    -f $sql *> $log
  if ($LASTEXITCODE -ne 0) { throw "Variante $variant en echec (voir $log)" }
  $times = Select-String -Path $log -Pattern '^Time:\s+([0-9.]+)\s+ms' |
           ForEach-Object { [double]$_.Matches[0].Groups[1].Value }
  $expected = $Iterations * 4 + $ImportRounds
  if ($times.Count -ne $expected) {
    throw "Variante ${variant}: $($times.Count) mesures au lieu de $expected (voir $log)"
  }
  [pscustomobject]@{
    Variant  = $variant
    Create   = $times[0..($Iterations-1)]
    Rounding = $times[$Iterations..(2*$Iterations-1)]
    Subtotal = $times[(2*$Iterations)..(3*$Iterations-1)]
    Unrelated= $times[(3*$Iterations)..(4*$Iterations-1)]
    Import   = $times[(4*$Iterations)..($Iterations*4+$ImportRounds-1)]
  }
}

function Get-Percentile([double[]]$values, [double]$p) {
  if ($values.Count -eq 0) { return 0 }
  $sorted = $values | Sort-Object
  $rank = [math]::Ceiling($p * $sorted.Count)
  if ($rank -lt 1) { $rank = 1 }
  return [double]$sorted[$rank - 1]
}

$results = @()
for ($r = 1; $r -le $Rounds; $r++) {
  # Alternance AB/BA pour neutraliser la dérive thermique.
  $order = if ($r % 2 -eq 1) { @('A','C') } else { @('C','A') }
  foreach ($v in $order) {
    Write-Output "round=$r variant=$v"
    $results += Invoke-Variant $v
  }
}

$summary = [ordered]@{}
foreach ($section in 'Create','Rounding','Subtotal','Unrelated','Import') {
  $a = @($results | Where-Object Variant -eq 'A' | ForEach-Object { $_.$section } | ForEach-Object { $_ })
  $c = @($results | Where-Object Variant -eq 'C' | ForEach-Object { $_.$section } | ForEach-Object { $_ })
  $mA = Get-Percentile $a 0.5; $mC = Get-Percentile $c 0.5
  $pA = Get-Percentile $a 0.95; $pC = Get-Percentile $c 0.95
  $summary[$section] = [ordered]@{
    median_A = [math]::Round($mA, 3); median_C = [math]::Round($mC, 3)
    median_overcost_pct = if ($mA -gt 0) { [math]::Round((($mC - $mA) / $mA) * 100, 2) } else { $null }
    p95_A = [math]::Round($pA, 3); p95_C = [math]::Round($pC, 3)
    p95_overcost_pct = if ($pA -gt 0) { [math]::Round((($pC - $pA) / $pA) * 100, 2) } else { $null }
    samples_A = $a.Count; samples_C = $c.Count
  }
}

$report = [ordered]@{
  generated_at = (Get-Date).ToString('o')
  service = $Service; iterations = $Iterations; import_batch = $ImportBatch
  import_rounds = $ImportRounds; rounds = $Rounds
  sections = $summary
}
$json = $report | ConvertTo-Json -Depth 6
$out = Join-Path $OutDir ("b13-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + ".json")
$json | Set-Content -Path $out -Encoding utf8
Write-Output "rapport: $out"
Write-Output $json

# Restauration obligatoire des producteurs KPI.
& $psql -X -w "service=$Service" -c "set p79.bench_env='isolated'" `
  -c "set p79.bench_variant='C'" -v iterations=1 -v import_batch=1 -v import_rounds=1 -f $sql *> $null
& $psql -X -w "service=$Service" -c "select p79_bench_teardown()" *> $null
Write-Output 'producteurs restaures, fixtures de benchmark supprimees'
