// 本地编译 mcp_search 的 parameters，dump 生成的 JSON Schema
const toolsUrl = "file:///D:/wsl/dsh-plugin-daix/.tmp-asar/dsh/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js";
const mod = await import(toolsUrl);
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
  def.execute({}, {});
} catch (e) {
  console.log("threw:", e.message);
}
console.log("=== validate({query:'echo'}) ===");
const r = await def.execute({ query: "echo" }, {});
console.log("ok:", r.text);
