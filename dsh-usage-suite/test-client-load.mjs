// Simulate the browser module loader for dsh-usage-suite's client bundle:
// catches factory-time and apply-time errors that would silently kill the chip.
import { readFileSync } from "node:fs";

const bundlePath = process.argv[2];
if (bundlePath === undefined) {
	console.error("usage: node test-client-load.mjs <client.js path>");
	process.exit(2);
}
const code = readFileSync(bundlePath, "utf8");

// Minimal React stand-in: hooks are only *called* during render, so plain
// functions satisfy import-time destructuring.
const reactStub = new Proxy(function () {}, {
	get: (target, prop) => {
		if (prop === Symbol.toPrimitive) return () => "react-stub";
		return (...args) => {
			const list = args[args.length - 1];
			if (prop === "createElement" && Array.isArray(list)) return { type: args[0], children: args.slice(1) };
			return { stub: String(prop), args };
		};
	}
});

const loaded = {};
globalThis.window = {
	__ModuleLoader__: {
		load(entry) {
			loaded[entry.id] = entry.factory((name) => {
				if (name === "react") return reactStub;
				throw new Error("module not provided to factory: " + name);
			});
		}
	}
};
globalThis.document = {
	querySelector: () => null,
	createElement: () => ({ style: {}, dataset: {}, set textContent(v) { this._t = v; }, get textContent() { return this._t ?? ""; } }),
	head: { appendChild: () => {} }
};
if (globalThis.crypto?.getRandomValues === undefined) {
	Object.defineProperty(globalThis, "crypto", { value: { getRandomValues: (arr) => { for (let i = 0; i < arr.length; i++) arr[i] = i * 7 + 1; return arr; } } });
}

try {
	// eslint-disable-next-line no-eval
	(0, eval)(code);
	const entry = loaded["dsh-usage-suite"];
	if (entry === undefined) throw new Error("bundle did not call __ModuleLoader__.load with id dsh-usage-suite");
	console.log("factory OK; exports: " + Object.keys(entry).join(", "));
	if (typeof entry.apply !== "function") throw new Error("exports.apply is missing");
	if (typeof entry.inject !== "object") throw new Error("exports.inject is missing");

	// Now drive apply() with a fake client context mirroring the real shape.
	const registrations = [];
	const effects = [];
	const injects = [];
	const fakeCtx = {
		effect(fn, label) { effects.push(label ?? "effect"); fn(); },
		inject(deps, fn) { injects.push(deps); fn(fakeCtx); },
		locale: { register(ns, dict) { console.log("locale.register ns=" + ns + " langs=" + Object.keys(dict).join(",")); return () => {}; } },
		get(service) {
			if (service === "connection") {
				return {
					api: {
						sessions: { models: async () => ({ result: { ok: true, value: { current: { provider: "opencode-go" } } } }) },
						events: { mux: async function* () { yield { rpcId: "r", payload: { type: "session/subscribed", sessionId: "s1", lastSeq: 0 } }; }() }
					}
				};
			}
			return undefined;
		},
		slots: {
			register(def, Component) {
				registrations.push({ def, Component });
				return () => {};
			}
		}
	};
	entry.apply(fakeCtx);
	console.log("apply OK; slot registrations: " + registrations.map((r) => r.def.name + "#" + r.def.id).join(", "));
	if (registrations.length === 0) throw new Error("no slot registered");

	// Drive the slot inject face + component render with stub props.
	const face = registrations[0].def.inject("session-1");
	const t = (key) => "[" + key + "]";
	const element = registrations[0].Component({ ...face, t });
	console.log("component render OK (provider-resolving render is async; element type: " + typeof element + ")");
	// Wait a tick so the async provider resolution + view fetch path runs (fetch will fail here; that is fine).
	await new Promise((resolve) => setTimeout(resolve, 50));
	console.log("\nclient bundle simulation passed");
} catch (error) {
	console.error("CLIENT BUNDLE ERROR: " + (error?.stack ?? error));
	process.exit(1);
}
