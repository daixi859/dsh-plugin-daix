/**
 * Loads a copy of the client bundle whose free variables resolve to the
 * probe's stub DOM. The bundle is read from disk and evaluated inside THIS
 * module, so its captured `document` is the stub — no annex needed, and the
 * probe keeps the real global `document` for logging.
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.DSH_WEB_URL || 'http://127.0.0.1:3080';
const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

/* Stub DOM: a minimal Element/TextNode tree with dataset, style and events. */
export class StubNode {
    constructor() { this.parentNode = null; this.childNodes = []; }
    appendChild(child) {
        if (process.env.DCO_TRACE === '1') {
            console.log('[stubNode.appendChild] parent =', this.tagName || this.constructor.name, '| child =', child === null ? 'null' : (child && child.__component ? 'COMPONENT' : (child && child.tagName) || typeof child));
        }
        if (child === null || child === undefined) return child;
        if (Array.isArray(child)) { for (const c of child) this.appendChild(c); return child; }
        child.parentNode = this;
        this.childNodes.push(child);
        return child;
    }
    removeChild(child) { this.childNodes = this.childNodes.filter((c) => c !== child); return child; }
    remove() { if (this.parentNode !== null) this.parentNode.removeChild(this); }
    get isConnected() { let n = this; while (n.parentNode !== null) n = n.parentNode; return n.__document === true; }
    get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
}
export class StubText extends StubNode {
    constructor(data) { super(); this.data = String(data); }
    get textContent() { return this.data; }
    set textContent(v) { this.data = String(v); }
}
export class StubElement extends StubNode {
    constructor(tag) {
        super();
        this.tagName = String(tag).toUpperCase();
        this.dataset = {}; this.style = {}; this.attributes = {}; this.listeners = {}; this.className = '';
    }
    set textContent(value) { this.childNodes = String(value) === '' ? [] : [new StubText(value)]; }
    get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
    setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'class') this.className = String(v); }
    getAttribute(k) { return this.attributes[k] === undefined ? null : this.attributes[k]; }
    get parentElement() { return this.parentNode !== null && this.parentNode.tagName !== undefined ? this.parentNode : null; }
    get lastElementChild() { const kids = this.childNodes.filter((c) => c.tagName !== undefined); return kids.length === 0 ? null : kids[kids.length - 1]; }
    get firstElementChild() { return this.childNodes.filter((c) => c.tagName !== undefined)[0] || null; }
    get value() { return this._value === undefined ? '' : this._value; }
    set value(v) { this._value = v; }
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
    removeEventListener(t, fn) { const list = this.listeners[t]; if (list === undefined) return; const i = list.indexOf(fn); if (i !== -1) list.splice(i, 1); }
    /** Fire listeners as a real click would (used by the tests). */
    dispatch(type, event) { for (const fn of (this.listeners[type] || []).slice()) fn(Object.assign({ type, target: this, currentTarget: this }, event)); }
    descendants(out = []) { for (const c of this.childNodes) { if (c.tagName !== undefined) { out.push(c); c.descendants(out); } } return out; }
    querySelectorAll(sel) { return this.descendants().filter((e) => e.matches(sel)); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    matches(sel) {
        const attr = /^\[data-([a-z-]+)="([^"]*)"\]$/.exec(sel);
        if (attr !== null) return this.dataset[attr[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] === attr[2];
        if (sel.startsWith('.')) return String(this.className).split(/\s+/).includes(sel.slice(1));
        return this.tagName === sel.toUpperCase();
    }
}

export function createStubDocument() {
    const html = new StubElement('html');
    const head = new StubElement('head');
    const body = new StubElement('body');
    const doc = new StubElement('#document');
    doc.__document = true;
    /* A REAL tree: #document -> html -> head/body. Without this link every
       node reports isConnected === false and the bundle's retry loop would
       legitimately mint a fresh <style> on each attempt. */
    doc.appendChild(html);
    html.appendChild(head);
    html.appendChild(body);
    doc.documentElement = html;
    doc.head = head;
    doc.body = body;
    doc.hidden = false;
    doc.createElement = (tag) => new StubElement(tag);
    doc.addEventListener = () => {};
    doc.removeEventListener = () => {};
    return doc;
}

/* Stub React: function components rendered with explicit effects flushing.
   Hook frames are keyed PER COMPONENT (by its function identity, stable across
   re-renders) so a nested component cannot read its parent's hook slots, and
   setters/refs capture their own frame so calling them from an effect or an
   event handler behaves as React's closures do. */
