$ErrorActionPreference = "Stop"
# 仓库根相对定位（原先写死 D:\wsl\... 换台机器就跑不了）
$gate = Split-Path -Parent $PSScriptRoot
$cfgDir = "$env:USERPROFILE\.dsh\plugins\mcp-gate"
$cfg = "$cfgDir\config.json"
$bak = "$cfgDir\config.e2e-bak.json"
# dsh CLI：PATH 优先，否则退回 fnm 的 aliases\default（DSH 进程 PATH 里常常没有 node）
$dsh = (Get-Command dsh -ErrorAction SilentlyContinue).Source
if (-not $dsh) {
  $cand = "$env:APPDATA\fnm\aliases\default\dsh.cmd"
  if (Test-Path $cand) { $dsh = $cand } else { throw "dsh CLI not found; put it on PATH or set it manually" }
}
# E2E 用的 stdio 服务器要能被宿主 spawn：node 得是可执行绝对路径，
# 否则 DSH 进程 PATH 里没有 node 时 mini-mcp-server 起不来（同 README 的 PATH 踩坑）。
$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) {
  $cand = "$env:APPDATA\fnm\aliases\default\node.exe"
  if (Test-Path $cand) { $nodeExe = $cand } else { throw "node not found; put it on PATH or set it manually" }
}
New-Item -ItemType Directory -Force -Path $cfgDir | Out-Null
if (Test-Path $cfg) { Copy-Item $cfg $bak -Force }
# patch 里的 __GATE__ 占位符换成仓库绝对路径（正斜杠、file:// URL 里可直接用）。
$patchSrc = Get-Content "$gate\test\e2e-patch.yml" -Raw
$patch = "$env:TEMP\mcp-gate-e2e-patch.yml"
$patchSrc.Replace("__GATE__", $gate.Replace('\', '/')) | Set-Content $patch -Encoding UTF8
# E2E 配置：demo 服务器走内置连接器（config.json 驱动，不进 patch）+ description 验证目录段
$e2e = @{
  mcpEnabled = $true
  servers = @{
    demo = @{
      enabled = $true
      description = "Demo MCP server for verification: echo back text, tell current time and add numbers"
      connector = @{ transport = "stdio"; command = $nodeExe; args = @("$gate\test\mini-mcp-server.js") }
    }
  }
} | ConvertTo-Json -Depth 6
Set-Content -Path $cfg -Value $e2e -Encoding UTF8
try {
  $cred = Get-Content "$env:USERPROFILE\.dsh\.credentials.yaml" -Raw
  $m = [regex]::Match($cred, 'ZAI_API_KEY["'']?\s*[:=]\s*["'']?([A-Za-z0-9_.\-]{20,})')
  if (-not $m.Success) { throw "ZAI_API_KEY not found in credentials" }
  $env:ZAI_API_KEY = $m.Groups[1].Value
  $env:MCP_GATE_DEBUG = "1"
  $task = "先调用 mcp_search 工具搜索 echo 并解锁；然后调用 mcp__demo__echo 工具，参数 text='hello-connector'，原样报告该工具的返回结果。"
  & $dsh headless --patch $patch --json $task 2> "$gate\test\headless-stderr.log" | Out-File "$gate\test\headless-events.jsonl" -Encoding UTF8
  "exit=$LASTEXITCODE"
  $final = Select-String -Path "$gate\test\headless-events.jsonl" -Pattern '"final"' | Select-Object -Last 2
  $final | ForEach-Object { $_.Line.Substring(0, [Math]::Min(600, $_.Line.Length)) }
} finally {
  if (Test-Path $bak) { Move-Item $bak $cfg -Force } else { Remove-Item $cfg -ErrorAction SilentlyContinue }
  Remove-Item $patch -ErrorAction SilentlyContinue
  Remove-Item Env:ZAI_API_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:MCP_GATE_DEBUG -ErrorAction SilentlyContinue
}
