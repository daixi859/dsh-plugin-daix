/**
 * Claude Lite — Claude Code style sidebar + title band for the DeepSeek Harness web GUI.
 * GENERATED FILE — do not edit. Source lives in src/client/; `npm run build` bundles it.
 */
window.__ModuleLoader__.load({
  id: "dsh-claude-lite",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
var H=Object.defineProperty;var Kt=Object.getOwnPropertyDescriptor;var Yt=Object.getOwnPropertyNames;var Xt=Object.prototype.hasOwnProperty;var Jt=(e,t)=>{for(var a in t)H(e,a,{get:t[a],enumerable:!0})},Qt=(e,t,a,d)=>{if(t&&typeof t=="object"||typeof t=="function")for(let r of Yt(t))!Xt.call(e,r)&&r!==a&&H(e,r,{get:()=>t[r],enumerable:!(d=Kt(t,r))||d.enumerable});return e};var Zt=e=>Qt(H({},"__esModule",{value:!0}),e);var ge={};Jt(ge,{apply:()=>fe});module.exports=Zt(ge);var w="dsh-claude-lite",J="dfe3a310168c",z="data-dsh-lite",Q="data-dsh-lite-theme",k="claude",te="claude-light",ee="host",Z=[k,te,ee],j="dsh-claude-lite-stylesheet",tt='[data-slot="root"]',et='[data-slot="sidebar"]',at='[data-slot="conversation.header"]',R='[data-dsh-lite-part~="conversation-header"]',dt='[data-dsh-lite-part~="title-row"]',rt='[data-dsh-lite-part~="view-tabs"]',it="[data-windows-menu]",S={accent:"--dsh-lite-user-accent",sidebarBg:"--dsh-lite-user-sidebar",canvasBg:"--dsh-lite-user-canvas"};function A(){let e={};for(let t of Object.keys(S))e[t]="";return{theme:k,vars:e}}function ae(e){let t=A();if(e==null)return t;let a=e.theme;t.theme=typeof a=="string"&&Z.includes(a)?a:k;for(let[d,r]of Object.entries(S)){let l=e[d];t.vars[d]=typeof l=="string"?l.trim():""}return t}var F=A(),$=new Set;function W(e){F=e,document.body.setAttribute(Q,F.theme);let t=document.documentElement.style;for(let[a,d]of Object.entries(S)){let r=F.vars[a]??"";r===""?t.removeProperty(d):t.setProperty(d,r)}for(let a of $)a()}function st(e){return $.add(e),()=>$.delete(e)}async function lt(e){let t;try{t=e.get("configForms")}catch{}if(t==null)return;let a=e.fiber?.entry?.id??"",d=a.split(".").pop()??"",r=[a,d,"dsh-claude-lite"].filter(o=>o!==""),l;try{let o=t.describe?.()?.view?.namespaces??{},p=Object.keys(o);l=r.map(i=>p.find(c=>c===i||c.endsWith(`.${i}`)||c.includes(i))).map(i=>i===void 0?void 0:o[i]).find(i=>i!==void 0),l===void 0&&typeof t.get=="function"&&(l=r.map(i=>t.get?.(i)).find(i=>i!=null))}catch{}if(l===void 0)return;let m=()=>{try{let o=l?.getSnapshot?.();if(o?.status!=="ready"&&o?.value===void 0)return;W(ae(o.value))}catch{}};m();try{l.subscribe?.(m)}catch{}}var n=null,ot=0;function nt(e){let t=++ot;return(n===null||!n.isConnected)&&(n=document.getElementById(j),n===null&&(n=document.createElement("style"),n.id=j,document.head.appendChild(n))),n.dataset.plugin=w,n.dataset.pluginCss="",n.textContent=e,()=>{t!==ot||n===null||(n.remove(),n=null)}}var ct={read:new Set,write:new Set},q=null;function ht(e){let t=ct[e],a=[...t];t.clear();for(let d of a)try{d()}catch(r){console.error(`[dsh-claude-lite] ${e} pass:`,r)}}function de(){q=null,ht("read"),ht("write")}function P(e,t){ct[e].add(t),q===null&&(q=requestAnimationFrame(de))}function pt(e,t){let a=typeof e.className=="string"?e.className:"";if(a==="")return!1;for(let d of a.split(/\s+/))if(d===t||d.startsWith(`_${t}_`)||d.endsWith(`_${t}`))return!0;return!1}function f(e,t,a){e.getAttribute(t)!==a&&e.setAttribute(t,a)}var ut="--dsh-frame-top-clearance",mt="data-windows-titlebar";function re(){return navigator.windowControlsOverlay??null}function bt(e){let t=re(),a=navigator.userAgentData?.platform??navigator.platform??"";if(t===null||!/win/i.test(a))return null;let d=0,r=0,l=!1,m=()=>{let i=document.documentElement,c=document.body;c!==null&&(l?(c.style.setProperty(ut,`${d}px`),i.setAttribute(mt,"overlay")):(c.style.removeProperty(ut),i.setAttribute(mt,"public")))},o=()=>{if(l=t.isVisible===!0,l){let i=t.getTitlebarAreaRect?.();i!=null&&(d=Math.round(i.height),r=Math.round(48*(d/32)))}m(),e()},p=()=>o();return o(),t.ongeometrychange=p,t.addEventListener?.("geometrychange",p),window.addEventListener("resize",p),{platform:"win32",get height(){return d},controls:{get size(){return r}},release(){t.ongeometrychange=null,t.removeEventListener?.("geometrychange",p),window.removeEventListener("resize",p)}}}var ft=2,u=8,gt=48,ie=120,vt="data-dsh-lite-header-band",wt="--dsh-lite-header-band-row-lift",yt="--dsh-lite-header-band-title-top",xt="--dsh-lite-header-band-left",Tt="--dsh-lite-header-band-max",Et="--dsh-lite-header-band-tabs-left",kt="--dsh-lite-header-band-right";function g(e){if(e===null||!e.isConnected)return null;let t=e.getBoundingClientRect();return t.width===0&&t.height===0?null:{left:t.left,top:t.top,width:t.width,height:t.height,right:t.right}}var U=null;function Rt(){U?.()}function St(){let e=!1,t=null,a=null,d=null,r=()=>{let s=l();s!==a&&(a=s,d?.disconnect(),a!==null&&(d??=new ResizeObserver(()=>o()),d.observe(a)),o())};function l(){let s=document.querySelectorAll(dt);for(let b of s){let h=b.closest(R);if(h===null)continue;if(h.querySelector('[data-dsh-lite-part~="header-title"], [data-dsh-lite-part~="header-utilities"]')!==null)return b}return null}let m=!1,o=()=>{e||m||(m=!0,P("read",()=>{m=!1,!e&&(r(),p())}))},p=()=>{if(e)return;let s=document.body;if(s===null||t===null&&(t=bt(()=>o()),t===null))return;if(t.height<=0)return i(s);let b=window.innerWidth,h=a?.closest(R)??null,x=g(a),O=g(h?.querySelector('[data-dsh-lite-part~="header-title"]')??null),Nt=g(h?.querySelector('[data-dsh-lite-part~="header-utilities"]')??null),Ht=g(h?.querySelector('[data-dsh-lite-part~="header-corner"]')??null),T=g(h?.querySelector(rt)??null),zt=g(document.querySelector(it)),jt=a!==null?getComputedStyle(a):null;if(x===null||O===null)return i(s);let L=Math.max(gt,zt?.right??0),K=t.controls.size>0?t.controls.size:gt,C=b-K-u,B=T!==null&&T.top<t.height,Ft=T?.width??0,I=(Nt?.width??0)+(Ht?.width??0)+u,M=I>u&&C-I>=Math.max(L,T?.right??0)+u,D=Math.max(x.left,L+u),Y=M?C-I:C+u,N=Y-u-(B?Ft+u:0)-D,E=N>=ie;if(!E&&!M&&!B)return i(s);let X=t.height/2+ft,$t=parseFloat(jt?.getPropertyValue("margin-top")??"0")||0,Wt=Math.max(0,Math.round(x.top-$t-(X+O.height/2-ft)));s.style.setProperty(wt,`${-Wt}px`),s.style.setProperty(yt,`${Math.round(X)}px`),s.style.setProperty(xt,`${Math.round(D)}px`),s.style.setProperty(Tt,`${Math.max(0,Math.round(N))}px`),s.style.setProperty(kt,`${K+u}px`);let qt=E?Math.min(O.width,N):0,Ut=((E?D+qt:L)+Y)/2;if(s.style.setProperty(Et,`${Math.round(Ut)}px`),h!==null){let Vt=[E?"title":"",B?"tabs":"",M?"actions":""].filter(Gt=>Gt!=="");f(h,vt,Vt.join(" "))}},i=s=>{for(let h of[wt,yt,xt,Tt,Et,kt])s.style.removeProperty(h);let b=a?.closest(R);b!==null&&f(b,vt,"")};r(),U=o;let c=new MutationObserver(()=>o());return c.observe(document.documentElement,{subtree:!0,childList:!0,attributes:!0,attributeFilter:["class","data-dsh-lite-part"]}),window.addEventListener("resize",o),()=>{e=!0,U=null,c.disconnect(),d?.disconnect(),window.removeEventListener("resize",o),t?.release();let s=document.body;s!==null&&i(s)}}var v="data-dsh-lite-part",y="data-dsh-lite-holds",se={sidebarCol:"sidebar-column",centerCol:"center-column",rightbarCol:"rightbar-column"},le={logoRow:"logo-row",brand:"brand-button",brandIdentity:"brand-identity",brandMark:"brand-mark",brandName:"brand-name",railMark:"rail-mark",toggle:"sidebar-toggle",panelIcon:"panel-icon",newSession:"new-session",newSessionLabelMask:"new-session-mask",newSessionContent:"new-session-content",newSessionShortcut:"new-session-shortcut",separator:"key-separator",panelList:"panel-list",panelRow:"panel-row",panelGlyph:"panel-glyph",regionArea:"region-area",footArea:"foot-area",footerActions:"footer-actions",footerButtons:"footer-buttons",settingsArea:"settings-area",sectionHeader:"section-header",sectionLabel:"section-label",sectionActions:"section-actions",headerActionsHidden:"section-actions-hidden",treeBody:"tree-body",groupSection:"group-section",projectRow:"project-row",sessionRow:"session-row",title:"row-title",projectText:"row-project-text",time:"row-time",rowActions:"row-actions",iconButton:"row-icon-button",slot:"row-slot",folder:"row-folder",folderActive:"row-folder-active",chevron:"row-chevron",arrow:"row-arrow",active:"row-active",selected:"row-selected",menuOpen:"row-menu-open",searchSlot:"search-slot",searchButton:"search-button",triggerRow:"settings-trigger",list:"list",listArea:"list-area"},oe={header:"conversation-header",headerLeading:"header-leading",titleRow:"title-row",titleCluster:"title-cluster",crumbs:"header-title",crumbSeg:"header-crumb",headerActions:"header-actions",headerUtilities:"header-utilities",headerCorner:"header-corner",tabs:"view-tabs",tab:"view-tab",tabActive:"view-tab-active",label:"header-label"};function At(){return[{within:tt,parts:se,rootParts:{frame:"layout-frame"}},{within:et,parts:le,rootParts:{root:"sidebar-root",collapsed:"sidebar-collapsed",quietBars:"sidebar-quiet",fading:"sidebar-fading"}},{within:at,parts:oe}]}function Pt(){let e=t=>`[${v}~="${t}"]`;return[{name:"sidebar-column",holder:e("layout-frame"),held:e("sidebar-column"),direct:!0},{name:"view-tabs",holder:e("conversation-header"),held:e("view-tabs")}]}var _t=[],Ot=[],_=null,V=!1;function ne(e,t){let a=[];for(let[d,r]of Object.entries(t))pt(e,d)&&a.push(r);return a}function Lt(e,t){let a=ne(e,t);if(a.length===0)return;let d=(e.getAttribute(v)??"").split(/\s+/).filter(l=>l!==""),r=[...new Set([...d,...a])];f(e,v,r.join(" "))}function G(e,t){Lt(e,t);for(let a of e.children)G(a,t)}function Ct(){if(!V){for(let e of _t){let t;try{t=document.querySelectorAll(e.within)}catch{continue}t.forEach(a=>{for(let d of a.children)e.rootParts!==void 0&&Lt(d,e.rootParts),G(d,e.parts);G(a,e.parts)})}for(let e of Ot){let t;try{t=document.querySelectorAll(e.held)}catch{continue}t.forEach(a=>{let d=e.direct===!0?a.parentElement:a.closest(e.holder);if(d===null)return;let r=(d.getAttribute(y)??"").split(/\s+/).filter(l=>l!=="");r.includes(e.name)||f(d,y,[...r,e.name].join(" "))})}}}function he(){P("read",Ct)}function Bt(e){return V=!1,_t=At(),Ot=Pt(),Ct(),e?.(),_=new MutationObserver(()=>he()),_.observe(document.documentElement,{subtree:!0,childList:!0,attributes:!0,attributeFilter:["class","data-slot","data-sidebar-collapsed"]}),()=>{V=!0,_?.disconnect(),_=null,ce()}}function ce(){document.querySelectorAll(`[${v}], [${y}]`).forEach(t=>{t.removeAttribute(v),t.removeAttribute(y)})}var It=`/*
 * The palette, as tokens and gates.
 *
 * The claude values are dsh-claude-style's claude palette (packages/client/src/theme/tokens.json,
 * 档 claude), unchanged; only the custom-property names carry the lite
 * prefix. Three gates select the档:
 *
 *   [data-dsh-lite]                                     — the skin runs (structure only)
 *   [data-dsh-lite][data-dsh-lite-theme="claude"]       — claude dark
 *   [data-dsh-lite][data-dsh-lite-theme="claude-light"] — claude light
 *   [data-dsh-lite][data-dsh-lite-theme="host"]         — nothing: the host's own
 *
 * Every value a rule needs comes from one of these variables, so a档 is a
 * variable block and nothing else. The --dsh-lite-user-* properties stay
 * unset unless the settings form carries a value — the prefs mirror writes
 * them inline on <html>, and they win by cascade over every default here.
 */
[data-dsh-lite] {
  --dsh-lite-canvas: var(--dsh-lite-user-canvas, #141413);
  --dsh-lite-sidebar-canvas: var(--dsh-lite-user-sidebar, #1c1b1a);
  --dsh-lite-panel: #242320;
  --dsh-lite-panel-2: #2e2c29;
  --dsh-lite-border: rgba(255, 255, 255, 0.09);
  --dsh-lite-border-2: rgba(255, 255, 255, 0.18);
  --dsh-lite-accent: var(--dsh-lite-user-accent, #d97757);
  --dsh-lite-accent-hover: #e08a6d;
  --dsh-lite-accent-press: #c6613f;
  --dsh-lite-ink: #faf9f5;
  --dsh-lite-ink-secondary: #b0aea5;
  --dsh-lite-ink-tertiary: #8f8d84;
  --dsh-lite-ink-caption: #6b6a65;
  --dsh-lite-hover-bg: rgba(255, 255, 255, 0.08);
  --dsh-lite-hover-solid: #2e2c29;
  --dsh-lite-scrollbar: rgba(58, 56, 51, 0.9);
  --dsh-lite-scrollbar-hover: rgba(107, 106, 101, 0.9);
  --dsh-lite-shadow-1: 0 4px 16px rgba(0, 0, 0, 0.3);
  --dsh-lite-shadow-2: 0 12px 32px rgba(0, 0, 0, 0.3), 0 2px 8px rgba(0, 0, 0, 0.14);
  --dsh-lite-feedback: 120ms ease;
  --dsh-lite-slide: 240ms ease;
}
[data-dsh-lite][data-dsh-lite-theme='claude-light'] {
  --dsh-lite-canvas: var(--dsh-lite-user-canvas, #fcfcfb);
  --dsh-lite-sidebar-canvas: var(--dsh-lite-user-sidebar, #fbfbf9);
  --dsh-lite-panel: #fbfbf9;
  --dsh-lite-panel-2: #f9f9f6;
  --dsh-lite-border: #e8e6dc;
  --dsh-lite-border-2: #dedcd2;
  --dsh-lite-accent: var(--dsh-lite-user-accent, #d97757);
  --dsh-lite-accent-hover: #c6613f;
  --dsh-lite-accent-press: #b25535;
  --dsh-lite-ink: #141413;
  --dsh-lite-ink-secondary: #6e6a60;
  --dsh-lite-ink-tertiary: #8f8a7e;
  --dsh-lite-ink-caption: #a6a094;
  --dsh-lite-hover-bg: rgba(0, 0, 0, 0.08);
  --dsh-lite-hover-solid: #f0efe9;
  --dsh-lite-scrollbar: rgba(208, 205, 193, 0.9);
  --dsh-lite-scrollbar-hover: rgba(143, 138, 126, 0.8);
  --dsh-lite-shadow-1: 0 4px 16px rgba(20, 20, 19, 0.1);
  --dsh-lite-shadow-2: 0 12px 32px rgba(20, 20, 19, 0.1), 0 2px 8px rgba(20, 20, 19, 0.05);
}
`;var Mt=`/*
 * The band sheet: turn the pass's published geometry (engine/band.ts) into
 * positions. Nothing here moves until the pass publishes both a band and a
 * token: the rules gate on the html titlebar mark and the header's own
 * [data-dsh-lite-header-band] tokens, so a web page, a hidden overlay or a
 * null measure leaves the header exactly as the host drew it.
 *
 * Positions are the pass's custom properties on <body>; the !important marks
 * where the sheet overrules host inline layout, one declaration at a time.
 */

/* ── The lifted title ──────────────────────────────────────────────── */
[data-dsh-lite-header-band~='title'] [data-dsh-lite-part~='header-title'] {
  position: fixed !important;
  top: var(--dsh-lite-header-band-title-top) !important;
  left: var(--dsh-lite-header-band-left) !important;
  max-width: var(--dsh-lite-header-band-max) !important;
  transform: translateY(-50%) !important;
  z-index: 30;
  -webkit-app-region: no-drag;
  pointer-events: auto;
}

/* The row's flow slot collapses upward by the lift the pass measured. */
[data-dsh-lite-header-band~='title'] [data-dsh-lite-part~='title-row'] {
  position: relative;
  top: var(--dsh-lite-header-band-row-lift, 0);
  -webkit-app-region: no-drag;
}
[data-dsh-lite-header-band~='title'] [data-dsh-lite-part~='title-row'] [data-dsh-lite-part~='header-label'] {
  display: flex !important;
}

/* ── The centred tab strip ─────────────────────────────────────────── */
[data-dsh-lite-header-band~='tabs'] [data-dsh-lite-part~='view-tabs'] {
  position: fixed !important;
  left: var(--dsh-lite-header-band-tabs-left, 50%) !important;
  top: 50% !important;
  transform: translate(-50%, -50%) !important;
  max-width: 60vw;
  z-index: 31;
  -webkit-app-region: no-drag;
}

/* ── The lifted utilities cluster ──────────────────────────────────── */
[data-dsh-lite-header-band~='actions'] [data-dsh-lite-part~='header-utilities'],
[data-dsh-lite-header-band~='actions'] [data-dsh-lite-part~='header-corner'] {
  position: fixed !important;
  top: calc(var(--dsh-frame-top-clearance, 48px) / 2) !important;
  right: var(--dsh-lite-header-band-right) !important;
  transform: translateY(-50%) !important;
  margin: 0 !important;
  z-index: 30;
  -webkit-app-region: no-drag;
}
[data-dsh-lite-header-band~='actions'] [data-dsh-lite-part~='header-corner'] {
  right: calc(var(--dsh-lite-header-band-right) - 0px);
}

/* The header that owns the strip loses its bottom edge: the band is the
 * divider now. The hold comes from the walk (engine/parts-table.ts). */
[data-dsh-lite-holds~='view-tabs'][data-dsh-lite-part~='conversation-header'] {
  border-bottom-color: transparent;
}
`;var Dt=`/*
 * The sidebar sheet: the claude-style sidebar, as one gate.
 *
 * The source is dsh-claude-style's packages/client/src/theme/sidebar.css,
 * re-keyed from its layout attribute gates to lite's theme gates: the
 * compact metrics are the default (the compact gate's values, inlined), the
 * dark palette rides [data-dsh-lite-theme="claude"], the light档 overrides in
 * its own block, and the host theme gate opts the whole file out. Parts come
 * from the walk's stamps (engine/parts-table.ts); the conversation, the input
 * and the messages appear nowhere in this file.
 *
 * Everything scopes under [data-dsh-lite] (the skin mark) AND a sidebar part,
 * so the sheet cannot reach past the sidebar even if a host rename moves a
 * rule's aim.
 */

/* ═══ The sidebar canvas ════════════════════════════════════════════ */

[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='sidebar-column'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='sidebar-column'] {
  background: var(--dsh-lite-sidebar-canvas);
}

[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='sidebar-root'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='sidebar-root'] {
  background: transparent;
}

/* ═══ The new-session row and its round plus chip ═══════════════════ */

[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='new-session'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='new-session'] {
  height: 28px;
  min-height: 28px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 18px;
  margin: 6px 8px;
  padding: 0 6px;
  color: var(--dsh-lite-ink);
  transition: background var(--dsh-lite-feedback), color var(--dsh-lite-feedback);
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='new-session']:hover,
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='new-session']:hover {
  background: var(--dsh-lite-hover-bg);
}

/* The round chip on the row's right; a quarter-turn on hover. */
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='new-session'] [data-dsh-lite-part~='panel-icon'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='new-session'] [data-dsh-lite-part~='panel-icon'] {
  width: 20px;
  height: 20px;
  margin-left: auto;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgb(255 255 255 / 14%);
  color: var(--dsh-lite-ink);
  transition: transform var(--dsh-lite-feedback), background var(--dsh-lite-feedback);
}
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='new-session'] [data-dsh-lite-part~='panel-icon'] {
  background: rgb(0 0 0 / 8%);
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='new-session']:hover [data-dsh-lite-part~='panel-icon'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='new-session']:hover [data-dsh-lite-part~='panel-icon'] {
  transform: rotate(90deg);
  background: var(--dsh-lite-accent);
  color: #ffffff;
}

/* ═══ The panel rows: search, workspace entries ═════════════════════ */

[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='panel-list'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='panel-list'] {
  margin-bottom: 0;
  gap: 0;
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='panel-row'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='panel-row'] {
  min-height: 28px;
  border-radius: 6px;
  font-size: 13px;
  padding: 0 6px;
  margin: 0 8px;
  color: var(--dsh-lite-ink-secondary);
  transition: background var(--dsh-lite-feedback), color var(--dsh-lite-feedback);
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='panel-row']:hover,
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='panel-row']:hover {
  background: var(--dsh-lite-hover-bg);
  color: var(--dsh-lite-ink);
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='panel-glyph'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='panel-glyph'] {
  width: 20px;
  height: 20px;
  font-size: 13px;
}

/* ═══ Typography ════════════════════════════════════════════════════ */

[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='row-title'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='row-title'] {
  font-size: 13px;
  line-height: 18px;
  font-weight: 400;
  color: var(--dsh-lite-ink-secondary);
  transition: color var(--dsh-lite-feedback);
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='row-time'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='row-time'] {
  font-size: 11px;
  line-height: 14px;
  color: var(--dsh-lite-ink-caption);
  font-variant-numeric: tabular-nums;
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='section-label'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='section-label'] {
  font-size: 12px;
  line-height: 16px;
  font-weight: 400;
  color: var(--dsh-lite-ink-tertiary);
}

/* ═══ The session tree ══════════════════════════════════════════════ */

[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='tree-body'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='tree-body'] {
  padding: 0 8px;
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='section-header'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='section-header'] {
  height: 32px;
  margin: 4px 0 2px;
  padding: 0 6px;
  border-radius: 6px;
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='section-header']:hover,
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='section-header']:hover {
  background: transparent;
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='group-section'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='group-section'] {
  margin-bottom: 1px;
  padding-left: 6px;
}

/* Project and session rows share the 28px row. */
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='project-row'],
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='session-row'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='project-row'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='session-row'] {
  min-height: 28px;
  height: 28px;
  border-radius: 6px;
  padding: 0 6px;
  gap: 0;
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='project-row'] [data-dsh-lite-part~='row-title'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='project-row'] [data-dsh-lite-part~='row-title'] {
  color: var(--dsh-lite-ink);
}

/* The hover plate belongs to session rows alone. */
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='session-row']:hover,
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='session-row']:hover {
  background: var(--dsh-lite-hover-bg);
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='session-row']:hover [data-dsh-lite-part~='row-title'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='session-row']:hover [data-dsh-lite-part~='row-title'] {
  color: var(--dsh-lite-ink);
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='session-row'][data-dsh-lite-part~='row-active'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='session-row'][data-dsh-lite-part~='row-active'] {
  background: var(--dsh-lite-hover-solid);
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='session-row'][data-dsh-lite-part~='row-active'] [data-dsh-lite-part~='row-title'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='session-row'][data-dsh-lite-part~='row-active'] [data-dsh-lite-part~='row-title'] {
  color: var(--dsh-lite-ink);
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='session-row'][data-dsh-lite-part~='row-active']::before,
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='session-row'][data-dsh-lite-part~='row-active']::before {
  content: '';
  position: absolute;
  left: 6px;
  top: 50%;
  width: 5px;
  height: 5px;
  margin-top: -2.5px;
  border-radius: 50%;
  background: var(--dsh-lite-accent);
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='session-row'][data-dsh-lite-part~='row-active'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='session-row'][data-dsh-lite-part~='row-active'] {
  position: relative;
  padding-left: 16px;
}

/* Row actions surface on hover; the timestamp yields. */
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='row-actions'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='row-actions'] {
  gap: 6px;
  opacity: 0;
  transition: opacity var(--dsh-lite-feedback);
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='session-row']:hover [data-dsh-lite-part~='row-actions'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='session-row']:hover [data-dsh-lite-part~='row-actions'] {
  opacity: 1;
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='session-row']:hover [data-dsh-lite-part~='row-time'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='session-row']:hover [data-dsh-lite-part~='row-time'] {
  display: none;
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='row-icon-button'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='row-icon-button'] {
  width: 16px;
  height: 16px;
  color: var(--dsh-lite-ink-tertiary);
}

/* The folder chevron: hidden until the group hovers; open turns it. */
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='row-chevron'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='row-chevron'] {
  opacity: 0;
  transition: opacity var(--dsh-lite-feedback), transform var(--dsh-lite-feedback);
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='group-section']:hover > [data-dsh-lite-part~='project-row'] [data-dsh-lite-part~='row-chevron'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='group-section']:hover > [data-dsh-lite-part~='project-row'] [data-dsh-lite-part~='row-chevron'],
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='row-folder-active'] [data-dsh-lite-part~='row-chevron'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='row-folder-active'] [data-dsh-lite-part~='row-chevron'] {
  opacity: 1;
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='row-folder-active'] [data-dsh-lite-part~='row-chevron'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='row-folder-active'] [data-dsh-lite-part~='row-chevron'] {
  transform: rotate(-90deg);
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='row-folder'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='row-folder'] {
  position: relative;
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='row-folder']::after,
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='row-folder']::after {
  content: '';
  position: absolute;
  right: 6px;
  top: 50%;
  width: 8px;
  height: 8px;
  margin-top: -4px;
  background: var(--dsh-lite-ink-tertiary);
  opacity: 0.5;
  clip-path: polygon(0 0, 100% 50%, 0 100%);
  transition: opacity var(--dsh-lite-feedback), transform var(--dsh-lite-feedback);
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='row-folder'][data-dsh-lite-part~='row-folder-active']::after,
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='row-folder'][data-dsh-lite-part~='row-folder-active']::after {
  transform: rotate(90deg);
}

/* The row slot: an empty session's hollow dot. */
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='row-slot'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='row-slot'] {
  width: 6px;
  height: 6px;
  border: 1.5px solid var(--dsh-lite-ink-tertiary);
  border-radius: 50%;
  flex: none;
}

/* ═══ Search and the settings trigger ═══════════════════════════════ */

[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='search-slot'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='search-slot'] {
  margin: 6px 8px;
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='search-button'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='search-button'] {
  min-height: 28px;
  border-radius: 6px;
  font-size: 13px;
  padding: 0 6px;
  color: var(--dsh-lite-ink-secondary);
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='search-button']:hover,
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='search-button']:hover {
  background: var(--dsh-lite-hover-bg);
  color: var(--dsh-lite-ink);
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='settings-trigger'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='settings-trigger'] {
  min-height: 28px;
  border-radius: 6px;
  padding: 0 6px;
  color: var(--dsh-lite-ink-secondary);
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='settings-trigger']:hover,
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='settings-trigger']:hover {
  background: var(--dsh-lite-hover-bg);
  color: var(--dsh-lite-ink);
}

/* ═══ The footer ════════════════════════════════════════════════════ */

[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='foot-area'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='foot-area'] {
  padding: 4px 8px 3px;
  border-top: 1px solid var(--dsh-lite-border);
  background: transparent;
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='region-area'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='region-area'] {
  background: transparent;
}

/* ═══ The scrollbar, sidebar only ═══════════════════════════════════ */

[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='list-area'],
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='list-area'] {
  scrollbar-color: var(--dsh-lite-scrollbar) transparent;
  scrollbar-width: thin;
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='list-area']::-webkit-scrollbar,
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='list-area']::-webkit-scrollbar {
  width: 8px;
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='list-area']::-webkit-scrollbar-thumb,
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='list-area']::-webkit-scrollbar-thumb {
  background: var(--dsh-lite-scrollbar);
  border-radius: 4px;
}
[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-part~='list-area']::-webkit-scrollbar-thumb:hover,
[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-part~='list-area']::-webkit-scrollbar-thumb:hover {
  background: var(--dsh-lite-scrollbar-hover);
}

/* ═══ The windows titlebar: paint the sidebar column up behind the ═══
 * ═══ caption strip, keep the canvas edge on the conversation side ══ */

html[data-windows-titlebar='overlay'] body[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-holds~='sidebar-column'][data-dsh-lite-part~='sidebar-column'],
html[data-windows-titlebar='overlay'] body[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-holds~='sidebar-column'][data-dsh-lite-part~='sidebar-column'] {
  box-shadow: 0 calc(-1 * var(--dsh-windows-titlebar-height, 48px)) 0 0 var(--dsh-lite-sidebar-canvas);
}
html[data-windows-titlebar='overlay'] body[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-holds~='sidebar-column'][data-dsh-lite-part~='center-column'],
html[data-windows-titlebar='overlay'] body[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-holds~='sidebar-column'][data-dsh-lite-part~='center-column'] {
  box-shadow: 0 calc(-1 * var(--dsh-windows-titlebar-height, 48px)) 0 0 var(--dsh-lite-canvas);
}
/* The seam: a half-pixel hairline between the columns, riding the top. */
html[data-windows-titlebar='overlay'] body[data-dsh-lite][data-dsh-lite-theme='claude'] [data-dsh-lite-holds~='sidebar-column'][data-dsh-lite-part~='sidebar-column']::before,
html[data-windows-titlebar='overlay'] body[data-dsh-lite][data-dsh-lite-theme='claude-light'] [data-dsh-lite-holds~='sidebar-column'][data-dsh-lite-part~='sidebar-column']::before {
  content: '';
  position: absolute;
  left: 3px;
  top: calc(-1 * var(--dsh-windows-titlebar-height, 48px));
  bottom: 100%;
  width: 0.5px;
  background: var(--dsh-lite-border);
}
`;var be=`${It}
${Mt}
${Dt}`;function fe(e){e.effect(()=>{let t=document.body,a=[];return t.setAttribute(z,J),t.dataset.pluginSkin=w,W(A()),a.push(st(Rt)),a.push(nt(be)),a.push(Bt()),a.push(St()),lt(e).catch(()=>{}),()=>{for(let d of a)try{d()}catch{}t.removeAttribute(z),delete t.dataset.pluginSkin}},`${w}:skin`)}
    return module.exports
  },
})