export function createStubReact() {
    const hookMap = new Map();
    let hookStack = [];
    let cursor = 0;
    let rerender = () => {};
    let effects = [];
    let mounted = false;

    function beginComponent(fn) {
        if (!hookMap.has(fn)) hookMap.set(fn, []);
        hookStack.push({ fn, slots: hookMap.get(fn) });
        cursor = 0;
    }
    function endComponent() { hookStack.pop(); cursor = 0; }
    function frame() { return hookStack[hookStack.length - 1]; }
    function slot(index, initial) {
        const f = frame();
        if (f.slots.length <= index) f.slots[index] = typeof initial === 'function' ? initial() : initial;
        return f.slots[index];
    }
    function setSlot(index, value, owner) {
        const f = owner === undefined ? frame() : owner;
        f.slots[index] = typeof value === 'function' ? value(f.slots[index]) : value;
        rerender();
    }

    function createElement(type, props, ...children) {
        if (type === '#') { const f = new StubElement('#fragment'); for (const c of children) put(f, c); return f; }
        if (typeof type === 'function') return { __component: type, props: Object.assign({}, props, { children }) };
        const el = new StubElement(type);
        for (const [k, v] of Object.entries(props || {})) {
            if (k === 'key' || k === 'ref' || k === 'children') continue;
            if (k === 'className') { el.className = v; continue; }
            if (k === 'style') { el.style = v; continue; }
            if (k === 'value') { el.value = v; continue; }
            if (k.startsWith('on') && typeof v === 'function') { el.addEventListener(k.slice(2).toLowerCase(), v); continue; }
            el.setAttribute(k, v);
        }
        for (const c of children) put(el, c);
        return el;
    }
    function put(parent, child) {
        if (child === null || child === undefined || typeof child === 'boolean') return;
        if (Array.isArray(child)) { for (const c of child) put(parent, c); return; }
        if (typeof child === 'object' && child.__component !== undefined) { parent.appendChild(render(child)); return; }
        if (typeof child === 'object' && child.tagName !== undefined) { parent.appendChild(child); return; }
        parent.appendChild(new StubText(child));
    }
    function render(node) {
        if (node === null || node === undefined) return new StubText('');
        beginComponent(node.__component);
        let result = null;
        try {
            result = node.__component(node.props || {});
        } catch (error) {
            endComponent();
            console.error('[stub-react] component threw:', error && error.stack ? error.stack.split('\n').slice(0, 5).join('\n') : error);
            throw error;
        }
        const root = new StubElement('#render');
        put(root, result);
        endComponent();
        return root.childNodes.length === 1 ? root.childNodes[0] : root;
    }
    function sameDeps(a, b) { return a !== undefined && b !== undefined && a.length === b.length && a.every((v, i) => Object.is(v, b[i])); }
    const React = {
        createElement, Fragment: '#',
        useState(init) { const i = cursor++; const owner = frame(); return [slot(i, init), (v) => setSlot(i, v, owner)]; },
        useRef(init) { const i = cursor++; return slot(i, { current: init }); },
        useMemo(f, deps) { const i = cursor++; const owner = frame(); let p = slot(i, undefined); if (p === undefined || !sameDeps(p.deps, deps)) { p = { deps, value: f() }; owner.slots[i] = p; } return p.value; },
        useCallback(f, deps) { return React.useMemo(() => f, deps); },
        useEffect(f, deps) { const i = cursor++; const owner = frame(); const p = slot(i, undefined); if (p === undefined || !sameDeps(p.deps, deps)) effects.push(f); owner.slots[i] = { deps }; },
        useSyncExternalStore(sub, get) { const r = React.useRef(false); if (r.current === false) { r.current = true; sub(() => rerender()); } return get(); },
        __setRerender(fn) { rerender = fn; },
        __flushEffects() { const pending = effects; effects = []; for (const fn of pending) fn(); },
        __renderNode: render,
        /** Drop every component's hook state — a first mount. */
        __resetHooks() { hookMap.clear(); hookStack = []; cursor = 0; mounted = false; },
    };
    return React;
}

/** Evaluate the real bundle with the stubs injected as its free variables. */
export function loadBundle({ document, React, locale = undefined, onRequest = undefined }) {
    let registration = null;
    const windowStub = {
        __ModuleLoader__: { load: (entry) => { registration = entry; } },
        addEventListener: () => {}, removeEventListener: () => {},
    };
    const storage = new Map();
    const fetchStub = (url, options) => {
        const full = String(url).startsWith('http') ? String(url) : BASE + String(url);
        if (onRequest !== undefined) onRequest((options && options.method) || 'GET', String(url));
        return fetch(full, options);
    };
    new Function('window', 'document', 'navigator', 'localStorage', 'fetch', 'setTimeout', 'setInterval', 'clearInterval', 'console', source)(
        windowStub,
        document,
        { language: 'zh-CN' },
        { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)) },
        fetchStub,
        setTimeout, setInterval, clearInterval,
        { log: () => {}, error: (...args) => console.error('[bundle]', ...args) },
    );
    const moduleExports = registration.factory((id) => {
        if (id === 'react') return React;
        throw new Error('unexpected require: ' + id);
    });
    return { id: registration.id, moduleExports, locale };
}
