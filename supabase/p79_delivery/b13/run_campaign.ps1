# B13 - lanceur autonome (cible isolee biqrgdopcvkrbgfxkzxm uniquement).
# Securite : verrou de campagne, preflight, retry limite aux echecs AVANT mutation,
# verification des residus et des triggers apres chaque tentative.
param(
  [string]$Service = 'b13-isolated',
  [string]$Project = 'biqrgdopcvkrbgfxkzxm',
  [string]$OutDir  = 'C:\Users\HP-EXE\Documents\JISRA-QA\P79-B13-export\campaign',
  [int]$Iterations = 100,
  [int]$ImportBatch = 200,
  [int]$ImportRounds = 10,
  [int]$MaxAttempts = 3
)
$ErrorActionPreference = 'Stop'
$env:PGSERVICEFILE = "$env:APPDATA\postgresql\pg_service.conf"
$env:PGPASSFILE     = "$env:APPDATA\postgresql\pgpass.conf"
$psql  = 'C:\Users\HP-EXE\Tools\pg17\pgsql\bin\psql.exe'
$bench = 'C:\Users\HP-EXE\Documents\erp ecom\jisra-kpi-v5-consolidated\supabase\p79_delivery\b13\run_bench.ps1'
$obs   = 'C:\Users\HP-EXE\Documents\erp ecom\jisra-kpi-v5-consolidated\supabase\p79_delivery\b13\lock_observer.ps1'
if (-not (Test-Path $psql))  { throw "psql introuvable : $psql" }
if (-not (Test-Path $bench)) { throw "pilote introuvable : $bench" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# Verrou : une seule campagne a la fois.
$lock = Join-Path $OutDir 'campaign.lock'
try { $fs = [IO.File]::Open($lock, 'CreateNew', 'Write'); $fs.Close() }
catch { throw "campagne deja en cours (verrou present : $lock)" }

function Write-Log([string]$msg) {
  $line = (Get-Date).ToString('u') + ' ' + $msg
  Add-Content -Path (Join-Path $OutDir 'campaign.log') -Value $line -Encoding ascii
  Write-Output $line
}

function Invoke-Sql([string]$sql) {
  return (& $psql -X -w "service=$Service" -A -t -c $sql 2>$null | Out-String).Trim()
}

function Get-State {
  $r = Invoke-Sql "select count(*) filter (where t.tgenabled='O') || '|' || (select count(*) from public.orders) || '|' || (select count(*) from public.order_items) || '|' || (select count(*) from public.dashboard_kpi_invalidation) from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and t.tgname like 'trg_kpi_%'"
  $p = $r -split '\|'
  [pscustomobject]@{ TriggersOn = [int]$p[0]; Orders = [int]$p[1]; Items = [int]$p[2]; Events = [int]$p[3] }
}

function Assert-Preflight([string]$phase) {
  $db = Invoke-Sql "select current_database() || '|' || (select count(*) from public.stores)"
  if ($db -notlike 'postgres|*') { throw "[$phase] cible inattendue : $db" }
  $s = Get-State
  if ($s.TriggersOn -ne 6) { throw "[$phase] triggers non conformes : $($s.TriggersOn)/6" }
  if ($s.Orders -ne 0 -or $s.Items -ne 0 -or $s.Events -ne 0) {
    throw "[$phase] residus presents (orders=$($s.Orders) items=$($s.Items) events=$($s.Events)) - STOP"
  }
  Write-Log "[$phase] preflight OK (stores=$($db.Split('|')[1]), triggers=6, residus=0)"
}


function Invoke-Round([int]$round) {
  $dir = Join-Path $OutDir ("r$round")
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  for ($a = 1; $a -le $MaxAttempts; $a++) {
    Assert-Preflight "r$round/avant-tentative$a"
    $log = Join-Path $dir ("attempt$a.log")
    $proc = Start-Process -FilePath 'powershell.exe' -PassThru -NoNewWindow `
      -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$bench,'-Service',$Service,
                      '-Project',$Project,'-Iterations',$Iterations,'-ImportBatch',$ImportBatch,
                      '-ImportRounds',$ImportRounds,'-Rounds','1','-StartRound',"$round",'-OutDir',$dir) `
      -RedirectStandardOutput $log -RedirectStandardError ($log + '.err')
    $proc.WaitForExit()
    $code = $proc.ExitCode
    $json = Get-ChildItem -Path $dir -Filter 'b13-*.json' -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($code -eq 0 -and $json) {
      Write-Log "r$round tentatives=$a OK -> $($json.Name)"
      return $json.FullName
    }
    $s = Get-State
    if ($s.Orders -ne 0 -or $s.Items -ne 0 -or $s.Events -ne 0 -or $s.TriggersOn -ne 6) {
      Write-Log "r$round tentatives=$a ECHEC APRES MUTATION (orders=$($s.Orders) items=$($s.Items) events=$($s.Events) triggers=$($s.TriggersOn)) - STOP"
      throw "etat transactionnel incertain au tour $round : intervention requise"
    }
    Write-Log "r$round tentatives=$a echec AVANT mutation (code=$code) - retry dans 20s"
    Start-Sleep -Seconds 20
  }
  throw "tour $round : $MaxAttempts tentatives epuisees"
}

try {
  Write-Log "campagne demarree project=$Project iterations=$Iterations batch=$ImportBatch rounds=$ImportRounds"
  Assert-Preflight 'initial'

  $warm = Join-Path $OutDir 'warmup'
  New-Item -ItemType Directory -Force -Path $warm | Out-Null
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $bench -Service $Service -Project $Project `
      -Iterations 20 -ImportBatch 20 -ImportRounds 2 -Rounds 1 -StartRound 1 -OutDir $warm `
      *> (Join-Path $warm 'warmup.log')
  Write-Log "echauffement termine (code=$LASTEXITCODE, non comptabilise)"
  Assert-Preflight 'apres-echauffement'

  $results = @()
  foreach ($r in 1..3) {
    $job = Start-Process -FilePath 'powershell.exe' -PassThru -NoNewWindow `
      -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$obs,'-Service',$Service,
                      '-DurationSeconds','900','-OutDir',(Join-Path $OutDir "r$r")) `
      -RedirectStandardOutput (Join-Path $OutDir "r$r\observer.log") `
      -RedirectStandardError  (Join-Path $OutDir "r$r\observer.err")
    $results += Invoke-Round $r
    if (-not $job.HasExited) { $job.Kill() }
    Assert-Preflight "r$r/apres-nettoyage"
  }

  Write-Log ("tours complets : " + ($results -join ', '))
  $agg = [ordered]@{ project = $Project; generated_at = (Get-Date).ToString('o')
                     iterations = $Iterations; import_batch = $ImportBatch
                     import_rounds = $ImportRounds; rounds = $results }
  $tmp = Join-Path $OutDir 'campaign-result.tmp'
  ($agg | ConvertTo-Json -Depth 4) | Set-Content -Path $tmp -Encoding utf8
  Move-Item -Force -Path $tmp -Destination (Join-Path $OutDir 'campaign-result.json')
  Write-Log "campagne terminee"
}
finally {
  if (Test-Path $lock) { Remove-Item -Force $lock }
}
