/**
 * Unit check of the client's rule normalization:
 *   - a rule written by an older version keeps its label/hint values
 *   - a new rule carries only id/name/css/enabled/updatedAt
 *   - empty legacy fields are dropped (absent input contributes no keys)
 * Run: node test/unit-normalize.mjs
 */
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const start = source.indexOf('function normalizeRule(raw, index)');
const end = source.indexOf('function normalizeRules(input)');
if (start === -1 || end === -1) throw new Error('normalizeRule not found in the bundle');

const prelude = [
    'const MAX_CSS_BYTES = 200 * 1024;',
    'const t = (key) => key;',
    'let seed = 0;',
    'function newId() { seed += 1; return "gen-" + seed; }',
    'function nowIso() { return "2026-01-01T00:00:00.000Z"; }',
    'function byteLength(text) { return text.length; }',
].join('\n');

const normalizeRule = new Function(`${prelude}\n${source.slice(start, end)}\nreturn normalizeRule;`)();

const results = [];
function check(label, ok, detail) {
    results.push(ok === true);
    console.log((ok === true ? 'PASS  ' : 'FAIL  ') + label + (detail === undefined ? '' : '   [' + detail + ']'));
}

const legacy = normalizeRule({ id: 'x', name: '旧规则', css: 'body{}', enabled: true, label: '老标签', hint: '老备注' }, 0);
check('legacy label survives normalization', legacy.label === '老标签', JSON.stringify(legacy.label));
check('legacy hint survives normalization', legacy.hint === '老备注', JSON.stringify(legacy.hint));

const fresh = normalizeRule({ id: 'y', name: '新规则', css: 'body{}', enabled: false }, 1);
check('new rule carries exactly the five owned fields',
    Object.keys(fresh).sort().join(',') === 'css,enabled,id,name,updatedAt',
    Object.keys(fresh).join(','));

const repaired = normalizeRule({ css: 'body{}' }, 2);
check('a rule without a name gets one', typeof repaired.name === 'string' && repaired.name !== '', repaired.name);
check('a rule without an id gets one', typeof repaired.id === 'string' && repaired.id !== '', repaired.id);
check('enabled defaults to true', repaired.enabled === true);
check('css is preserved verbatim', repaired.css === 'body{}');
check('missing css reads as an empty string', normalizeRule({ name: 'no css' }, 5).css === '');

const oversized = normalizeRule({ name: 'too big', css: 'x'.repeat(200 * 1024 + 1) }, 3);
check('oversized css is rejected', oversized === null);

const junk = normalizeRule('not an object', 4);
check('non-object entry is rejected', junk === null);

console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' checks passed');
process.exit(results.every(Boolean) ? 0 : 1);
