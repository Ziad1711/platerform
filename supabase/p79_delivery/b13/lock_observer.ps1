# B13 - Observateur de verrous (dispositif independant, cible isolee uniquement).
# Echantillonne pg_locks / pg_stat_activity pendant la campagne. Aucun secret.
param(
  [string]$Service = 'b13-isolated',
  [int]$DurationSeconds = 300,
  [int]$IntervalMs = 100,
  [string]$OutDir = "$PSScriptRoot\out"
)
$ErrorActionPreference = 'Stop'
$psql = Join-Path $HOME 'Tools\pg17\pgsql\bin\psql.exe'
if (-not (Test-Path $psql)) { throw "psql introuvable : $psql" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$out = Join-Path $OutDir ("locks-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + ".csv")
'ts,sessions_waiting,max_wait_ms,blocked_pids' | Set-Content -Path $out -Encoding ascii

$deadline = (Get-Date).AddSeconds($DurationSeconds)
$samples = 0
$maxSeen = 0

while ((Get-Date) -lt $deadline) {
  $row = (& $psql -X -w "service=$Service" -A -t -F',' -c @"
select now()::text,
       count(*) filter (where wait_event_type = 'Lock'),
       coalesce(round(max(extract(epoch from (now() - query_start)) * 1000) filter (where wait_event_type = 'Lock'), 0), 0),
       coalesce(string_agg(distinct pid::text, '|') filter (where wait_event_type = 'Lock'), '')
  from pg_stat_activity
 where datname = current_database()
   and pid <> pg_backend_pid()
   and wait_event_type = 'Lock';
"@ 2>$null | Out-String).Trim()

  if ($row -match '^[0-9]{4}-') {
    Add-Content -Path $out -Value $row -Encoding ascii
    $samples++
    $ms = [double](($row -split ',')[2])
    if ($ms -gt $maxSeen) { $maxSeen = $ms }
  }
  Start-Sleep -Milliseconds $IntervalMs
}

$summary = [ordered]@{
  output      = $out
  samples     = $samples
  interval_ms = $IntervalMs
  duration_s  = $DurationSeconds
  max_lock_wait_ms_observed = [math]::Round($maxSeen, 2)
  verdict = if ($maxSeen -lt 50) { 'PASS_UNDER_50MS_OBSERVED' } else { 'FAIL_LOCK_WAIT_OVER_50MS' }
  coverage_note = 'echantillonnage periodique : des attentes plus courtes que l intervalle peuvent ne pas etre vues'
}
$summary | ConvertTo-Json | Write-Output
