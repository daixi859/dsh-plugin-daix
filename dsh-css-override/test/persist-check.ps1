# Fresh-load persistence proof: a rule saved to disk must be live in a brand-new
# page load, with no interaction. Serves a read-only probe page + the real bundle.
$ErrorActionPreference = 'Continue'
$pluginDir = Split-Path -Parent $PSScriptRoot
$port = 8737
$work = Join-Path $env:TEMP ('dco-persist-' + [guid]::NewGuid().ToString('n'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
$browser = @('C:\Program Files\Google\Chrome\Application\chrome.exe','C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe') | Where-Object { Test-Path $_ } | Select-Object -First 1

# 1) enable the first rule, preserving everything else
$original = Invoke-RestMethod -Uri 'http://127.0.0.1:3080/api/dsh-css-override/load' -TimeoutSec 10
$live = $original
$want = @()
foreach ($rule in $live.rules) { $want += $rule }
if ($want.Count -gt 0) { $want[0].enabled = $true }
$payload = @{ rules = $want; revision = $live.revision } | ConvertTo-Json -Depth 6
$saved = Invoke-RestMethod -Uri 'http://127.0.0.1:3080/api/dsh-css-override/save' -Method POST -ContentType 'application/json' -Body $payload -TimeoutSec 10
Write-Output ("step1 enabled rule 1 -> revision " + $saved.revision + ", ok=" + $saved.ok + ", count=" + $saved.count)
Write-Output ("step2 on disk       -> " + ((Get-Content 'C:\Users\daixi\.dsh\css-override\rules.json' -Raw) -replace '\s+', ' ').Substring(0, 96))

# 2) serve the read-only probe page + the real bundle, proxy the API
$server = @'
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
const port = Number(process.argv[2]);
const page = readFileSync(process.argv[3]);
const bundle = readFileSync(process.argv[4]);
const DSH = 'http://127.0.0.1:3080';
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(page); return; }
  if (url.pathname === '/client.js') { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'content-length': bundle.length }); res.end(bundle); return; }
  if (url.pathname.startsWith('/api/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const up = await fetch(DSH + url.pathname + url.search, { method: req.method, headers: body ? { 'content-type': 'application/json' } : undefined, body });
    res.writeHead(up.status, { 'content-type': up.headers.get('content-type') || 'application/json' }); res.end(await up.text()); return;
  }
  res.writeHead(404); res.end('nope');
}).listen(port, '127.0.0.1', () => console.log('PERSIST-SERVER-READY'));
'@
$scriptPath = Join-Path $work 'server.mjs'
$server | Out-File -Encoding utf8 $scriptPath
$so = "$work\s.out"; $se = "$work\s.err"
$srv = Start-Process -FilePath 'node' -ArgumentList @($scriptPath, "$port", (Join-Path $pluginDir 'test\persist-page.html'), (Join-Path $pluginDir 'lib\client.js')) -NoNewWindow -PassThru -RedirectStandardOutput $so -RedirectStandardError $se
for ($i = 0; $i -lt 40; $i++) { Start-Sleep -Milliseconds 250; if ((Get-Content $so -ErrorAction SilentlyContinue) -match 'READY') { break } }

# 3) brand-new browser load, no interaction at all
$dump = "$work\dom.html"
$a = @('--headless=new','--disable-gpu','--no-first-run',"--user-data-dir=$work\p",'--virtual-time-budget=9000','--dump-dom',"http://127.0.0.1:$port/")
Start-Process -FilePath $browser -ArgumentList $a -NoNewWindow -Wait -RedirectStandardOutput $dump -RedirectStandardError "$work\b.err" | Out-Null
if ($srv -and -not $srv.HasExited) { Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue }

$html = if (Test-Path $dump) { Get-Content $dump -Raw } else { '' }
$m = [regex]::Match($html, '<div id="out">([\s\S]*?)</div>')
$text = $m.Groups[1].Value -replace '&lt;','<' -replace '&gt;','>' -replace '&quot;','"' -replace '&#39;',"'" -replace '&amp;','&'
Write-Output ''
Write-Output '--- fresh page load, no interaction ---'
$text.Trim() -split "`n" | ForEach-Object { Write-Output $_ }

# 4) restore the enabled flags exactly as they were before step 1
$after = Invoke-RestMethod -Uri 'http://127.0.0.1:3080/api/dsh-css-override/load' -TimeoutSec 10
$restore = @()
foreach ($rule in $after.rules) { $restore += $rule }
for ($i = 0; $i -lt $restore.Count -and $i -lt $original.rules.Count; $i++) { $restore[$i].enabled = $original.rules[$i].enabled }
$body = @{ rules = $restore; revision = $after.revision } | ConvertTo-Json -Depth 6
$restored = Invoke-RestMethod -Uri 'http://127.0.0.1:3080/api/dsh-css-override/save' -Method POST -ContentType 'application/json' -Body $body -TimeoutSec 10
Write-Output ''
Write-Output ("restored enabled flags -> revision " + $restored.revision + " (" + (($restore | ForEach-Object { $_.name + '=' + $_.enabled }) -join ', ') + ")")
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
if ($text -match 'PERSISTED-RULE-IS-LIVE') { exit 0 } else { exit 1 }
