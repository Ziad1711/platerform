# B13 - tests locaux de non-regression. Aucun acces base.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'b13-common.ps1')

$script:failed = 0
function Assert-True([bool]$Condition, [string]$Name) {
  if ($Condition) { Write-Output "PASS $Name" }
  else { Write-Output "FAIL $Name"; $script:failed++ }
}
function Assert-Equal($Actual, $Expected, [string]$Name) {
  if ($Actual -eq $Expected) { Write-Output "PASS $Name" }
  else { Write-Output ("FAIL $Name : attendu=$Expected obtenu=$Actual"); $script:failed++ }
}

$tmp = Join-Path $env:TEMP ("b13-tests-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
  # 1. quoting d'un chemin avec espaces
  $quoted = Quote-NativeArg 'C:\A B\scenarios.sql'
  Assert-Equal $quoted '"C:\A B\scenarios.sql"' 'quote chemin avec espaces'

  # 2. arguments psql: -c et -f restent des arguments uniques
  $args = New-B13PsqlArgumentString -Service 'b13-isolated' -Project 'biqrgdopcvkrbgfxkzxm' `
    -Owner 'c45355f3-6ab5-4dda-8861-d52e283bf163' -Variant 'A' `
    -Iterations 20 -ImportBatch 20 -ImportRounds 2 -SqlFile 'C:\A B\scenarios.sql'
  Assert-True ($args -match '-c "set p79\.bench_env=''isolated''"') 'argument -c quote'
  Assert-True ($args -match '-f "C:\\A B\\scenarios\.sql"') 'argument -f quote'
  Assert-True ($args -match '-c "set p79\.bench_owner=''c45355f3-') 'argument owner transmis'

  # 3. parsing Time: virgule et point
  Assert-Equal (ConvertFrom-B13TimeLine 'Time: 75,262 ms') 75.262 'Time virgule'
  Assert-Equal (ConvertFrom-B13TimeLine 'Time: 75.262 ms') 75.262 'Time point'
  Assert-Equal (ConvertFrom-B13TimeLine 'Time: 75 ms') 75 'Time entier'
  Assert-True ($null -eq (ConvertFrom-B13TimeLine 'Timing is on.')) 'ligne non Time ignoree'

  # 4. comptage 20/2 malgre le Time du SELECT generateur
  $log = Join-Path $tmp 'synthetic.log'
  $lines = New-Object System.Collections.ArrayList
  function Add-Section([string]$Name, [int]$Count) {
    [void]$lines.Add("SECTION:$Name")
    for ($i = 1; $i -le $Count; $i++) {
      [void]$lines.Add('(1 row)')
      [void]$lines.Add('Time: 10,5 ms')
    }
    [void]$lines.Add('Time: 99,9 ms')  # SELECT format \gexec, sans resultat
  }
  Add-Section 'create_unit' 20
  Add-Section 'update_rounding' 20
  Add-Section 'update_subtotal' 20
  Add-Section 'update_unrelated' 20
  Add-Section 'import_bulk' 2
  Add-Section 'import_loop' 2
  Write-B13Text $log ($lines -join "`r`n")
  $parsed = Read-B13Log -LogPath $log
  Assert-Equal $parsed.Data['create_unit'].Count 20 'comptage create_unit 20'
  Assert-Equal $parsed.Data['import_bulk'].Count 2 'comptage import_bulk 2'
  Assert-Equal $parsed.Data['import_loop'].Count 2 'comptage import_loop 2'

  # 5. chemin avec espaces via Start-Process
  $spaceDir = Join-Path $tmp 'dir with spaces'
  New-Item -ItemType Directory -Force -Path $spaceDir | Out-Null
  $echo = Join-Path $spaceDir 'echo args.ps1'
  Write-B13Text $echo 'param([string]$Value) Write-Output ("VALUE=" + $Value)'
  $out = Join-Path $tmp 'echo.out.txt'
  $err = Join-Path $tmp 'echo.err.txt'
  $p = Start-B13Process -FilePath 'powershell.exe' `
    -ArgumentString ('-NoProfile -ExecutionPolicy Bypass -File ' + (Quote-NativeArg $echo) + ' -Value ok') `
    -StdOut $out -StdErr $err
  $text = (Get-Content -LiteralPath $out -Raw).Trim()
  Assert-Equal $p.ExitCode 0 'chemin avec espaces exit 0'
  Assert-Equal $text 'VALUE=ok' 'chemin avec espaces argument preserve'

  # 6. six sections SQL, sans compter summary
  $sqlText = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'scenarios.sql') -Raw
  $sections = [regex]::Matches($sqlText, '\\echo SECTION:(create_unit|update_rounding|update_subtotal|update_unrelated|import_bulk|import_loop)\b') |
    ForEach-Object { $_.Groups[1].Value }
  Assert-Equal $sections.Count 6 'six sections SQL presentes'

  # 7. refus avant psql : identite, owner, wrapper
  Remove-Item Env:B13_WRAPPER_TOKEN -ErrorAction SilentlyContinue
  $bench = Join-Path $PSScriptRoot 'run_bench.ps1'
  $badOut = Join-Path $tmp 'bad.out.txt'
  $badErr = Join-Path $tmp 'bad.err.txt'
  $bad = Start-B13Process -FilePath 'powershell.exe' `
    -ArgumentString ('-NoProfile -ExecutionPolicy Bypass -File ' + (Quote-NativeArg $bench) + ' -Service wrong -Project biqrgdopcvkrbgfxkzxm -Owner c45355f3-6ab5-4dda-8861-d52e283bf163') `
    -StdOut $badOut -StdErr $badErr
  Assert-True ($bad.ExitCode -ne 0) 'refus service non B13'

  $bad2 = Start-B13Process -FilePath 'powershell.exe' `
    -ArgumentString ('-NoProfile -ExecutionPolicy Bypass -File ' + (Quote-NativeArg $bench) + ' -Service b13-isolated -Project biqrgdopcvkrbgfxkzxm -Owner c45355f3-6ab5-4dda-8861-d52e283bf163') `
    -StdOut $badOut -StdErr $badErr
  Assert-True ($bad2.ExitCode -ne 0) 'refus run_bench sans wrapper'

  $campaign = Join-Path $PSScriptRoot 'run_campaign.ps1'
  $bad3 = Start-B13Process -FilePath 'powershell.exe' `
    -ArgumentString ('-NoProfile -ExecutionPolicy Bypass -File ' + (Quote-NativeArg $campaign) + ' -Owner ""') `
    -StdOut $badOut -StdErr $badErr
  Assert-True ($bad3.ExitCode -ne 0) 'refus campagne sans owner'

  $warm = Join-Path $PSScriptRoot 'run_warmup_safe.ps1'
  $bad4 = Start-B13Process -FilePath 'powershell.exe' `
    -ArgumentString ('-NoProfile -ExecutionPolicy Bypass -File ' + (Quote-NativeArg $warm) + ' -Owner ""') `
    -StdOut $badOut -StdErr $badErr
  Assert-True ($bad4.ExitCode -ne 0) 'refus warmup sans owner'
}
finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

if ($script:failed -gt 0) {
  Write-Output "ECHEC : $($script:failed) test(s)"
  exit 1
}
Write-Output 'TOUS LES TESTS PASS'
