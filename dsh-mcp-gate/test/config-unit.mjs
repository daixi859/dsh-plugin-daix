// 配置/导入逻辑单测：从 lib/index.js 提取纯函数（大括号配对扫描），在临时模块里跑断言。
// 覆盖：normalizeServerInput 校验、parseMcpServersJson（mcpServers 包裹/直接 map/错误路径）、
//       fromImportedEntry 字段映射、connectorView（${ENV} 原样回填）、
//       pathKey/sanitizeProjectsStore（集中项目库）、wantsConnection（项目覆盖优先建连）。
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "lib", "index.js"), "utf8");

const NAMES = [
  "normalizeServerInput", "sanitizeStringMap", "connectorView",
  "parseMcpServersJson", "fromImportedEntry",
  "pathKey", "sanitizeProject", "sanitizeProjectsStore", "wantsConnection",
];

function extract(name) {
  // 无前缀匹配：顶层函数（\nfunction x(）与 apply 内部函数（  function x(）都命中。
  const marker = `function ${name}(`;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`function ${name} not found`);
  let depth = 0;
  let i = src.indexOf("{", start);
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
const SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;
const globalConfig = { servers: {} };
function globalEntry(server) {
  const entry = globalConfig.servers[server];
  if (!entry || typeof entry !== "object") return {};
  return { enabled: true, ...entry };
}
${NAMES.map(extract).join("\n\n")}
export { normalizeServerInput, sanitizeStringMap, connectorView, parseMcpServersJson, fromImportedEntry, pathKey, sanitizeProject, sanitizeProjectsStore, wantsConnection, globalConfig };
`;
writeFileSync(modPath, code, "utf8");

const m = await import("file:///" + modPath.replace(/\\/g, "/"));
let failed = 0;
function check(label, cond) {
  if (cond) console.log("  ok  " + label);
  else { failed += 1; console.log("FAIL  " + label); }
}

// ── 1. normalizeServerInput 校验 ────────────────────────────────────────────
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
  const http = m.normalizeServerInput({ name: "y", transport: "streamable-http", url: "https://h/mcp", headers: { Authorization: "Bearer ${TOKEN}" } });
  check("normalize: headers kept", http.headers.Authorization === "Bearer ${TOKEN}");
}

// ── 2. connectorView：config.json 里的 ${ENV} 原样回填编辑面板 ─────────────
{
  m.globalConfig.servers.github = {
    enabled: true,
    connector: {
      transport: "streamable-http",
      url: "https://api.githubcopilot.com/mcp/",
      headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
    },
  };
  const view = m.connectorView("github");
  check("view: name kept", view.name === "github");
  check("view: ${ENV} verbatim", view.headers.Authorization === "Bearer ${GITHUB_TOKEN}");
  check("view: transport", view.transport === "streamable-http");
  m.globalConfig.servers.pw = {
    enabled: true,
    connector: { transport: "stdio", command: "npx playwright-mcp", args: ["-y"], env: { TOKEN: "${PW_TOKEN}" } },
  };
  const pw = m.connectorView("pw");
  check("view: stdio args", JSON.stringify(pw.args) === JSON.stringify(["-y"]));
  check("view: stdio env ${}", pw.env.TOKEN === "${PW_TOKEN}");
  check("view: missing connector -> null", m.connectorView("nope") === null);
}

// ── 3. JSON 导入：parseMcpServersJson + fromImportedEntry ──────────────────
{
  // 用户实际粘贴形态（Claude Code 约定）
  const crm = {
    mcpServers: {
      crm: {
        command: "node",
        args: ["C:/Users/DELL/.agents/servers/crm/server.mjs"],
        description: "CRM 缺陷修复：待办缺陷/详情、迭代任务拉取",
      },
    },
  };
  const map = m.parseMcpServersJson(JSON.stringify(crm));
  check("import: mcpServers unwrapped", Object.keys(map).length === 1 && !!map.crm);
  const input = m.fromImportedEntry("crm", map.crm);
  check("import: stdio mapped", input.transport === "stdio" && input.command === "node" && input.args.length === 1);
  check("import: description kept", input.description === "CRM 缺陷修复：待办缺陷/详情、迭代任务拉取");
  const norm = m.normalizeServerInput(input);
  check("import: normalized connector", norm.name === "crm" && norm.transport === "stdio" && norm.command === "node" && !("description" in norm));
  // 直接 {name: {...}}
  const direct = m.parseMcpServersJson('{"srv":{"url":"https://example.com/mcp","headers":{"X":"${TOKEN}"}}}');
  const h = m.fromImportedEntry("srv", direct.srv);
  check("import: http mapped", h.transport === "streamable-http" && h.url === "https://example.com/mcp" && h.headers.X === "${TOKEN}");
  // 多 server
  const multi = m.parseMcpServersJson('{"mcpServers":{"a":{"command":"x"},"b":{"url":"http://h/mcp"}}}');
  check("import: multi parsed", Object.keys(multi).length === 2);
  // 错误路径
  check("import: empty rejected", (() => { try { m.parseMcpServersJson("{}"); return false; } catch { return true; } })());
  check("import: nameless body rejected", (() => { try { m.parseMcpServersJson('{"command":"x","args":["y"]}'); return false; } catch { return true; } })());
  check("import: no command/url rejected", (() => { try { m.fromImportedEntry("z", { description: "d" }); return false; } catch { return true; } })());
  check("import: arrays rejected", (() => { try { m.parseMcpServersJson("[1,2]"); return false; } catch { return true; } })());
  // sse 警告位
  const sse = m.fromImportedEntry("legacy-sse", { type: "sse", url: "http://h/sse" });
  check("import: sse warning flagged", sse.sseWarning === true && sse.transport === "streamable-http");
}

// ── 4. pathKey + sanitizeProjectsStore：集中项目库 ─────────────────────────
{
  check("pathKey: case-insensitive", m.pathKey("D:\\WSL\\X") === m.pathKey("d:\\wsl\\x"));
  check("pathKey: slashes normalized", m.pathKey("D:/wsl/x") === m.pathKey("D:\\wsl\\x"));
  check("pathKey: trailing bslash stripped", m.pathKey("D:\\wsl\\x\\") === m.pathKey("D:\\wsl\\x"));
  check("pathKey: trailing slash stripped", m.pathKey("D:/wsl/x/") === m.pathKey("D:\\wsl\\x"));

  const store = m.sanitizeProjectsStore({
    projects: {
      "d:\\wsl\\x": {
        path: "D:\\wsl\\x",
        servers: { crm: { enabled: true }, junk: "x", ghost: { enabled: "yes" } },
      },
      "d:\\wsl\\y": { servers: { crm: { enabled: false } } },
      "d:\\wsl\\z": null,
      "": { servers: {} },
    },
  });
  const px = store.projects["d:\\wsl\\x"];
  check("store: crm enabled kept", !!px && !!px.servers.crm && px.servers.crm.enabled === true);
  check("store: junk/ghost dropped", !("junk" in px.servers) && !("ghost" in px.servers));
  const py = store.projects["d:\\wsl\\y"];
  check("store: path falls back to key", !!py && py.path === "d:\\wsl\\y" && py.servers.crm.enabled === false);
  check("store: null entry dropped", !("d:\\wsl\\z" in store.projects));
  check("store: empty key dropped", !("" in store.projects));
  check("store: garbage → empty", Object.keys(m.sanitizeProjectsStore(null).projects).length === 0);
  check("store: no projects field → empty", Object.keys(m.sanitizeProjectsStore({}).projects).length === 0);

  check("sanitizeProject: enabled kept",
    m.sanitizeProject({ servers: { a: { enabled: false } } }).servers.a.enabled === false);
  check("sanitizeProject: junk dropped",
    JSON.stringify(m.sanitizeProject({ servers: { b: { exposure: "direct" } } })) === '{"servers":{}}');
}

// ── 5. wantsConnection：项目覆盖优先建连 ───────────────────────────────────
{
  m.globalConfig.mcpEnabled = true;
  m.globalConfig.servers = {
    crm: { enabled: false, connector: { transport: "stdio", command: "node" } },
    web: { enabled: true, connector: { transport: "streamable-http", url: "https://h/mcp" } },
    noconn: { enabled: true },
  };
  const projOn = new Set(["crm"]);
  const projOff = new Set();
  check("conn: global on connects", m.wantsConnection("web", projOff) === true);
  check("conn: global off + no project → no", m.wantsConnection("crm", projOff) === false);
  check("conn: global off + project on → yes", m.wantsConnection("crm", projOn) === true);
  check("conn: no connector → no", m.wantsConnection("noconn", projOn) === false);
  m.globalConfig.mcpEnabled = false;
  check("conn: master off → no", m.wantsConnection("web", projOn) === false);
  m.globalConfig.mcpEnabled = true;
  check("conn: missing overrides tolerated", m.wantsConnection("crm", undefined) === false);
}

rmSync(tmp, { recursive: true, force: true });
console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
