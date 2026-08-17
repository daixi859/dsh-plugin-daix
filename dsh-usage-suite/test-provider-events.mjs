// Sanity check for the provider-switch push subscription: exercise the slot
// registration's providerEvents prop against a fake shared ModelDirectory.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./lib/client.js", import.meta.url), "utf8");
let entry;
globalThis.window = {
	__ModuleLoader__: {
		load: (record) => { entry = record.factory((name) => { if (name === "react") return { createElement: () => null, Fragment: "Fragment" }; throw new Error("module not provided: " + name); }); }
	}
};
globalThis.document = {
	querySelector: () => null,
	createElement: () => ({ style: {}, dataset: {}, set textContent(v) { this._t = v; }, get textContent() { return this._t ?? ""; } }),
	head: { appendChild: () => {} }
};
(0, eval)(source);
assert.ok(entry && typeof entry.apply === "function", "bundle exports apply");

// Fake shared ModelDirectory store (what the "modelDirectories" service exposes).
let current = { provider: "deepseek-official", model: "glm-5.3" };
const listeners = new Set();
const directory = {
	subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
	getSnapshot: () => ({ current, status: "ready" })
};
const servicePresent = { directoryFor: (sessionId) => { assert.equal(sessionId, "session-test"); return directory; } };

let modelDirectoriesPresent = false;
const registered = [];
const fakeScope = {
	get: (name) => {
		if (name === "connection") return { api: { sessions: {}, events: {} } };
		if (name === "modelDirectories") return modelDirectoriesPresent ? servicePresent : undefined;
		return undefined;
	},
	slots: { register: (def) => { registered.push(def); return () => {}; } },
	effect: (fn) => { fn(); return () => {}; }
};
const fakeCtx = {
	effect: (fn) => { fn(); return () => {}; },
	inject: (deps, fn) => {
		if (deps.includes("modelDirectories") && !modelDirectoriesPresent) return; // cordis defers absent services
		fn(fakeScope);
	},
	locale: { register: () => () => {} }
};

// 1) Service absent: modelDirectories branch defers, slot still registers,
//    providerEvents degrades gracefully to undefined.
entry.apply(fakeCtx);
assert.equal(registered.length, 1, "dock slot registered without modelDirectories");
let face = registered[0].inject("session-test");
assert.equal(typeof face.provider, "function");
assert.equal(face.providerEvents(() => {}), undefined, "no service -> undefined stop");

// 2) Service present: re-apply, providerEvents subscribes to the directory.
modelDirectoriesPresent = true;
registered.length = 0;
entry.apply(fakeCtx);
assert.equal(registered.length, 1, "second apply registers its slot");
face = registered[0].inject("session-test");
assert.equal(typeof face.providerEvents, "function");

const fired = [];
const stop = face.providerEvents((provider) => fired.push(provider));
assert.equal(typeof stop, "function", "returns unsubscribe");
const push = () => { for (const fn of [...listeners]) fn(); };

push();
assert.deepEqual(fired, [], "no fire without change");

current = { provider: "opencode-go", model: "glm-5.3" };
push();
assert.deepEqual(fired, ["opencode-go"], "fires on provider switch");

current = { provider: "opencode-go", model: "glm-5.2" };
push();
assert.deepEqual(fired, ["opencode-go"], "model-only change stays silent");

current = { provider: "zhipu", model: "glm-5.2" };
push();
assert.deepEqual(fired, ["opencode-go", "zhipu"], "fires for unmapped provider too");

stop();
current = { provider: "deepseek-official", model: "glm-5.3" };
push();
assert.deepEqual(fired, ["opencode-go", "zhipu"], "silent after unsubscribe");

console.log("provider-events subscription: all assertions passed");
