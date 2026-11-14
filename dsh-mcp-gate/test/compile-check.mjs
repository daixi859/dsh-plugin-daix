// 本地编译 mcp_search 的 parameters，dump 生成的 JSON Schema。
// 依赖 @deepseek-ai/dsh-tools：优先从当前 profile 的 node_modules 解析，
// 其次退回 DSH_HOME/profiles/node_modules（共享层），最后才用环境变量覆盖。
// 不写死任何机器路径——旧版本硬编码 D:/wsl/... 导致换机必然 ERR_MODULE_NOT_FOUND。
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const TOOLS_ENTRY = join("@deepseek-ai", "dsh-tools", "lib", "index.js");

function resolveToolsUrl() {
  const candidates = [];
  if (process.env.DSH_TOOLS_ENTRY) candidates.push(process.env.DSH_TOOLS_ENTRY);
  const home = process.env.DSH_HOME;
  if (home) {
    if (process.env.DSH_PROFILE_DIR) {
      candidates.push(join(process.env.DSH_PROFILE_DIR, "node_modules", TOOLS_ENTRY));
    }
    for (const profile of ["desktop", "web", "dsh-tui"]) {
      candidates.push(join(home, "profiles", profile, "node_modules", TOOLS_ENTRY));
    }
    candidates.push(join(home, "profiles", "node_modules", TOOLS_ENTRY));
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return pathToFileURL(candidate).href;
  }
  throw new Error(
    `cannot locate ${TOOLS_ENTRY}; set DSH_TOOLS_ENTRY to its absolute path. ` +
      `tried:\n  ${candidates.join("\n  ") || "(no candidates: DSH_HOME is unset)"}`,
  );
}

const mod = await import(resolveToolsUrl());
const defineTool = mod.defineTool;

const def = defineTool({
  name: "mcp_search",
  description: "test",
  parameters: {
    query: {
      type: "string",
      required: true,
      description:
        "Keywords for the capability you need, e.g. 'pull request create' or 'issue search'.",
    },
    limit: {
      type: "number",
      description: "Maximum number of tools to load (1-20, default 8).",
    },
  },
  output: {
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        text: { type: "string", description: "x" },
        count: { type: "integer", description: "y" },
      },
    },
    render: () => [{ type: "text", text: "x" }],
  },
  async execute(args) {
    return { text: JSON.stringify(args) };
  },
});

console.log("=== compiled parameters ===");
console.log(JSON.stringify(def.parameters, null, 2));
console.log("=== validate({}) ===");
try {
  await def.execute({}, {}); // execute 是 async：ToolArgsError 走 rejection，必须 await 才能捕获
} catch (e) {
  console.log("threw:", e.message);
}
console.log("=== validate({query:'echo'}) ===");
const r = await def.execute({ query: "echo" }, {});
console.log("ok:", r.text);
