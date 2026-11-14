/**
 * Headless verification harness for dsh-css-override.
 *
 * Runs the REAL client bundle against a stub DOM/React and the LIVE host routes
 * on the DSH port, then asserts the contract:
 *   - one <style data-plugin-css="dsh-css-override/rules"> that is the LAST
 *     element child of <body>
 *   - exactly the enabled rules are injected, verbatim
 *   - toggling a rule rewrites that stylesheet AND the durable JSON document
 *   - the settings page renders (title, toolbar, rows, badges, path, status)
 *   - disposing the plugin removes the injected stylesheet
 *
 * The stub DOM/React here are NOT a browser: layout and real CSS cascade are
 * covered by test/browser-check.ps1, which runs the same bundle in headless
 * Chrome/Edge. Run: node test/harness.mjs
 */
import { readFileSync } from 'node:fs';
import { createStubDocument, createStubReact, loadBundle } from './stub-env.mjs';

const BASE = process.env.DSH_WEB_URL || 'http://127.0.0.1:3080';
const RULES_FILE = process.env.DSH_CSS_OVERRIDE_FILE || 'C:/Users/daixi/.dsh/css-override/rules.json';

const results = [];
function check(label, condition, detail) {
    results.push({ label, ok: condition === true });
    console.log((condition === true ? 'PASS  ' : 'FAIL  ') + label + (detail === undefined ? '' : '   [' + detail + ']'));
}

/* ------------------------------------------------------------------ *
 * Deterministic seed: a known rule set written straight to the host file,
 * so a run never inherits what the previous run toggled. Whatever the
 * document held before is captured and put back at the end of the run.
 * ------------------------------------------------------------------ */
const preread = await (await fetch(BASE + '/api/dsh-css-override/load')).json();
const ORIGINAL = { rules: preread.rules || [] };
const SEED = [{
    id: 'harness-1', name: '探针规则', css: 'body{outline:3px solid magenta}\n.dco_probe{color:red}',
    enabled: true, label: '探针', hint: '自检',
}];
const seedResponse = await fetch(BASE + '/api/dsh-css-override/save', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rules: SEED }),
});
const seedResult = await seedResponse.json();
check('host accepted the seed document', seedResponse.ok === true && seedResult.ok === true, JSON.stringify(seedResult).slice(0, 120));

/* ------------------------------------------------------------------ *
 * Load the real bundle.
 * ------------------------------------------------------------------ */
const document_ = createStubDocument();
const React = createStubReact();
const requests = [];
const loaded = loadBundle({ document: document_, React, onRequest: (method, url) => requests.push(method + ' ' + url) });
check('bundle registers its module id', loaded.id === 'dsh-css-override', loaded.id);
check('factory returns apply() + inject', typeof loaded.moduleExports.apply === 'function' && Array.isArray(loaded.moduleExports.inject), JSON.stringify(loaded.moduleExports.inject));

const registrations = [];
const effects = [];
loaded.moduleExports.apply({
    get: (name) => (name === 'locale' ? { bind: () => (key) => key } : undefined),
    effect: (fn, label) => { const disposer = fn(); effects.push({ label, disposer }); return disposer; },
    on: () => () => {},
    slots: {
        inject: (slot, callback) => { callback(); },
        register: (options, component) => { registrations.push({ options, component }); return () => {}; },
    },
});
check('registered into settings.plugins.tab', registrations.length === 1 && registrations[0].options.name === 'settings.plugins.tab', registrations[0] && registrations[0].options.id);

await new Promise((resolve) => setTimeout(resolve, 500));

/* ------------------------------------------------------------------ *
 * Injection contract.
 * ------------------------------------------------------------------ */
const sheetOf = () => document_.body.querySelectorAll('[data-plugin-css="dsh-css-override/rules"]');
const first = sheetOf()[0] || null;
check('exactly one injected <style>', sheetOf().length === 1, String(sheetOf().length));
check('injected <style> is the LAST element child of <body>', first !== null && document_.body.lastElementChild === first);
check('injected <style> lives inside <body>', first !== null && first.parentElement === document_.body);
check('host route was fetched at startup', requests.some((r) => r === 'GET /api/dsh-css-override/load'), requests.join(', '));
check('enabled rule text is injected verbatim', first !== null && first.textContent.includes('outline:3px solid magenta'), first === null ? 'no sheet' : JSON.stringify(first.textContent.slice(0, 80)));
check('rule name rides as a comment', first !== null && first.textContent.includes('/* dsh-css-override: 探针规则 */'));

/* ------------------------------------------------------------------ *
 * The settings page.
 * ------------------------------------------------------------------ */
