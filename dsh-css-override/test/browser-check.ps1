# Real-browser verification driver for dsh-css-override.
#
# Node serves the check page; the browser is launched from PowerShell with FILE
# redirection (a piped-stdio launch is blocked in this sandbox), and the
# --dump-dom output is parsed here.
#
# Usage: pwsh -File test/browser-check.ps1
$ErrorActionPreference = 'Stop'

$pluginDir = Split-Path -Parent $PSScriptRoot
$port = 8731
$work = Join-Path $env:TEMP ('dco-browser-check-' + [guid]::NewGuid().ToString('n'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
$artifacts = Join-Path $pluginDir 'test\artifacts'
New-Item -ItemType Directory -Path $artifacts -Force | Out-Null

$browsers = @(
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
)
$browser = $browsers | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { Write-Output 'BROWSER-CHECK-SKIPPED no Chromium-family browser found'; exit 2 }

$serverOut = Join-Path $work 'server.out.txt'
$serverErr = Join-Path $work 'server.err.txt'
Write-Output "starting check server on port $port ..."
$server = Start-Process -FilePath 'node' -ArgumentList @(
    (Join-Path $pluginDir 'test\check-server.mjs'), "$port", $work
) -NoNewWindow -PassThru -RedirectStandardOutput $serverOut -RedirectStandardError $serverErr

try {
    # Wait for the readiness line rather than guessing a delay.
    $origin = $null
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Milliseconds 250
        if (Test-Path $serverOut) {
            $line = Get-Content $serverOut -ErrorAction SilentlyContinue | Where-Object { $_ -like 'CHECK-SERVER-READY*' } | Select-Object -First 1
            if ($line) { $origin = ($line -split ' ')[1]; break }
        }
        if ($server.HasExited) { break }
    }
    if (-not $origin) {
        Write-Output 'BROWSER-CHECK-FAILED check server never became ready'
        Get-Content $serverErr -ErrorAction SilentlyContinue | Select-Object -Last 10
        exit 1
    }
    Write-Output "check page : $origin/"
    Write-Output "browser    : $browser"

    $dump = Join-Path $work 'dom.html'
    $shot = Join-Path $artifacts 'settings-page.png'
    $browserOut = Join-Path $work 'browser.out.txt'
    $browserErr = Join-Path $work 'browser.err.txt'
    if (Test-Path $shot) { Remove-Item $shot -Force }

    # --dump-dom and --screenshot cannot share one headless run ("multiple
    # targets"), so the verdict and the picture are captured separately.
    $common = @(
        '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--disable-extensions', '--hide-scrollbars', '--window-size=1280,1000',
        "--user-data-dir=$work\profile"
    )
    $proc = Start-Process -FilePath $browser -ArgumentList ($common + @('--virtual-time-budget=9000', '--dump-dom', "$origin/")) `
        -NoNewWindow -Wait -PassThru -RedirectStandardOutput $dump -RedirectStandardError $browserErr
    Write-Output "browser exit (dom): $($proc.ExitCode)"

    Start-Process -FilePath $browser -ArgumentList ($common + @('--virtual-time-budget=9000', "--screenshot=$shot", "$origin/")) `
        -NoNewWindow -Wait -RedirectStandardOutput $browserOut -RedirectStandardError $browserErr | Out-Null

    $html = if (Test-Path $dump) { Get-Content $dump -Raw } else { '' }

    # The verdict div is re-rendered on every check; the final text is what counts.
    $verdict = [regex]::Match($html, '<div id="verdict">([\s\S]*?)</div>')
    $title = [regex]::Match($html, '<title>([^<]*)</title>')
    $lines = @()
    if ($verdict.Success) {
        $text = $verdict.Groups[1].Value
        $text = $text -replace '&lt;', '<' -replace '&gt;', '>' -replace '&quot;', '"' -replace '&#39;', "'" -replace '&amp;', '&'
        $lines = $text -split "`n" | Where-Object { $_.Trim() -ne '' }
    }

    Write-Output ''
    Write-Output '--- browser verdict ---'
    if ($lines.Count -eq 0) {
        Write-Output '(no verdict captured)'
        Get-Content $browserErr -ErrorAction SilentlyContinue | Select-Object -Last 8
    } else {
        $lines | ForEach-Object { Write-Output $_ }
    }
    Write-Output ''
    Write-Output ("document title : " + $title.Groups[1].Value)
    if (Test-Path $shot) { Write-Output ("screenshot     : " + $shot + " (" + (Get-Item $shot).Length + " bytes)") }

    $passed = ($lines | Where-Object { $_ -like 'PASS*' }).Count
    $failed = ($lines | Where-Object { $_ -like 'FAIL*' }).Count
    $pageFile = Join-Path $work 'served-page.html'
    if (Test-Path $pageFile) { Copy-Item $pageFile (Join-Path $artifacts 'served-check-page.html') -Force }
    if (Test-Path $dump) { Copy-Item $dump (Join-Path $artifacts 'browser-dom.html') -Force }
    Write-Output ""
    Write-Output "$passed passed, $failed failed"
    if ($failed -eq 0 -and $passed -gt 0) { exit 0 } else { exit 1 }
}
finally {
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 300
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}
