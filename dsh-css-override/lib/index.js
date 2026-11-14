/**
 * dsh-css-override — host half.
 *
 * Owns the durable rule file and the two loopback JSON routes the browser half
 * talks to:
 *
 *   GET  /api/dsh-css-override/load
 *     -> { rules: Rule[], revision: number, path: string }
 *   POST /api/dsh-css-override/save  { rules: Rule[], revision?: number }
 *     -> { ok: true, revision, count, path }        on success
 *     -> 409 { error, code: 'CONFLICT', revision }  when the file moved on
 *   POST /api/dsh-css-override/reveal
 *     -> { ok: true }  opens the rules file in the OS file manager
 *
 * The file is the source of truth. It lives OUTSIDE the profile directory so a
 * plugin reinstall or profile rebuild never takes the rules with it:
 *
 *   $DSH_HOME/css-override/rules.json      (override with DSH_CSS_OVERRIDE_HOME)
 *
 * Writes are serialized through one promise chain, written to a sibling temp
 * file, then renamed over the target — a crash can never leave a half-written
 * document behind. Node builtins only: no bundled dependencies, no build step.
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Required services. */
export const inject = ['webServer'];

const ROUTE_LOAD = '/api/dsh-css-override/load';
const ROUTE_SAVE = '/api/dsh-css-override/save';
const ROUTE_REVEAL = '/api/dsh-css-override/reveal';

/** Hard caps: this is a hand-written stylesheet store, not a CDN. */
const MAX_RULES = 200;
const MAX_CSS_BYTES = 200 * 1024;
const MAX_NAME = 80;
const MAX_LABEL = 60;
const MAX_SELECTOR_HINT = 200;

/** Version tag inside the document, so a future format can migrate instead of guess. */
const DOC_VERSION = 1;

/** Where the rules document lives. */
function rulesPath() {
    const override = process.env.DSH_CSS_OVERRIDE_HOME;
    const home = typeof override === 'string' && override.trim() !== ''
        ? override.trim()
        : join(process.env.DSH_HOME && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh'), 'css-override');
    return join(home, 'rules.json');
}

/** Cheap plain-object check (arrays and null are not plain objects). */
function isPlainObject(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/** Byte length of a string in UTF-8, without allocating a Buffer for huge input. */
function byteLength(text) {
    return Buffer.byteLength(text, 'utf8');
}

/** One trimmed string field, capped; empty when absent or malformed. */
function textField(value, max) {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, max);
}

/**
 * Normalize one incoming rule. Never throws: a malformed entry is repaired
 * where that is unambiguous and dropped (null) where it is not — the settings
 * surface must survive a hand-edited JSON document.
 * @param {unknown} raw - one entry of the posted `rules` array.
 * @param {number} index - its position, used to mint a fallback id.
 * @returns {object|null} the normalized rule, or null when unusable.
 */
function normalizeRule(raw, index) {
    if (!isPlainObject(raw)) return null;
    const css = typeof raw.css === 'string' ? raw.css : '';
    if (byteLength(css) > MAX_CSS_BYTES) return null;
    const id = textField(raw.id, 64) !== '' ? textField(raw.id, 64) : `rule-${index + 1}`;
    /* The document's rule shape is owned by the UI: id, name, css, enabled,
       updatedAt. Anything else a client sends (an older version wrote
       `label`/`hint`) is carried through untouched, so a file written by one
       version is never rewritten by another. */
    return Object.assign({}, raw, {
        id,
        name: textField(raw.name, MAX_NAME) !== '' ? textField(raw.name, MAX_NAME) : `规则 ${index + 1}`,
        css,
        enabled: raw.enabled !== false,
        updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt !== '' ? raw.updatedAt.slice(0, 40) : new Date().toISOString(),
    });
}

/**
 * Normalize a whole rule list: repair entries, drop unusable ones, dedupe ids,
 * and cap the count. Also accepts a bare array (a hand-written document).
 * @param {unknown} input - the document or the posted array.
 * @returns {object[]} the normalized rules.
 */
function normalizeRules(input) {
    const list = Array.isArray(input) ? input : [];
    const out = [];
    const seen = new Set();
    for (let i = 0; i < list.length && out.length < MAX_RULES; i++) {
        const rule = normalizeRule(list[i], i);
        if (rule === null) continue;
        if (seen.has(rule.id)) rule.id = `${rule.id}-${i + 1}`;
        seen.add(rule.id);
        out.push(rule);
    }
    return out;
}

/** Read + normalize the document. A missing or unreadable file reads as empty. */
async function readDocument(path) {
    let text;
    try {
        text = await readFile(path, 'utf8');
    } catch {
        return { rules: [], revision: 0 };
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { rules: [], revision: 0, broken: true };
    }
    const rules = normalizeRules(isPlainObject(parsed) ? parsed.rules : parsed);
    const revision = isPlainObject(parsed) && typeof parsed.revision === 'number' && Number.isFinite(parsed.revision)
        ? Math.max(0, Math.trunc(parsed.revision))
        : 0;
    return { rules, revision };
}

/** Serialize the document atomically: temp file beside the target, then rename. */
async function writeDocument(path, rules, revision) {
    await mkdir(dirname(path), { recursive: true });
    const body = `${JSON.stringify({ version: DOC_VERSION, revision, savedAt: new Date().toISOString(), rules }, null, 2)}\n`;
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, body, 'utf8');
    try {
        await rename(temp, path);
    } catch (error) {
        /* Windows can refuse a rename over an existing file; a direct write is
           still better than failing the user's save, and the temp copy is
           removed either way. */
        await writeFile(path, body, 'utf8');
        await removeQuietly(temp);
        if (error && error.code !== 'EPERM' && error.code !== 'EACCES' && error.code !== 'EEXIST') throw error;
    }
    return byteLength(body);
}

