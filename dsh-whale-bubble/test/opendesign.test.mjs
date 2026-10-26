// OpenDesign fetcher 自检：mock subprocess 返回固定 curl 形态输出，不联网。
// 运行：node dsh-whale-bubble/test/opendesign.test.mjs
import assert from "node:assert";
import { pathToFileURL } from "node:url";

const mod = await import(pathToFileURL(new URL("../lib/index.js", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")).href);

const WORKSPACES = JSON.stringify({
  items: [{ workspaceId: "ws-1", workspaceName: "w", workspaceMemberId: "m-1", role: "owner" }],
});
const PREFLIGHT = JSON.stringify({
  schemaVersion: 1,
  workspaceId: "ws-1",
  workspaceMemberId: "m-1",
  balanceUsd: "1.3725",
  codingPlan: {
    tier: "go",
    eligible: true,
    windows: [
      { durationSeconds: 18000, usedCredits: "182", limitCredits: "50000", resetsAt: "2026-10-26T06:25:09.000Z" },
      { durationSeconds: 604800, usedCredits: "182", limitCredits: "150000", resetsAt: "2026-11-02T01:25:09.000Z" },
    ],
  },
});

const calls = [];
const requested = [];
const fakeSubprocess = {
  async resolveExecutable(n) { return n; },
  spawn(opts) {
    const url = opts.argv[opts.argv.length - 1];
    requested.push(url);
    const body = url.endsWith("/workspaces") ? WORKSPACES : PREFLIGHT;
    calls.push(opts.stdio.stdin.data);
    return {
      done: Promise.resolve({ exitCode: 0 }),
      collected: {
        stdout: { readFrom: () => ({ text: body + "\n200" }) },
        stderr: { readFrom: () => ({ text: "" }) },
      },
      terminate() {},
    };
  },
};

const routes = new Map();
const ctx = {
  get(n) {
    if (n === "subprocess") return fakeSubprocess;
    if (n === "webServer") return { register: ({ path, handler }) => { routes.set(path, handler); return () => {}; } };
    if (n === "credentials") return {
      async resolve(ref) { return ref === "OPENDESIGN_KEY" ? { value: "vela_test" } : undefined; },
    };
    return undefined;
  },
  timeout() { return () => {}; },
  interval() { return () => {}; },
  effect() {},
  on() {},
};

mod.apply(ctx);

// 直接调 refresh 路由，走真实 resolveKey → fetcher → snapshot 全链路
let payload = null;
const handler = routes.get("/plugins/whale-bubble/refresh");
assert.ok(handler, "refresh 路由未注册");
await handler(
  { on(ev, cb) { if (ev === "end") cb(); }, destroy() {} },
  { writeHead() {}, end(body) { payload = JSON.parse(body); } },
);

const od = payload.providers.find((p) => p.id === "opendesign");
assert.equal(od.status, "ok", "status 应为 ok，实际：" + od.status + " " + od.error);
assert.equal(od.envRef, "OPENDESIGN_KEY");
assert.deepEqual(od.credential, { source: "env", ref: "OPENDESIGN_KEY" });
assert.equal(od.balanceText, "$1.37");
assert.deepEqual(od.windows.map((w) => w.label), ["5h", "7d"]);
assert.equal(od.quota.label, "5h");
assert.equal(od.quota.percent, 0.4); // 182/50000 = 0.364% → 0.4
assert.equal(od.quota.resetsAt, "2026-10-26T06:25:09.000Z");

// 工作区只解析一次（模块级缓存），第二轮只有 preflight
requested.length = 0;
await handler(
  { on(ev, cb) { if (ev === "end") cb(); }, destroy() {} },
  { writeHead() {}, end() {} },
);
assert.deepEqual(requested.map((u) => u.replace("https://amr-api.open-design.ai", "")), [
  "/api/v1/workspaces/ws-1/billing/preflight",
]);

// 凭据只走 stdin，不进 argv
assert.ok(calls.every((s) => /^Authorization: Bearer vela_test$/m.test(s)), "凭据应只出现在 stdin 头");

console.log("opendesign fetcher: ok");
