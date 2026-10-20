# B13 - helpers communs. ASCII uniquement (compatible Windows PowerShell 5.1).
# Aucun acces base ici : uniquement quoting, execution de processus et parsing.

function Quote-NativeArg([string]$Value) {
  if ($null -eq $Value) { return '""' }
  return '"' + ($Value -replace '"', '\"') + '"'
}

function Start-B13Process {
  param(
    [Parameter(Mandatory=$true)][string]$FilePath,
    [Parameter(Mandatory=$true)][string]$ArgumentString,
    [Parameter(Mandatory=$true)][string]$StdOut,
    [Parameter(Mandatory=$true)][string]$StdErr
  )
  $p = Start-Process -FilePath $FilePath -ArgumentList $ArgumentString -Wait -PassThru `
    -NoNewWindow -RedirectStandardOutput $StdOut -RedirectStandardError $StdErr
  return $p
}

function Write-B13Text([string]$Path, [string]$Text) {
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  [IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

function New-B13PsqlArgumentString {
  param(
    [Parameter(Mandatory=$true)][string]$Service,
    [Parameter(Mandatory=$true)][string]$Project,
    [Parameter(Mandatory=$true)][string]$Owner,
    [Parameter(Mandatory=$true)][string]$Variant,
    [Parameter(Mandatory=$true)][int]$Iterations,
    [Parameter(Mandatory=$true)][int]$ImportBatch,
    [Parameter(Mandatory=$true)][int]$ImportRounds,
    [Parameter(Mandatory=$true)][string]$SqlFile
  )
  if ([string]::IsNullOrWhiteSpace($Owner)) { throw 'B13_OWNER_REQUIRED' }
  $sets = @(
    "set p79.bench_env='isolated'",
    "set p79.bench_confirm='SCHEDULED-ISOLATED-RUN'",
    "set p79.bench_project='$Project'",
    "set p79.bench_allow='$Project'",
    "set p79.bench_variant='$Variant'",
    "set p79.bench_owner='$Owner'"
  )
  $parts = @('-X','-w',(Quote-NativeArg "service=$Service"),'-v','ON_ERROR_STOP=1')
  foreach ($s in $sets) { $parts += @('-c',(Quote-NativeArg $s)) }
  $parts += @(
    '-v',"iterations=$Iterations",
    '-v',"import_batch=$ImportBatch",
    '-v',"import_rounds=$ImportRounds",
    '-f',(Quote-NativeArg $SqlFile)
  )
  return ($parts -join ' ')
}

function ConvertFrom-B13TimeLine([string]$Line) {
  if ($Line -match '^Time:\s+([0-9]+(?:[.,][0-9]+)?)\s+ms') {
    $raw = $Matches[1].Replace(',', '.')
    return [double]::Parse($raw,
      [Globalization.NumberStyles]::Float,
      [Globalization.CultureInfo]::InvariantCulture)
  }
  return $null
}

# Lit un journal psql. Une mesure metier est un "Time:" precede par un resultat
# psql ("(N rows)"). Le "Time:" du SELECT generateur de \gexec n'a pas de
# resultat associe et est donc exclu sans retirer une mesure metier.
function Read-B13Log([string]$LogPath) {
  $data = @{}
  $metrics = @{}
  $current = $null
  $resultSeen = $false
  foreach ($line in Get-Content -LiteralPath $LogPath) {
    if ($line -match '^SECTION:([a-z_]+)') {
      $current = $Matches[1]
      $resultSeen = $false
      if (-not $data.ContainsKey($current)) {
        $data[$current] = New-Object System.Collections.ArrayList
      }
      continue
    }
    if ($current -and $line -match '^\s*\(\d+ rows?\)\s*$') {
      $resultSeen = $true
      continue
    }
    if ($current -and $line -match '^Time:') {
      if ($resultSeen) {
        $value = ConvertFrom-B13TimeLine $line
        if ($null -ne $value) { [void]$data[$current].Add($value) }
      }
      $resultSeen = $false
      continue
    }
    if ($line -match '^(pending_events|orders|items|deadlocks_after|drain_seconds)\s*\|\s*(\S+)') {
      $metrics[$Matches[1]] = $Matches[2]
    }
  }
  return [pscustomobject]@{ Data = $data; Metrics = $metrics }
}

function Invoke-B13Scalar {
  param(
    [Parameter(Mandatory=$true)][string]$Psql,
    [Parameter(Mandatory=$true)][string]$Service,
    [Parameter(Mandatory=$true)][string]$Sql,
    [Parameter(Mandatory=$true)][string]$OutDir,
    [Parameter(Mandatory=$true)][string]$Name
  )
  $out = Join-Path $OutDir ("$Name.out.txt")
  $err = Join-Path $OutDir ("$Name.err.txt")
  $arg = '-X -w ' + (Quote-NativeArg "service=$Service") +
         ' -A -t -v ON_ERROR_STOP=1 -c ' + (Quote-NativeArg $Sql)
  $p = Start-B13Process -FilePath $Psql -ArgumentString $arg -StdOut $out -StdErr $err
  if ($p.ExitCode -ne 0) {
    throw "B13_PSQL_FAILED $Name exit=$($p.ExitCode) - voir $err"
  }
  return (Get-Content -LiteralPath $out -Raw).Trim()
}

function Invoke-B13File {
  param(
    [Parameter(Mandatory=$true)][string]$Psql,
    [Parameter(Mandatory=$true)][string]$Service,
    [Parameter(Mandatory=$true)][string]$SqlFile,
    [Parameter(Mandatory=$true)][string]$OutDir,
    [Parameter(Mandatory=$true)][string]$Name
  )
  $out = Join-Path $OutDir ("$Name.out.txt")
  $err = Join-Path $OutDir ("$Name.err.txt")
  $arg = '-X -w ' + (Quote-NativeArg "service=$Service") +
         ' -v ON_ERROR_STOP=1 -f ' + (Quote-NativeArg $SqlFile)
  $p = Start-B13Process -FilePath $Psql -ArgumentString $arg -StdOut $out -StdErr $err
  if ($p.ExitCode -ne 0) {
    throw "B13_PSQL_FAILED $Name exit=$($p.ExitCode) - voir $err"
  }
  return (Get-Content -LiteralPath $out -Raw).Trim()
}
