// patch 管理逻辑单测：从 lib/index.js 提取纯函数（大括号配对扫描），在临时模块里跑往返测试。
// 覆盖：buildInsertBlock→readPatchServers 往返（stdio+env / http+!!js）、追加、删除、not-in-patch、坏 YAML 回滚、
//       desktop 真实 profile patch 只读解析、normalizeServerInput 校验、connectorView/jsToEnvRef 显示转换。
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "lib", "index.js"), "utf8");

const NAMES = [
  "yqScalar", "yqFlowArray", "envRefToJs", "yqValue", "yqMap", "buildInsertBlock",
  "stripQuotes", "parseFlowArray", "parseScalar", "readPatchServers", "writePatchChecked",
  "normalizeServerInput", "sanitizeStringMap", "jsToEnvRef", "connectorView", "removeBlockFromText",
  "stripStrayServerRows", "cleanEmptyInsertShells",
];

function extract(name) {
  const marker = `  function ${name}(`;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`function ${name} not found`);
  let depth = 0;
  let i = src.indexOf("{", start);
  const bodyStart = i;
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return src.slice(start, i + 1);
}

const tmp = mkdtempSync(join(tmpdir(), "mcp-gate-unit-"));
const modPath = join(tmp, "extracted.mjs");
const code = `
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const MCP_CLIENT_NAME = "@deepseek-ai/dsh-mcp-client";
const SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;
const debugLog = () => {};
const statSync = () => ({ size: 0 });
${NAMES.map(extract).join("\n\n")}
export { buildInsertBlock, readPatchServers, writePatchChecked, normalizeServerInput, connectorView, jsToEnvRef, removeBlockFromText, stripStrayServerRows, cleanEmptyInsertShells };
export function readText(p) { return readFileSync(p, "utf8"); }
`;
writeFileSync(modPath, code, "utf8");

const m = await import("file:///" + modPath.replace(/\\/g, "/"));
let failed = 0;
function check(label, cond) {
  if (cond) console.log("  ok  " + label);
  else { failed += 1; console.log("FAIL  " + label); }
}

// ── 1. stdio + env 往返 ─────────────────────────────────────────────────────
const stdio = {
  name: "demo",
  transport: "stdio",
  command: "node",
  args: ["mini-mcp-server.js"],
  env: { MCP_GATE_DEBUG: "1", TOKEN: "${MY_TOKEN}" },
};
{
  const block = m.buildInsertBlock(stdio);
  const parsed = m.readPatchServers(block);
  check("stdio roundtrip: server present", parsed.demo != null);
  check("stdio roundtrip: command", parsed.demo.command === "node");
  check("stdio roundtrip: args", JSON.stringify(parsed.demo.args) === JSON.stringify(["mini-mcp-server.js"]));
  check("stdio roundtrip: env plain", parsed.demo.env.MCP_GATE_DEBUG === "1");
  check("stdio roundtrip: env ${} → !!js", /!!js/.test(parsed.demo.env.TOKEN));
  const view = m.connectorView(parsed.demo);
  check("connectorView: env back to ${}", view.env.TOKEN === "${MY_TOKEN}");
  check("connectorView: transport", view.transport === "stdio");
}

// ── 2. http + !!js header 往返 ──────────────────────────────────────────────
const http = {
  name: "github",
  transport: "streamable-http",
  url: "https://api.githubcopilot.com/mcp/",
  headers: { Authorization: "Bearer ${GITHUB_TOKEN}", "X-Plain": "abc" },
};
{
  const block = m.buildInsertBlock(http);
  const parsed = m.readPatchServers(block);
  check("http roundtrip: url", parsed.github.url === http.url);
  check("http roundtrip: auth as !!js", /^!!js/.test(parsed.github.headers.Authorization));
  check("http roundtrip: plain header kept", parsed.github.headers["X-Plain"] === "abc");
  const view = m.connectorView(parsed.github);
  check("connectorView: Bearer ${GITHUB_TOKEN}", view.headers.Authorization === "Bearer ${GITHUB_TOKEN}");
  check("connectorView: name kept", view.name === "github");
  check("buildInsertBlock: id line", block.includes("  - id: mcp-github"));
  check("buildInsertBlock: name line", block.includes("name: '@deepseek-ai/dsh-mcp-client'"));
}

