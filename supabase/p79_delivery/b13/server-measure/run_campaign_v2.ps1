# B13 - pilote V2 : une invocation = un CSV brut + verification de volumes.
param(
  [string]$Service = 'b13-isolated',
  [string]$Owner   = 'c45355f3-6ab5-4dda-8861-d52e283bf163',
  [string]$Kinds   = 'create_unit,update_rounding,update_subtotal,update_unrelated,import_bulk,import_loop',
  [int]$N = 100,
  [int]$Batches = 10,
  [int]$Size = 200,
  [int]$Reps = 5,
  [string]$OutDir = 'C:\Users\HP-EXE\Documents\JISRA-QA\P79-B13-export\v2-campaign'
)
$ErrorActionPreference = 'Continue'
$env:PGSERVICEFILE = "$env:APPDATA\postgresql\pg_service.conf"
$env:PGPASSFILE     = "$env:APPDATA\postgresql\pgpass.conf"
$psql = 'C:\Users\HP-EXE\Tools\pg17\pgsql\bin\psql.exe'
$sql  = 'C:\Users\HP-EXE\Documents\erp ecom\jisra-kpi-v5-consolidated\supabase\p79_delivery\b13\server-measure\server_measure_v2_csv.sql'
$svc  = "service=$Service"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function Log([string]$m) { Add-Content (Join-Path $OutDir 'campaign.log') ((Get-Date).ToString('u') + ' ' + $m) -Encoding ascii }
function Q([string]$q) { (& $psql -X -w -q $svc -A -t -c $q 2>$null | Out-String).Trim() }

$allowed = @('create_unit','update_rounding','update_subtotal','update_unrelated','import_bulk','import_loop')
$kindList = @($Kinds.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
if ($kindList.Count -eq 0) { throw 'P79_BAD_KINDS_EMPTY' }
foreach ($k in $kindList) { if ($allowed -notcontains $k) { throw "P79_BAD_KIND_PARAM: $k" } }
if (($kindList | Sort-Object -Unique).Count -ne $kindList.Count) { throw 'P79_BAD_KINDS_DUPLICATE' }

$id = Q "select current_database() || '|' || (select count(*) from public.stores)"
if ($id -notlike 'postgres|*') { throw "identite non confirmee : $id" }
Log "pilote V2 demarre identite=$id kinds=$($kindList -join ',') n=$N batches=$Batches size=$Size reps=$Reps"

$summary = Join-Path $OutDir 'summary.csv'
if (-not (Test-Path $summary)) { 'ts,kind,variant,rep,samples,expected,orders,items,status' | Set-Content $summary -Encoding ascii }

foreach ($kind in $kindList) {
  for ($rep = 1; $rep -le $Reps; $rep++) {
    $order = if ($rep % 2 -eq 1) { @('A','C') } else { @('C','A') }
    foreach ($v in $order) {
      $tag  = "$kind-$v-r$rep"
      $csv  = Join-Path $OutDir ("samples-$tag.csv")
      $err  = Join-Path $OutDir ("$tag.err.log")
      $out  = Join-Path $OutDir ("$tag.out.log")
      $expected = if ($kind -like 'import_*') { $Batches } else { $N }

      $args = @('-X','-w','-q',$svc,'-v','ON_ERROR_STOP=1','--single-transaction',
        '-c',"set p79.bench_env='isolated'",'-c',"set p79.bench_confirm='SCHEDULED-ISOLATED-RUN'",
        '-c',"set p79.bench_project='biqrgdopcvkrbgfxkzxm'",'-c',"set p79.bench_allow='biqrgdopcvkrbgfxkzxm'",
        '-c',"set p79.bench_owner='$Owner'",'-c',"set p79.bench_variant='$v'",
        '-v',"kind=$kind",'-v',"n=$N",'-v',"batches=$Batches",'-v',"size=$Size",'-f',$sql)
      # Invocation native : le splatting preserve les chemins contenant des
      # espaces (prouve localement), contrairement a Start-Process -ArgumentList.
      # stdout capture en memoire puis ecrit en ASCII : evite l'UTF-16LE de 1>.
      $stdout = & $psql @args 2> $err
      $code = $LASTEXITCODE
      if ($null -eq $stdout) { $stdout = @() }
      $stdout | Set-Content -Path $csv -Encoding ascii

      $st = Q "select count(*) filter (where t.tgenabled='O') || '|' || (select count(*) from public.orders) || '|' || (select count(*) from public.order_items) || '|' || (select count(*) from public.dashboard_kpi_invalidation) || '|' || (select count(*) from public.stores) from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and t.tgname like 'trg_kpi_%'"
      $okState = ($st -eq '6|0|0|0|0')

      # Separation stricte : samples (^digits), preuve marquee, en-tetes connus.
      $rows = 0; $proof = @(); $badLines = @(); $headers = 0
      if (Test-Path $csv) {
        foreach ($rawLine in (Get-Content $csv -Encoding ASCII)) {
          # BOM eventuel en tete de premiere ligne.
          $l = $rawLine.TrimStart([char]0xFEFF)
          if ($l.Trim() -eq '') { continue }
          if ($l -eq 'i,ms') { $headers++; continue }
          if ($l -like 'marker,*') { $headers++; continue }
          if ($l -like 'P79_SRV_PROOF,*') { $proof += $l; continue }
          if ($l -match '^\d+,') { $rows++; continue }
          $badLines += $l
        }
      }
      $proofOk = ($proof.Count -eq 1 -and $headers -eq 2 -and $badLines.Count -eq 0)
      $p = if ($proof.Count -eq 1) { $proof[0].Split(',') } else { @() }
      $kindOk = $proofOk -and ($p[1] -eq $kind) -and ($p[2] -eq $v)
      $o  = if ($proofOk) { $p[3] } else { '?' }
      $i2 = if ($proofOk) { $p[4] } else { '?' }
      $samplesOk = $proofOk -and ([int]$p[5] -eq $expected)
      $status = if ($okState -and $code -eq 0 -and $rows -eq $expected -and $kindOk -and $samplesOk) { 'PASS' } else { 'FAIL' }
      Add-Content $summary ((Get-Date).ToString('s') + ",$kind,$v,$rep,$rows,$expected,$o,$i2,$status") -Encoding ascii
      Log "$status $tag samples=$rows/$expected exit=$code state=$st volumes=orders:$o/items:$i2"

      if (-not $okState) { throw "etat SQL incertain apres $tag : $st - ARRET" }
      if ($code -ne 0)   { throw "psql exit=$code sur $tag - voir $err" }
      if ($rows -ne $expected) { throw "echantillons $rows au lieu de $expected sur $tag" }
      if (-not $proofOk) { throw "preuve P79_SRV_PROOF absente/dupliquee ou ligne parasite sur $tag (headers=$headers proof=$($proof.Count) bad=$($badLines.Count))" }
      if (-not $kindOk)  { throw "kind/variant de la preuve incoherents sur $tag" }
      if (-not $samplesOk) { throw "samples de la preuve (=$($p[5])) differs de l'attendu ($expected) sur $tag" }
    }
  }
}
Log 'pilote V2 termine'
