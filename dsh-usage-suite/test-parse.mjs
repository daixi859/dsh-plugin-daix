// Offline sanity test for dsh-usage-suite host parsing (run with node).
import { parseOcgoSSR, parseDurationToSec, normalizeCookie } from "./lib/index.js";

let failures = 0;
const check = (name, actual, expected) => {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (!ok) {
		failures++;
		console.error("FAIL " + name + "\n  actual:   " + JSON.stringify(actual) + "\n  expected: " + JSON.stringify(expected));
	} else {
		console.log("ok   " + name);
	}
};

// English dashboard (ocgo plugin's known-good shape)
const enHtml = [
	'<div data-slot="usage-item"><div data-slot="usage-header"><span data-slot="usage-label">Rolling usage</span>',
	'<span data-slot="usage-value"><!--$-->4<!--/-->%</span></div>',
	'<div data-slot="progress"><div data-slot="progress-bar" style="width:4%"></div></div>',
	'<span data-slot="reset-time"><!--$-->Resets in<!--/--> <!--$-->2 hours 29 minutes<!--/--></span></div>',
	'<div data-slot="usage-item"><div data-slot="usage-header"><span data-slot="usage-label">Weekly usage</span>',
	'<span data-slot="usage-value"><!--$-->22<!--/-->%</span></div>',
	'<div data-slot="progress"><div data-slot="progress-bar" style="width:22%"></div></div>',
	'<span data-slot="reset-time"><!--$-->Resets in<!--/--> <!--$-->15 hours 40 minutes<!--/--></span></div>',
	'<div data-slot="usage-item"><div data-slot="usage-header"><span data-slot="usage-label">Monthly usage</span>',
	'<span data-slot="usage-value"><!--$-->100<!--/-->%</span></div>',
	'<div data-slot="progress"><div data-slot="progress-bar" style="width:100%"></div></div>',
	'<span data-slot="reset-time"><!--$-->Resets in<!--/--> <!--$-->27 days 17 hours<!--/--></span></div>'
].join("");
check("parseOcgoSSR en", parseOcgoSSR(enHtml), [
	{ key: "rolling", label: "rolling", kind: "percent", percent: 4, resetInSec: 2 * 3600 + 29 * 60, status: "ok" },
	{ key: "weekly", label: "weekly", kind: "percent", percent: 22, resetInSec: 15 * 3600 + 40 * 60, status: "ok" },
	{ key: "monthly", label: "monthly", kind: "percent", percent: 100, resetInSec: 27 * 86400 + 17 * 3600, status: "rate-limited" }
]);

// Chinese dashboard (real page captured 2026-08-16)
const zhHtml = [
	'<div data-hk="a" data-slot="usage-item"><div data-slot="usage-header"><span data-slot="usage-label">滚动用量</span>',
	'<span data-slot="usage-value"><!--$-->0<!--/-->%</span></div>',
	'<div data-slot="progress"><div data-slot="progress-bar" style="width:0%"></div></div>',
	'<span data-slot="reset-time"><!--$-->重置于<!--/--> <!--$-->28 分钟<!--/--></span></div>',
	'<div data-hk="b" data-slot="usage-item"><div data-slot="usage-header"><span data-slot="usage-label">每周用量</span>',
	'<span data-slot="usage-value"><!--$-->22<!--/-->%</span></div>',
	'<div data-slot="progress"><div data-slot="progress-bar" style="width:22%"></div></div>',
	'<span data-slot="reset-time"><!--$-->重置于<!--/--> <!--$-->15 小时 40 分钟<!--/--></span></div>',
	'<div data-hk="c" data-slot="usage-item"><div data-slot="usage-header"><span data-slot="usage-label">每月用量</span>',
	'<span data-slot="usage-value"><!--$-->11<!--/-->%</span></div>',
	'<div data-slot="progress"><div data-slot="progress-bar" style="width:11%"></div></div>',
	'<span data-slot="reset-time"><!--$-->重置于<!--/--> <!--$-->27 天 17 小时<!--/--></span></div>'
].join("");
check("parseOcgoSSR zh", parseOcgoSSR(zhHtml), [
	{ key: "rolling", label: "rolling", kind: "percent", percent: 0, resetInSec: 28 * 60, status: "ok" },
	{ key: "weekly", label: "weekly", kind: "percent", percent: 22, resetInSec: 15 * 3600 + 40 * 60, status: "ok" },
	{ key: "monthly", label: "monthly", kind: "percent", percent: 11, resetInSec: 27 * 86400 + 17 * 3600, status: "ok" }
]);

check("parse empty page", parseOcgoSSR("<html><body>sign in</body></html>"), []);

check("duration en", parseDurationToSec("2 hours 29 minutes"), 2 * 3600 + 29 * 60);
check("duration zh", parseDurationToSec("15 小时 40 分钟"), 15 * 3600 + 40 * 60);
check("duration days zh", parseDurationToSec("27 天 17 小时"), 27 * 86400 + 17 * 3600);
check("duration minutes", parseDurationToSec("28 minutes"), 28 * 60);
check("duration seconds", parseDurationToSec("45 seconds"), 45);

check("cookie bare", normalizeCookie("Fe26.2**abc"), "auth=Fe26.2**abc; oc_locale=en");
check("cookie full zh", normalizeCookie("oc_locale=zh; auth=Fe26.2**abc"), "auth=Fe26.2**abc; oc_locale=en");
check("cookie full en", normalizeCookie("auth=Fe26.2**abc; oc_locale=en"), "auth=Fe26.2**abc; oc_locale=en");
check("cookie junk", normalizeCookie("hello"), undefined);

if (failures > 0) {
	console.error("\n" + failures + " failure(s)");
	process.exit(1);
}
console.log("\nall parser tests passed");
