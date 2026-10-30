# Renders raster assets (printable PDFs and previews, social image, icons) with Microsoft Edge headless.
# Run from site_source:  powershell -NoProfile -File scripts\make_assets.ps1 -PrintableSource <path to small_home_reset_printables.html>
param([Parameter(Mandatory = $true)][string]$PrintableSource)
$ErrorActionPreference = 'Stop'
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$root = (Get-Location).Path
$assets = Join-Path $root 'src\assets'
$srcDir = Join-Path $root 'printable_sources'
New-Item -ItemType Directory -Force $srcDir, "$assets\printables", "$assets\images" | Out-Null

function Edge([string[]]$a) {
  $ud = Join-Path $env:TEMP ('edge_p3_' + [guid]::NewGuid().ToString('N').Substring(0, 6))
  & $edge --headless=new --disable-gpu --hide-scrollbars "--user-data-dir=$ud" @a | Out-Null
  Start-Sleep -Milliseconds 700
}
function Uri([string]$p) { ([System.Uri]$p).AbsoluteUri }

# 1) split the 3-page printable into three single-page sources
$html = Get-Content $PrintableSource -Raw -Encoding UTF8
$headEnd = $html.IndexOf('<body>') + 6
$head = $html.Substring(0, $headEnd)
$defs = @(
  @{ id = 'daily'; file = 'daily-reset-card' },
  @{ id = 'weekly'; file = 'weekly-room-grid' },
  @{ id = 'monthly'; file = 'monthly-rotation' })
foreach ($d in $defs) {
  $m = [regex]::Match($html, "(?s)<section class=`"page`" id=`"$($d.id)`">.*?</section>")
  if (-not $m.Success) { throw "section $($d.id) not found" }
  $page = $head + "`n" + $m.Value + "`n</body></html>"
  $f = Join-Path $srcDir ($d.file + '.html')
  [IO.File]::WriteAllText($f, $page, (New-Object Text.UTF8Encoding($false)))
  $pdf = Join-Path "$assets\printables" ($d.file + '.pdf')
  Remove-Item $pdf -ErrorAction SilentlyContinue
  Edge @('--no-pdf-header-footer', "--print-to-pdf=$pdf", (Uri $f))
  $png = Join-Path "$assets\printables" ('preview-' + $d.file + '.png')
  Remove-Item $png -ErrorAction SilentlyContinue
  Edge @('--window-size=816,1056', "--screenshot=$png", (Uri $f))
  "{0}: pdf={1} png={2}" -f $d.file, (Test-Path $pdf), (Test-Path $png)
}
# combined PDF = the validated Phase 2 PDF (same content, 3 pages)
$combined = Join-Path "$assets\printables" 'all-printables.pdf'
Remove-Item $combined -ErrorAction SilentlyContinue
Edge @('--no-pdf-header-footer', "--print-to-pdf=$combined", (Uri $PrintableSource))
"combined pdf: $(Test-Path $combined)"

# 2) social image 1200x630
$og = @'
<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:1200px;height:630px;background:#f6f1e7;font-family:system-ui,"Segoe UI",Arial,sans-serif;color:#14213d;overflow:hidden}
.wrap{position:relative;width:1200px;height:630px}
.frame{position:absolute;inset:24px;border:6px solid #14213d}
h1{position:absolute;left:80px;top:120px;margin:0;font-family:Georgia,serif;font-size:104px;line-height:1.02;letter-spacing:-2px}
p{position:absolute;left:84px;top:350px;margin:0;font-size:38px;max-width:620px;line-height:1.3;color:#424c66}
.tiers{position:absolute;right:70px;top:110px;display:grid;gap:18px}
.t{width:330px;height:92px;background:#fffdf8;border:5px solid #14213d;border-radius:16px;display:flex;align-items:center;overflow:hidden}
.n{width:110px;height:100%;display:flex;align-items:center;justify-content:center;font-family:Georgia,serif;font-weight:700;font-size:54px;color:#fff}
.l{font-size:26px;font-weight:700;padding-left:18px}
.foot{position:absolute;left:84px;bottom:70px;font-size:28px;font-weight:700;color:#8f3420}
</style></head><body><div class="wrap"><div class="frame"></div>
<h1>Reset<br>Minutes</h1><p>Time-boxed cleaning routines and free printable checklists for small homes</p>
<div class="tiers"><div class="t"><div class="n" style="background:#b4452d">5</div><div class="l">Minimum day</div></div><div class="t"><div class="n" style="background:#14213d">10</div><div class="l">Daily reset</div></div><div class="t"><div class="n" style="background:#3f6355">20</div><div class="l">Reset + short list</div></div><div class="t"><div class="n" style="background:#8f3420">40</div><div class="l">Reset + full list</div></div></div>
<div class="foot">Time budgets, not promises</div></div></body></html>
'@
$ogHtml = Join-Path $srcDir 'og-default.html'
[IO.File]::WriteAllText($ogHtml, $og, (New-Object Text.UTF8Encoding($false)))
$ogPng = "$assets\images\og-default.png"; Remove-Item $ogPng -ErrorAction SilentlyContinue
Edge @('--window-size=1200,630', "--screenshot=$ogPng", (Uri $ogHtml))
"og: $(Test-Path $ogPng)"

# 3) icons from favicon.svg
$svg = Get-Content "$assets\images\favicon.svg" -Raw
foreach ($sz in @(@{n='favicon-32.png';s=32}, @{n='apple-touch-icon.png';s=180}, @{n='icon-192.png';s=192}, @{n='icon-512.png';s=512})) {
  $h = Join-Path $srcDir ('icon-' + $sz.s + '.html')
  [IO.File]::WriteAllText($h, "<!doctype html><html><head><style>html,body{margin:0;width:$($sz.s)px;height:$($sz.s)px;background:#14213d}svg{width:$($sz.s)px;height:$($sz.s)px;display:block}</style></head><body>$svg</body></html>", (New-Object Text.UTF8Encoding($false)))
  $out = Join-Path "$assets\images" $sz.n; Remove-Item $out -ErrorAction SilentlyContinue
  Edge @("--window-size=$($sz.s),$($sz.s)", "--screenshot=$out", (Uri $h))
  "{0}: {1}" -f $sz.n, (Test-Path $out)
}
Add-Type -AssemblyName System.Drawing
Get-ChildItem "$assets\images\*.png", "$assets\printables\*.png" | ForEach-Object { $i = [System.Drawing.Image]::FromFile($_.FullName); "{0} {1}x{2} {3} bytes" -f $_.Name, $i.Width, $i.Height, $_.Length; $i.Dispose() }


