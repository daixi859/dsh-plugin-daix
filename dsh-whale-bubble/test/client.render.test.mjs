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
// 5h 的重置点落在当天：取 3 小时后而非 1 小时后，这样任何时刻跑都不会跨到次日、
// 让"5h 只报 HH:MM"的断言随时钟翻红。
const sameDayOffset = (h) => {
  const d = new Date();
  const at = new Date(d.getTime() + h * 3600 * 1000);
  return new Date(at.getFullYear(), at.getMonth(), at.getDate(), Math.min(23, at.getHours()), 0, 0).toISOString();
};
const RESET = sameDayOffset(3);
const WEEK = new Date(Date.now() + 3 * 86400 * 1000).toISOString();   // 3 天后
const SOON = new Date(Date.now() + 9 * 60 * 1000).toISOString();      // 9 分钟后（urgent）
const SNAPSHOT = {
  ok: true, visible: true,
  workspace: { title: "dsh-plugin-daix", path: "D:\\wsl\\dsh-plugin-daix" },
  providers: [
    { id: "deepseek", label: "DeepSeek", short: "DS", status: "ok", quota: null, windows: [], balanceText: "¥53.20", envRef: "DEEPSEEK_API_KEY" },
    { id: "zai", label: "Z.ai / 智谱 GLM", short: "Z.ai", status: "ok", quota: null,
      windows: [ { label: "5h", percent: 34.2, resetsAt: RESET }, { label: "周", percent: 12.5, resetsAt: WEEK } ],
      balanceText: null, envRef: "ZAI_API_KEY" },
    { id: "opendesign", label: "OpenDesign", short: "OD", status: "ok", quota: null,
      windows: [ { label: "5h", percent: 45, resetsAt: SOON }, { label: "7d", percent: 8.3, resetsAt: WEEK } ],
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
const labelOf = (el) => el.querySelector(".wb-prov, .wb-qname").textContent;
const labels = [...card.querySelectorAll(".wb-row, .wb-quota")].map(labelOf);
assert.deepEqual(labels, ["DS", "Z.ai", "OD"], "行序应为 DS → Z.ai → OD，实际：" + labels.join(","));

// DS 余额行：只有一个数额，右对齐
const dsRow = card.querySelectorAll(".wb-row")[0];
assert.ok(dsRow.querySelector(".wb-val").textContent.includes("¥53.20"), "DS 余额行，实际：" + dsRow.textContent);

// 套餐行：每行两列窗口（5h / 周），每列自带百分比、进度条与重置时间
const quotaRows = [...card.querySelectorAll(".wb-quota")];
assert.equal(quotaRows.length, 2, "应有 Z.ai / OD 两行套餐配额，实际 " + quotaRows.length);
const pending = [];
const take = (row) => [...row.querySelectorAll(".wb-win")].map((win) => ({
    lab: win.querySelector(".wb-winlab").textContent,
    pct: win.querySelector(".wb-winpct").textContent,
    bar: win.querySelector(".wb-meter i").style.width,
    rel: win.querySelector(".wb-rel").textContent,
    abs: win.querySelector(".wb-abs").textContent,
  }));
pending.push(...take(quotaRows[0]), ...take(quotaRows[1]));
assert.deepEqual(pending.map((w) => w.lab), ["5h", "周", "5h", "周"], "窗口顺序应为 5h/周 ×2");
assert.deepEqual(pending.map((w) => w.pct), ["34.2%", "12.5%", "45%", "8.3%"], "各窗口百分比（7d 归一为 周）");
assert.deepEqual(pending.map((w) => w.bar), ["34.2%", "12.5%", "45%", "8.3%"], "进度条宽度应对应各自百分比");

// 重置时间：每个窗口都有"还剩多久"（相对）与绝对时点，且两段都非空
for (const w of pending) {
  assert.ok(w.rel && w.rel !== "—", w.lab + " 缺少剩余时长，实际：" + w.rel);
  assert.ok(w.abs && w.abs !== "—", w.lab + " 缺少绝对时点，实际：" + w.abs);
}
// 5h 窗只报时刻（同日），周窗带"周X"前缀
assert.ok(/^\d{2}:\d{2}$/.test(pending[0].abs), "5h 绝对时点应为 HH:MM，实际：" + pending[0].abs);
assert.ok(/^周[一二三四五六日]/.test(pending[1].abs), "周重置应带周几，实际：" + pending[1].abs);
assert.ok(!card.textContent.includes("$12.34"), "卡片不应显示 OD 钱包余额");
assert.ok(card.querySelector("style") === null, "样式应注入到 head 而非卡片内");

// 低于 30 分钟：倒计时整行转 error 色（urgent），且相对剩余是分钟级写法
const whens = [...card.querySelectorAll(".wb-when")];
const urgent = whens.filter((el) => el.classList.contains("urgent"));
assert.equal(urgent.length, 1, "应恰好一个 urgent 窗口（OD 5h），实际 " + urgent.length);
assert.ok(/^9m$/.test(urgent[0].querySelector(".wb-rel").textContent), "urgent 剩余时长应为 9m，实际：" + urgent[0].textContent);

// 四个窗口都有重置时间行（5h/周 ×2），且各自带相对 + 绝对两段
assert.equal(whens.length, 4, "四个窗口都应渲染重置时间行，实际 " + whens.length);
for (const el of whens) {
  assert.ok(el.querySelector(".wb-rel") && el.querySelector(".wb-abs"), "重置时间行应含相对与绝对两段");
}

// 已过重置点：写"已重置"，不能显示成 "<1m" 让人误以为还有额度
const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const EXPIRE_SNAPSHOT = {
  ...SNAPSHOT,
  providers: [
    SNAPSHOT.providers[0],
    { ...SNAPSHOT.providers[1], windows: [ { label: "5h", percent: 10, resetsAt: past }, { label: "周", percent: 5, resetsAt: WEEK } ] },
    SNAPSHOT.providers[2],
  ],
};
// 换一份快照要重新挂载：组件只在首挂载时拉 state，原地 setState 不会重读 mock。
let liveRoot = root;
async function mountWith(snapshot) {
  globalThis.fetch = () => Promise.resolve({ json: () => Promise.resolve(snapshot) });
  liveRoot.unmount();
  const hostNode = document.createElement("div");
  document.body.appendChild(hostNode);
  liveRoot = ReactDOMClient.createRoot(hostNode);
  liveRoot.render(renderFn());
  await flush();
  hostNode.querySelector(".wb-whale").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  await flush();
  return hostNode.querySelector(".wb-card");
}

// 缺失 resetsAt：整行只留一个「—」，不留空相对段、不画时钟（否则会被读成"还有 0 分钟"）
const missingCard = await mountWith({
  ...SNAPSHOT,
  providers: [
    SNAPSHOT.providers[0],
    { ...SNAPSHOT.providers[1], windows: [ { label: "5h", percent: 3, resetsAt: "" }, { label: "周", percent: 2, resetsAt: "" } ] },
    SNAPSHOT.providers[2],
  ],
});
const missingWhens = [...missingCard.querySelectorAll(".wb-when")];
assert.equal(missingWhens.length, 4, "Z.ai 两个窗口仍各占一行，实际 " + missingWhens.length);
for (const el of missingWhens.slice(0, 2)) {
  assert.equal(el.querySelectorAll("span").length, 1, "缺 resetsAt 时应只有一个 — 文本节点");
  assert.equal(el.textContent, "—", "缺 resetsAt 时应显 —，实际：" + el.textContent);
  assert.equal(el.querySelector("svg"), null, "缺 resetsAt 时不画时钟图标");
}

// 单窗口兜底：只有 5h 时走 wb-single，不退化成两列空白
const singleCard = await mountWith({
  ...SNAPSHOT,
  providers: [
    SNAPSHOT.providers[0],
    { ...SNAPSHOT.providers[1], windows: [ { label: "5h", percent: 88, resetsAt: SOON } ] },
    SNAPSHOT.providers[2],
  ],
});
const singleRow = singleCard.querySelector(".wb-quota");
assert.ok(singleRow.classList.contains("wb-single"), "单窗口行应带 wb-single");
assert.equal(singleRow.querySelectorAll(".wb-win").length, 1, "单窗口行只渲染一列");

// 跨天：5h 重置落在次日时，绝对时点前要有「明天」，而不是裸 HH:MM
const tomorrowCard = await mountWith({
  ...SNAPSHOT,
  providers: [
    SNAPSHOT.providers[0],
    { ...SNAPSHOT.providers[1], windows: [
      { label: "5h", percent: 12, resetsAt: new Date(Date.now() + 20 * 3600 * 1000).toISOString() },
      { label: "周", percent: 6, resetsAt: WEEK },
    ] },
    SNAPSHOT.providers[2],
  ],
});
const tomorrowAbs = tomorrowCard.querySelector(".wb-win .wb-abs").textContent;
assert.ok(/^明天 \d{2}:\d{2}$/.test(tomorrowAbs) || /^\d{2}:\d{2}$/.test(tomorrowAbs),
  "5h 绝对时点应为 =明天 HH:MM= 或同日 HH:MM，实际：" + tomorrowAbs);

// 周窗判据：剩余满 7 天（168 小时）回落月-日；不足 7 天仍按周几，哪怕日历上跨了 7 天
const nearlyWeek = new Date(Date.now() + 6 * 86400 * 1000 + 23 * 3600 * 1000).toISOString();
const weekCard = await mountWith({
  ...SNAPSHOT,
  providers: [
    SNAPSHOT.providers[0],
    { ...SNAPSHOT.providers[1], windows: [
      { label: "5h", percent: 12, resetsAt: RESET },
      { label: "周", percent: 6, resetsAt: nearlyWeek },
    ] },
    SNAPSHOT.providers[2],
  ],
});
const weekAbs = weekCard.querySelectorAll(".wb-win")[1].querySelector(".wb-abs").textContent;
assert.ok(/^周[一二三四五六日] \d{2}:\d{2}$/.test(weekAbs), "剩余不足 7 天的周窗应报周几（不看日历日差），实际：" + weekAbs);

const overWeek = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();
const overWeekCard = await mountWith({
  ...SNAPSHOT,
  providers: [
    SNAPSHOT.providers[0],
    { ...SNAPSHOT.providers[1], windows: [
      { label: "5h", percent: 12, resetsAt: RESET },
      { label: "周", percent: 6, resetsAt: overWeek },
    ] },
    SNAPSHOT.providers[2],
  ],
});
const overWeekAbs = overWeekCard.querySelectorAll(".wb-win")[1].querySelector(".wb-abs").textContent;
assert.ok(/^\d{2}-\d{2} \d{2}:\d{2}$/.test(overWeekAbs), "剩余满 7 天的周窗应回落月-日，实际：" + overWeekAbs);
const expiredCard = await mountWith(EXPIRE_SNAPSHOT);
const expiredRel = expiredCard.querySelector(".wb-rel");
assert.equal(expiredRel.textContent, "已重置", "过期窗口应显示已重置，实际：" + expiredRel.textContent);
liveRoot.unmount();
console.log("client 渲染自检：ok（行序 DS→Z.ai→OD，5h/周 双列并排，相对+绝对重置时间，urgent 转红，过期写已重置，缺 resetsAt 只显 —）");