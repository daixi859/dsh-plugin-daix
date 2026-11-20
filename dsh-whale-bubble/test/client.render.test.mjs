// whale-bubble client 面渲染自检：happy-dom + 真 React 18 离线渲染 HoverCard。
// 依赖：happy-dom（可选，缺失时 SKIP）；react/react-dom 取 DSH web profile 的 pnpm 共享目录。
// 运行：node dsh-whale-bubble/test/client.render.test.mjs
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const PNPM_SHARED = join(homedir(), ".dsh", "profiles", "web", "node_modules", ".pnpm", "node_modules");
const require2 = createRequire(PNPM_SHARED + "/");
let Window, happyLoaded = true;
try {
  const happyPath = "file://" + join(tmpdir(), "wb-domtest", "node_modules", "happy-dom", "lib", "index.js").replaceAll("\\", "/");
  ({ Window } = await import(happyPath));
} catch (e) {
  happyLoaded = false;
  console.log("happy-dom 加载失败:", e.message);
}
if (!happyLoaded) {
  console.log("SKIP: happy-dom 未安装（%TEMP%\\wb-domtest）");
  process.exit(0);
}

const win = new Window({ url: "http://localhost/" });
globalThis.window = win;
globalThis.document = win.document;
Object.defineProperty(globalThis, "navigator", { value: win.navigator, configurable: true });
globalThis.MouseEvent = win.MouseEvent;

const React = require2("react");
const ReactDOMClient = require2("react-dom/client");

// mock snapshot：三家全 ok，DS 置顶、zai 5h+周、od 5h+7d+钱包
const RESET = new Date(Date.now() + 3600 * 1000).toISOString();
const SNAPSHOT = {
  ok: true, visible: true,
  workspace: { title: "dsh-plugin-daix", path: "D:\\wsl\\dsh-plugin-daix" },
  providers: [
    { id: "deepseek", label: "DeepSeek", short: "DS", status: "ok", quota: null, windows: [], balanceText: "¥53.20", envRef: "DEEPSEEK_API_KEY" },
    { id: "zai", label: "Z.ai / 智谱 GLM", short: "Z.ai", status: "ok", quota: null,
      windows: [ { label: "5h", percent: 34.2, resetsAt: RESET }, { label: "周", percent: 12.5, resetsAt: "" } ],
      balanceText: null, envRef: "ZAI_API_KEY" },
    { id: "opendesign", label: "OpenDesign", short: "OD", status: "ok", quota: null,
      windows: [ { label: "5h", percent: 45, resetsAt: RESET }, { label: "7d", percent: 8.3, resetsAt: "" } ],
      balanceText: "$12.34", envRef: "OPENDESIGN_KEY" },
  ],
};
globalThis.fetch = () => Promise.resolve({ json: () => Promise.resolve(SNAPSHOT) });

let factory = null;
win.__ModuleLoader__ = { load(def) { factory = def.factory; } };

const clientSrc = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
const run = new Function("window", clientSrc + "\n//# sourceURL=whale-client.js");
run(win);

assert.ok(factory, "ModuleLoader.load 未捕获 factory");
const exports = factory((name) => {
  if (name === "react") return React;
  throw new Error("unexpected require: " + name);
});

const renders = {};
const ctxObj = {
  get(n) {
    if (n === "slots") {
      return {
        inject(_slot, fn) { fn(); },
        register(meta, fn) { renders[meta.name] = fn; },
      };
    }
    return undefined;
  },
  interval() { return () => {}; },
  timeout() { return () => {}; },
};
exports.apply(ctxObj);
const renderFn = renders["shell.overlay"];
assert.ok(renderFn, "shell.overlay render 未捕获");

const flush = () => new Promise((r) => setTimeout(r, 30));
const host = document.createElement("div");
document.body.appendChild(host);
const root = ReactDOMClient.createRoot(host);
root.render(renderFn());
await flush();

assert.ok(document.querySelector(".wb-whale"), "气泡图标未挂载");
// hover：React 合成事件监听 mouseover
const whale = document.querySelector(".wb-whale");
whale.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
await flush();

const card = document.querySelector(".wb-card");
assert.ok(card, "hover 卡片未出现");
const provs = [...card.querySelectorAll(".wb-row .wb-prov")].map((el) => el.textContent);
assert.deepEqual(provs, ["DS", "Z.ai", "OD"], "行序应为 DS → Z.ai → OD，实际：" + provs.join(","));
const vals = [...card.querySelectorAll(".wb-row .wb-val")].map((el) => el.textContent);
assert.ok(vals[0].includes("¥53.20"), "DS 余额行，实际：" + vals[0]);
assert.ok(vals[1].includes("5h 34.2%") && vals[1].includes("周 12.5%"), "Z.ai 合并行，实际：" + vals[1]);
assert.ok(vals[1].includes("重置") === false, "Z.ai 行不应有'重置'字样（只留时点）");
assert.ok(vals[2].includes("5h 45%") && vals[2].includes("周 8.3%"), "OD 合并行（7d→周），实际：" + vals[2]);
assert.ok(!card.textContent.includes("$12.34"), "卡片不应显示 OD 钱包余额");
const meterGroups = [...card.querySelectorAll(".wb-meters")];
assert.equal(meterGroups.length, 2, "应有两组双进度条，实际 " + meterGroups.length);
for (const g of meterGroups) {
  assert.equal(g.querySelectorAll(".wb-meter").length, 2, "每组应两根条（左5h右周）");
}
// 重置时间以 small 呈现在 zai 行
assert.ok(card.querySelector(".wb-row .wb-val small"), "5h 重置时间 small 缺失");
// 样式注入
assert.ok(document.querySelector("style[data-plugin-css]"), "插件样式未注入");

root.unmount();
console.log("client 渲染自检：ok（行序 DS→Z.ai→OD，5h/周合并行，双条并排，无钱包行）");