const host = document_.createElement('div');
const Page = registrations[0].component;
/** Render the page once; the store owns all UI state that must survive. */
function paint() {
    host.childNodes = [];
    host.appendChild(React.__renderNode(React.createElement(Page, {})));
    React.__flushEffects();
    return host;
}
for (let i = 0; i < 3; i++) {
    paint();
    await new Promise((resolve) => setTimeout(resolve, 60));
}
const text = host.textContent;
const nameEl = host.querySelectorAll('.dco_name')[0];
check('rule title element rendered', nameEl !== undefined, nameEl === undefined ? 'no .dco_name' : JSON.stringify(nameEl.textContent));
/* An <input>'s value is not textContent, so field copy is read via the tree. */
const renderedText = () => host.descendants().map((el) => el.textContent + ' ' + (el.value === undefined ? '' : el.value) + ' ' + (el.placeholder === undefined ? '' : el.placeholder)).join(' ');
check('page shows the plugin title', text.includes('CSS 覆盖'), 'len=' + text.length);
check('page shows the new-rule button', text.includes('新建规则'));
check('page shows the export button', text.includes('导出 CSS'));
check('page shows the rule name', renderedText().includes('探针规则'), JSON.stringify(text.slice(0, 220)));
check('page shows the enabled badge', text.includes('已启用'));
check('page shows the durable file path', text.includes('rules.json'), RULES_FILE);
check('page shows the storage status chip', /已落盘|保存中|离线/.test(text));

/* ------------------------------------------------------------------ *
 * Toggle: page → injected sheet → durable file.
 * ------------------------------------------------------------------ */
const switchOf = () => paint().querySelectorAll('button').filter((b) => b.className.includes('dco_sw'))[0];
const firstSwitch = switchOf();
check('page renders one switch per rule', firstSwitch !== undefined, firstSwitch === undefined ? 'none' : 'ok');
firstSwitch.dispatch('click', {});
await new Promise((resolve) => setTimeout(resolve, 700));
const sheetAfter = sheetOf()[0];
check('disabling a rule empties the injected sheet', sheetAfter !== null && sheetAfter.textContent.trim() === '', sheetAfter === null ? 'no sheet' : JSON.stringify(sheetAfter.textContent));
const diskAfter = JSON.parse(readFileSync(RULES_FILE, 'utf8'));
check('disabled state was written to disk', diskAfter.rules.length === 1 && diskAfter.rules[0].enabled === false, JSON.stringify(diskAfter.rules.map((r) => ({ id: r.id, enabled: r.enabled }))));
check('revision advanced on the host', diskAfter.revision > 1, String(diskAfter.revision));

switchOf().dispatch('click', {});
await new Promise((resolve) => setTimeout(resolve, 700));
const sheetBack = sheetOf()[0];
check('re-enabling restores the injected CSS', sheetBack !== null && sheetBack.textContent.includes('outline:3px solid magenta'), sheetBack === null ? 'no sheet' : JSON.stringify(sheetBack.textContent.slice(0, 60)));
check('still exactly one sheet after edits', sheetOf().length === 1);

/* ------------------------------------------------------------------ *
 * Editor: expanding a row must survive a store re-render.
 * ------------------------------------------------------------------ */
const expander = paint().querySelectorAll('button').filter((b) => b.className.includes('dco_acts') === false && b.getAttribute('title') === '编辑')[0];
if (expander !== undefined) {
    expander.dispatch('click', {});
    await new Promise((resolve) => setTimeout(resolve, 80));
    paint();
    const area = host.querySelector('textarea');
    check('expanding a rule opens the editor', area !== null, area === null ? 'no textarea' : area.value.length + ' chars');
    check('editor keeps the rule CSS', area !== null && area.value.includes('outline:3px solid magenta'));
} else {
    check('expander button found', false, 'no edit button rendered');
}

/* ------------------------------------------------------------------ *
 * Dispose.
 * ------------------------------------------------------------------ */
const engine = effects.find((e) => typeof e.label === 'string' && e.label.includes('injection engine'));
check('injection engine registered an effect', engine !== undefined, engine && engine.label);
if (engine !== undefined) {
    engine.disposer();
    check('dispose removes the injected <style>', sheetOf().length === 0, String(sheetOf().length));
}

/* ------------------------------------------------------------------ *
 * Put the document back the way this run found it.
 * ------------------------------------------------------------------ */
const after = await (await fetch(BASE + '/api/dsh-css-override/load')).json();
const restoreResponse = await fetch(BASE + '/api/dsh-css-override/save', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rules: ORIGINAL.rules, revision: after.revision }),
});
const restoreResult = await restoreResponse.json();
check('document restored to its pre-run content', restoreResponse.ok === true && restoreResult.count === ORIGINAL.rules.length,
    ORIGINAL.rules.length + ' rules, revision ' + restoreResult.revision);

const failed = results.filter((r) => r.ok !== true);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
process.exit(failed.length === 0 ? 0 : 1);