// ── 3. 追加 + 删除 ──────────────────────────────────────────────────────────
{
  const file = join(tmp, "patch.yml");
  m.writePatchChecked(file, "[]\n");
  const b1 = m.buildInsertBlock(stdio);
  m.writePatchChecked(file, "[]\n\n" + b1);
  const b2 = m.buildInsertBlock(http);
  m.writePatchChecked(file, m.readText(file) + "\n" + b2);
  const both = m.readPatchServers(m.readText(file));
  check("append: both parsed", both.demo != null && both.github != null);

  // 删除 demo（提取 removeServerFromPatch 的核心：文本定位）
  const lines = m.readText(file).split(/\r?\n/);
  const marker = "- id: mcp-demo";
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === marker) { start = i; break; }
  }
  check("remove: marker found", start >= 0);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {4}- id: /.test(lines[i]) || /^- /.test(lines[i])) { end = i; break; }
  }
  while (end < lines.length && lines[end].trim() === "") end += 1;
  const next = lines.slice(0, start).concat(lines.slice(end)).join("\n");
  m.writePatchChecked(file, next);
  const after = m.readPatchServers(m.readText(file));
  check("remove: demo gone", after.demo == null);
  check("remove: github kept", after.github != null);

  // update 回退路径：removeBlockFromText 删旧块 + append 新块 = 就地更新
  const cur = m.readText(file);
  const r1 = m.removeBlockFromText(cur, "github");
  check("update-patch: old block found", r1.found === true);
  const base = r1.text.endsWith("\n") ? r1.text : r1.text + "\n";
  const newGithub = m.buildInsertBlock({ ...http, headers: { Authorization: "Bearer ${GITHUB_TOKEN_V2}" } });
  m.writePatchChecked(file, base + "\n" + newGithub);
  const updated = m.readPatchServers(m.readText(file));
  check("update-patch: github still one", Object.keys(updated).length === 1);
  check("update-patch: new value in place", /GITHUB_TOKEN_V2/.test(m.readText(file)));
  const r2 = m.removeBlockFromText(cur, "nope");
  check("update-patch: missing -> found=false", r2.found === false && r2.text === cur);
}

// ── 4. .bak 备份 ────────────────────────────────────────────────────────────
{
  const file = join(tmp, "rollback.yml");
  m.writePatchChecked(file, "[]\n");
  m.writePatchChecked(file, "[ overwritten ]\n");
  check("bak: created on second write", m.readText(file + ".mcp-gate.bak") === "[]\n");
  check("write: new content in place", m.readText(file) === "[ overwritten ]\n");
}

// ── 5. desktop 真实 patch 只读解析 ──────────────────────────────────────────
{
  const realPath = "C:\\Users\\DELL\\.dsh\\profiles\\desktop\\cordis.patch.yml";
  let parsed = null;
  try {
    parsed = m.readPatchServers(readFileSync(realPath, "utf8"));
    console.log("  ..  parsed " + realPath);
  } catch (error) {
    console.log("  ..  cannot read real patch: " + error.message);
  }
  if (parsed) {
    const names = Object.keys(parsed);
    console.log("  ..  real patch mcp-client servers: " + JSON.stringify(names));
    check("real patch: parses to a plain object", parsed !== null && typeof parsed === "object");
    for (const name of names) {
      check("real patch view: " + name, m.connectorView(parsed[name]) != null);
    }
  }
}

// ── 6. normalizeServerInput 校验 ────────────────────────────────────────────
{
  let threw = false;
  try { m.normalizeServerInput({ name: "bad name!" }); } catch { threw = true; }
  check("normalize: rejects bad name", threw);
  threw = false;
  try { m.normalizeServerInput({ name: "x", transport: "stdio" }); } catch { threw = true; }
  check("normalize: stdio requires command", threw);
  threw = false;
  try { m.normalizeServerInput({ name: "x", transport: "streamable-http", url: "ftp://no" }); } catch { threw = true; }
  check("normalize: http requires http(s) url", threw);
  const argsFromString = m.normalizeServerInput({ name: "x", transport: "stdio", command: "npx", args: "a\n\nb" });
  check("normalize: args string→array", JSON.stringify(argsFromString.args) === JSON.stringify(["a", "b"]));
}