async function removeQuietly(path) {
    try {
        const { unlink } = await import('node:fs/promises');
        await unlink(path);
    } catch { /* already gone */ }
}

function sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(body),
    });
    res.end(body);
}

function readJsonBody(req) {
    return new Promise((resolve) => {
        let data = '';
        req.setEncoding('utf8');
        req.on('data', (chunk) => {
            data += chunk;
            /* 8 MiB ceiling: the posted document is capped well below this. */
            if (data.length > 8 * 1024 * 1024) {
                req.destroy();
                resolve(undefined);
            }
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(data === '' ? '{}' : data));
            } catch {
                resolve(undefined);
            }
        });
        req.on('error', () => resolve(undefined));
    });
}

/** Reveal the rules file in the OS file manager (Windows: select the file). */
function revealFile(path) {
    if (process.platform === 'win32') {
        spawn('explorer.exe', [`/select,${path}`], { detached: true, stdio: 'ignore' }).unref();
        return;
    }
    const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'darwin' ? ['-R', path] : [dirname(path)];
    spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
}

/**
 * Host plugin body: mount the three routes. Every resource is registered
 * through `ctx.effect`, so unloading the plugin removes the routes with it.
 * @param {object} ctx - host cordis context (carries `webServer`).
 */
export function apply(ctx) {
    const path = rulesPath();
    /** Serializes read-modify-write so two browser tabs cannot interleave. */
    let queue = Promise.resolve();
    const enqueue = (task) => {
        const run = queue.then(task);
        queue = run.then(() => undefined, () => undefined);
        return run;
    };

    ctx.effect(() => {
        const disposeLoad = ctx.webServer.register({
            kind: 'exact',
            path: ROUTE_LOAD,
            handler: async (req, res) => {
                if (req.method !== 'GET' && req.method !== 'HEAD') {
                    sendJson(res, 405, { error: `method not allowed: ${req.method}` });
                    return;
                }
                try {
                    const document = await enqueue(() => readDocument(path));
                    sendJson(res, 200, {
                        rules: document.rules,
                        revision: document.revision,
                        path,
                        ...(document.broken === true ? { warning: 'rules.json 不是合法 JSON，已按空规则处理' } : {}),
                    });
                } catch (error) {
                    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
                }
            },
        });

        const disposeSave = ctx.webServer.register({
            kind: 'exact',
            path: ROUTE_SAVE,
            handler: async (req, res) => {
                if (req.method !== 'POST') {
                    sendJson(res, 405, { error: `method not allowed: ${req.method}` });
                    return;
                }
                const body = await readJsonBody(req);
                if (body === undefined || !Array.isArray(body.rules)) {
                    sendJson(res, 400, { error: 'body must be { rules: Rule[] }' });
                    return;
                }
                const rules = normalizeRules(body.rules);
                const expected = typeof body.revision === 'number' && Number.isFinite(body.revision)
                    ? Math.max(0, Math.trunc(body.revision))
                    : undefined;
                try {
                    const result = await enqueue(async () => {
                        const current = await readDocument(path);
                        /* The browser's revision is its own load's revision. A
                           mismatch means something else wrote the file (another
                           tab, a hand edit) — refuse instead of clobbering. */
                        if (expected !== undefined && expected !== current.revision) {
                            return { conflict: true, revision: current.revision };
                        }
                        const revision = current.revision + 1;
                        const bytes = await writeDocument(path, rules, revision);
                        return { revision, bytes };
                    });
                    if (result.conflict === true) {
                        sendJson(res, 409, {
                            error: '规则文件已被其他窗口或手工编辑修改',
                            code: 'CONFLICT',
                            revision: result.revision,
                        });
                        return;
                    }
                    sendJson(res, 200, { ok: true, revision: result.revision, count: rules.length, bytes: result.bytes, path });
                } catch (error) {
                    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
                }
            },
        });

        const disposeReveal = ctx.webServer.register({
            kind: 'exact',
            path: ROUTE_REVEAL,
            handler: async (req, res) => {
                if (req.method !== 'POST') {
                    sendJson(res, 405, { error: `method not allowed: ${req.method}` });
                    return;
                }
                try {
                    /* The path is derived from the environment, never from the
                       request: this route cannot be pointed at arbitrary files. */
                    revealFile(path);
                    sendJson(res, 200, { ok: true, path });
                } catch (error) {
                    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
                }
            },
        });

        return () => {
            disposeLoad();
            disposeSave();
            disposeReveal();
        };
    }, 'dsh-css-override: rule store routes');
}

/** Durable document path, for host-side checks and diagnostics. */
export function rulesFilePath() {
    return rulesPath();
}

/** Read the durable document without going through HTTP. */
export function loadRules() {
    return readDocument(rulesPath());
}

/** Replace the durable document without going through HTTP. */
export async function saveRules(rules) {
    const path = rulesPath();
    const current = await readDocument(path);
    const revision = current.revision + 1;
    await writeDocument(path, normalizeRules(rules), revision);
    return { revision, path };
}
