// client 表单单测：从 lib/client.js 抽出 TEMPLATES / objToRows / normalizeInitial 真实源码来跑，
// 保证「点模板 → 保存」这条路径不会静默丢参数（曾经的缺陷：模板写 argsText，normalizeInitial 只读 args）。
// 运行：node test/client-form-unit.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "lib", "client.js"), "utf8");

/** 抽出 `function name(` 起的一段源码（大括号配对）。 */
function grabFunction(name) {
  const marker = `function ${name}(`;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`function ${name} not found`);
  let depth = 0;
  let i = src.indexOf("{", start);
  for (; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return src.slice(start, i + 1);
}

/** 抽出 `var TEMPLATES = [...]` 整段（方括号配对）。 */
function grabTemplates() {
  const start = src.indexOf("var TEMPLATES");
  if (start < 0) throw new Error("TEMPLATES not found");
  let depth = 0;
  let i = src.indexOf("[", start);
  for (; i < src.length; i += 1) {
    if (src[i] === "[") depth += 1;
    else if (src[i] === "]") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return src.slice(start, i + 1) + ";";
}

const code = `
${grabTemplates()}
${grabFunction("objToRows")}
${grabFunction("rowsFrom")}
${grabFunction("normalizeInitial")}
module.exports = { TEMPLATES, normalizeInitial };
`;
const sandbox = { module: { exports: {} } };
vm.createContext(sandbox);
new vm.Script(code).runInContext(sandbox);
const { TEMPLATES, normalizeInitial } = sandbox.module.exports;

let failed = 0;
function check(label, cond, extra) {
  if (cond) console.log("  ok  " + label);
  else {
    failed += 1;
    console.log("FAIL  " + label + (extra !== undefined ? ` → ${extra}` : ""));
  }
}

/** ServerForm.submit() 里 argsText → payload.args 的同一条规则。 */
const splitArgs = (text) => String(text || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

/** 点模板 chip 的实际入口：normalizeInitial({...tpl.data, envRows: [], headerRows: []})（order 见 render 里的 onClick）。 */
function formFromTemplate(id) {
  const tpl = TEMPLATES.find((t) => t.id === id);
  if (!tpl) throw new Error(`template ${id} missing`);
  return normalizeInitial(Object.assign({ envRows: [], headerRows: [] }, tpl.data));
}

// ── 1. 编辑路径：connectorView 给的是 args 数组 ──────────────────────────────
{
  const form = normalizeInitial({ name: "x", transport: "stdio", command: "npx", args: ["-y", "@playwright/mcp@latest"] });
  check("edit: args array → argsText", form.argsText === "-y\n@playwright/mcp@latest", JSON.stringify(form.argsText));
  check("edit: submit 回写不失真", JSON.stringify(splitArgs(form.argsText)) === JSON.stringify(["-y", "@playwright/mcp@latest"]));
}

// ── 2. 模板路径：args 与 argsText 两种写法都必须能带出参数 ────────────────────
{
  const form = normalizeInitial({ name: "y", transport: "stdio", command: "uvx", argsText: "mcp-server-fetch" });
  check("template: argsText 直接透传", form.argsText === "mcp-server-fetch", JSON.stringify(form.argsText));

  for (const id of ["playwright", "fetch"]) {
    const f = formFromTemplate(id);
    const args = splitArgs(f.argsText);
    check(`template ${id}: 保存后 args 非空`, args.length > 0, JSON.stringify(args));
  }
  const pw = splitArgs(formFromTemplate("playwright").argsText);
  check("template playwright: 带 -y 与包名", pw.includes("-y") && pw.some((a) => a.includes("@playwright/mcp")), JSON.stringify(pw));
  const gh = formFromTemplate("github");
  check("template github: header 引用保留", /Bearer \$\{GITHUB_TOKEN\}/.test(gh.headerRows.map((r) => r.v).join("|")));
  check("template github: transport", gh.transport === "streamable-http");
}

// ── 3. 空值兜底 ───────────────────────────────────────────────────────────────
{
  const f = normalizeInitial(undefined);
  check("empty: argsText 空串", f.argsText === "");
  check("empty: 默认 stdio 且给一行 env", f.transport === "stdio" && f.envRows.length === 1);
}

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
