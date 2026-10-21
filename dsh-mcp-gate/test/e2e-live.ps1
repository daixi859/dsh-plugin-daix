$ErrorActionPreference = "Stop"
$gate = "D:\wsl\dsh-plugin-daix\dsh-mcp-gate"
$cfgDir = "$env:USERPROFILE\.dsh\plugins\mcp-gate"
$cfg = "$cfgDir\config.json"
$bak = "$cfgDir\config.e2e-bak.json"
New-Item -ItemType Directory -Force -Path $cfgDir | Out-Null
if (Test-Path $cfg) { Copy-Item $cfg $bak -Force }
# E2E 配置：demo 服务器走内置连接器（config.json 驱动，不进 patch）+ description 验证目录段
$e2e = @{
  mcpEnabled = $true
  servers = @{
    demo = @{
      enabled = $true
      description = "Demo MCP server for verification: echo back text, tell current time and add numbers"
      connector = @{ transport = "stdio"; command = "node"; args = @("$gate\test\mini-mcp-server.js") }
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
  & dsh headless --patch "$gate\test\e2e-patch.yml" --json $task 2> "$gate\test\headless-stderr.log" | Out-File "$gate\test\headless-events.jsonl" -Encoding UTF8
  "exit=$LASTEXITCODE"
  $final = Select-String -Path "$gate\test\headless-events.jsonl" -Pattern '"final"' | Select-Object -Last 2
  $final | ForEach-Object { $_.Line.Substring(0, [Math]::Min(600, $_.Line.Length)) }
} finally {
  if (Test-Path $bak) { Move-Item $bak $cfg -Force } else { Remove-Item $cfg -ErrorAction SilentlyContinue }
  Remove-Item Env:ZAI_API_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:MCP_GATE_DEBUG -ErrorAction SilentlyContinue
}
