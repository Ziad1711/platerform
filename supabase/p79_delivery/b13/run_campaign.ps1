# B13 - lanceur autonome (cible isolee biqrgdopcvkrbgfxkzxm uniquement).
# Securite : verrou de campagne, preflight, retry limite aux echecs AVANT mutation,
# verification des residus et des triggers apres chaque tentative.
param(
  [string]$Service = 'b13-isolated',
  [string]$Project = 'biqrgdopcvkrbgfxkzxm',
  [string]$Owner   = '',
  [string]$OutDir  = 'C:\Users\HP-EXE\Documents\JISRA-QA\P79-B13-export\campaign',
  [int]$Iterations = 100,
  [int]$ImportBatch = 200,
  [int]$ImportRounds = 10,
  [int]$MaxAttempts = 3
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
$obs   = Join-Path $PSScriptRoot 'lock_observer.ps1'
if (-not (Test-Path -LiteralPath $psql))  { throw "psql introuvable : $psql" }
if (-not (Test-Path -LiteralPath $bench)) { throw "pilote introuvable : $bench" }
if (-not (Test-Path -LiteralPath $obs))   { throw "observateur introuvable : $obs" }
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

function Get-State {
  $r = Invoke-B13Scalar -Psql $psql -Service $Service -OutDir $OutDir -Name 'state' `
    -Sql "select count(*) filter (where t.tgenabled='O') || '|' || (select count(*) from public.orders) || '|' || (select count(*) from public.order_items) || '|' || (select count(*) from public.dashboard_kpi_invalidation) from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and t.tgname like 'trg_kpi_%'"
  $p = $r -split '\|'
  [pscustomobject]@{ TriggersOn = [int]$p[0]; Orders = [int]$p[1]; Items = [int]$p[2]; Events = [int]$p[3] }
}

function Assert-Preflight([string]$phase) {
  $db = Invoke-B13Scalar -Psql $psql -Service $Service -OutDir $OutDir -Name 'identity' `
    -Sql "select current_database() || '|' || current_user || '|' || (select count(*) from public.stores)"
  if ($db -notlike 'postgres|postgres|*') { throw "[$phase] cible inattendue : $db" }
  $benchStore = Invoke-B13Scalar -Psql $psql -Service $Service -OutDir $OutDir -Name 'bench-store' `
    -Sql "select count(*) from public.stores where id = '7f000000-0000-4000-8000-0000000000b1'"
  if ([int]$benchStore -ne 0) { throw "[$phase] store de bench residuel : $benchStore - STOP" }
  $s = Get-State
  if ($s.TriggersOn -ne 6) { throw "[$phase] triggers non conformes : $($s.TriggersOn)/6" }
  if ($s.Orders -ne 0 -or $s.Items -ne 0 -or $s.Events -ne 0) {
    throw "[$phase] residus presents (orders=$($s.Orders) items=$($s.Items) events=$($s.Events)) - STOP"
  }
  Write-Log "[$phase] preflight OK (stores=$($db.Split('|')[2]), triggers=6, residus=0)"
}


function Invoke-Round([int]$round) {
  $dir = Join-Path $OutDir ("r$round")
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  for ($a = 1; $a -le $MaxAttempts; $a++) {
    Assert-Preflight "r$round/avant-tentative$a"
    $log = Join-Path $dir ("attempt$a.log")
    $err = Join-Path $dir ("attempt$a.err.log")
    $runToken = [guid]::NewGuid().ToString('N')
    $env:B13_WRAPPER_TOKEN = $runToken
    $argParts = @(
      '-NoProfile','-ExecutionPolicy','Bypass','-File',(Quote-NativeArg $bench),
      '-Service',(Quote-NativeArg $Service),'-Project',(Quote-NativeArg $Project),
      '-Owner',(Quote-NativeArg $Owner),'-Iterations',"$Iterations",
      '-ImportBatch',"$ImportBatch",'-ImportRounds',"$ImportRounds",
      '-Rounds','1','-StartRound',"$round",'-OutDir',(Quote-NativeArg $dir),
      '-WrapperToken',(Quote-NativeArg $runToken),'-ProtectedBy','run_campaign'
    )
    $proc = Start-B13Process -FilePath 'powershell.exe' -ArgumentString ($argParts -join ' ') `
      -StdOut $log -StdErr $err
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
  $runToken = [guid]::NewGuid().ToString('N')
  $env:B13_WRAPPER_TOKEN = $runToken
  $warmLog = Join-Path $warm 'warmup.log'
  $warmErr = Join-Path $warm 'warmup.err.log'
  $warmArgs = @(
    '-NoProfile','-ExecutionPolicy','Bypass','-File',(Quote-NativeArg $bench),
    '-Service',(Quote-NativeArg $Service),'-Project',(Quote-NativeArg $Project),
    '-Owner',(Quote-NativeArg $Owner),'-Iterations','20','-ImportBatch','20',
    '-ImportRounds','2','-Rounds','1','-StartRound','1','-OutDir',(Quote-NativeArg $warm),
    '-WrapperToken',(Quote-NativeArg $runToken),'-ProtectedBy','run_campaign'
  )
  $warmProc = Start-B13Process -FilePath 'powershell.exe' -ArgumentString ($warmArgs -join ' ') `
    -StdOut $warmLog -StdErr $warmErr
  $warmCode = $warmProc.ExitCode
  Write-Log "echauffement termine (code=$warmCode, non comptabilise)"
  if ($warmCode -ne 0) {
    throw "echauffement en echec (code=$warmCode) - voir $warmLog et $warmErr"
  }
  Assert-Preflight 'apres-echauffement'

  $results = @()
  foreach ($r in 1..3) {
    $observerArgs = @(
      '-NoProfile','-ExecutionPolicy','Bypass','-File',(Quote-NativeArg $obs),
      '-Service',(Quote-NativeArg $Service),'-DurationSeconds','900',
      '-OutDir',(Quote-NativeArg (Join-Path $OutDir "r$r"))
    )
    $job = Start-Process -FilePath 'powershell.exe' -PassThru -NoNewWindow `
      -ArgumentList ($observerArgs -join ' ') `
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