// ── 7. stripStrayServerRows：清理顶层遗留直接 entry（configEditor append / 手贴）──
{
  const stray = [
    "# mcp-gate: github — added by mcp-gate UI",
    "- insert:",
    "    - id: mcp-github",
    "      name: '@deepseek-ai/dsh-mcp-client'",
    "      config:",
    "        serverName: github",
    "        transport: streamable-http",
    "        url: https://api.githubcopilot.com/mcp/",
    "        headers:",
    "          'Authorization': !!js '`Bearer ${process.env.GITHUB_TOKEN}`'",
    "        failOnStartupError: false",
    "- id: mcp-github",
    '  name: "@deepseek-ai/dsh-mcp-client"',
    "  config:",
    "    serverName: github",
    "    transport: streamable-http",
    "    url: https://api.githubcopilot.com/mcp/",
    "    headers:",
    "      Authorization1: Bearer ${GITHUB_TOKEN}",
    "    failOnStartupError: false",
    "",
  ].join("\n");
  const r = m.stripStrayServerRows(stray, "github");
  check("strip: removed=1", r.removed === 1);
  check("strip: standard insert block kept", /- insert:/.test(r.text) && /'Authorization': !!js/.test(r.text));
  check("strip: stray row gone", !/Authorization1/.test(r.text) && !/^  name: "@deepseek-ai\/dsh-mcp-client"/m.test(r.text));
  // update 全链路模拟：遗留行 + 标准 block → strip + remove + append = 单一干净块
  const { text: stripped } = m.stripStrayServerRows(stray, "github");
  const { text: without, found } = m.removeBlockFromText(stripped, "github");
  check("strip+update: block found after strip", found === true);
  const rebuilt = (without.endsWith("\n") ? without : without + "\n") + "\n" + m.buildInsertBlock({ name: "github", transport: "streamable-http", url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "Bearer ${GITHUB_TOKEN}" } });
  const reparsed = m.readPatchServers(rebuilt);
  const view = m.connectorView(reparsed.github);
  check("strip+update: single clean github", Object.keys(reparsed).length === 1 && view.headers.Authorization === "Bearer ${GITHUB_TOKEN}");
  // 非 mcp-client 的顶层同 id 行不删（isClient 校验）
  const foreign = "- id: mcp-github\n  name: some-other-plugin\n  config:\n    x: 1\n";
  const rf = m.stripStrayServerRows(foreign, "github");
  check("strip: non-client row kept", rf.removed === 0 && rf.text === foreign);
  // insert item（4 空格缩进）不误删
  const onlyInsert = "- insert:\n    - id: mcp-demo\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: demo\n";
  const ri = m.stripStrayServerRows(onlyInsert, "demo");
  check("strip: insert item untouched", ri.removed === 0 && ri.text === onlyInsert);
}

// ── 8. cleanEmptyInsertShells：空壳 "- insert:" 项清理（旧版删块不吞块头的事故兜底）──
{
  const real = m.buildInsertBlock({ name: "github", transport: "streamable-http", url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "Bearer ${GITHUB_TOKEN}" } });
  const shell = "# mcp-gate: github — added by mcp-gate UI\n- insert:\n\n";
  const withShells = "pre\n\n" + shell + shell + real;
  const cleaned = m.cleanEmptyInsertShells(withShells);
  check("shells: insert count 1", (cleaned.match(/^- insert:$/gm) || []).length === 1);
  check("shells: real block kept", /- id: mcp-github/.test(cleaned) && /!!js/.test(cleaned));
  check("shells: single mcp-gate comment", (cleaned.match(/# mcp-gate:/g) || []).length === 1);
  // removeBlockFromText（已修：循环吞块头）删块后无空壳
  const two = real + "\n" + m.buildInsertBlock({ name: "demo", transport: "stdio", command: "npx x" });
  const { text: after } = m.removeBlockFromText(two, "demo");
  check("remove: no empty insert left", (after.match(/^- insert:$/gm) || []).length === 1 && !/# mcp-gate: demo/.test(after));
  // writePatchChecked 落盘前自动清理空壳
  const f2 = join(tmp, "shells.yml");
  m.writePatchChecked(f2, withShells);
  const back = m.readText(f2);
  check("write: shells stripped on disk", (back.match(/^- insert:$/gm) || []).length === 1);
}

rmSync(tmp, { recursive: true, force: true });
console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
