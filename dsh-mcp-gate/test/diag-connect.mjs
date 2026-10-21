// GUI 同款环境模拟：connector.js 连真实服务器，验证 !!js 求值 + stdio shell 修复
import { connectServer, evalJsValue, evalServerCfg } from "../lib/connector.js";
import { execSync } from "node:child_process";

// 从注册表拿真值（当前进程环境可能没有 setx 后的新值）
if (!process.env.GITHUB_TOKEN) {
  try {
    const v = execSync('reg query HKCU\\Environment /v GITHUB_TOKEN', { encoding: "utf8" });
    const m = v.match(/GITHUB_TOKEN\s+REG_SZ\s+(\S+)/);
    if (m) process.env.GITHUB_TOKEN = m[1];
  } catch {}
}
console.log("GITHUB_TOKEN present:", Boolean(process.env.GITHUB_TOKEN), process.env.GITHUB_TOKEN ? `len=${process.env.GITHUB_TOKEN.length}` : "");

// !!js 求值单点验证
const evaled = evalJsValue("!!js '`Bearer ${process.env.GITHUB_TOKEN}`'");
console.log("evalJsValue:", evaled.startsWith("Bearer ") && !evaled.includes("${") ? "OK" : `BAD: ${evaled.slice(0, 40)}`);

const targets = [
  { serverName: "github", transport: "streamable-http", url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "!!js '`Bearer ${process.env.GITHUB_TOKEN}`'" } },
  { serverName: "playwright", transport: "stdio", command: "npx", args: ["playwright-mcp"] },
];

const conns = [];
for (const cfg of targets) {
  const conn = await connectServer({ ...cfg }, { debugLog: () => {} });
  conns.push(conn);
  console.log(`== ${cfg.serverName}: status=${conn.status} tools=${conn.tools.length}`);
  if (conn.error) console.log(`   error: ${String(conn.error).slice(0, 200)}`);
  if (conn.tools.length > 0) console.log(`   tools: ${conn.tools.slice(0, 5).map((t) => t.name).join(", ")}${conn.tools.length > 5 ? " ..." : ""}`);
}
for (const c of conns) {
  try { c.close(); } catch {}
}
process.exit(0);
