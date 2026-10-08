import { HDSL_ROUTE, HDSL_SKIN_ROUTE, USERNAME_MAX, USERNAME_ROUTE } from '../constants'
import { FOOT_AREA_SELECTOR } from '@dsh-claude-shell/contracts/dom'
import { readPrefs } from './prefs'
import { createHostResource } from '../shared/resource'

/**
 * The host's client context (cordis), handed to `apply` and to every feature.
 * Services come by name; their shapes are the host's own and stay untyped
 * here until the contract module types them (D44).
 */
export interface HostContext {
  /** The loader's fiber; its boot entry id names this plugin's settings namespace (D10). */
  readonly fiber?: { entry?: { id?: unknown } }
  /** A service by name, or undefined when the host carries none (D12). */
  get(name: string): HostValue
  /** Run `effect` now; the function it returns runs when the context is disposed. */
  effect(effect: () => () => void, label?: string): void
  /** Run `callback` in a scope once every named service exists; a host without it has no late services. */
  inject?(names: string[], callback: (scope: HostContext) => void): HostFiber
}

/**
 * A value read off a host service or snapshot: a session, a catalog group, a
 * chat node. Its shape is the host's own; the contract module types the ones
 * the skin reads by name (D44, `contracts/services.ts`).
 */
export type HostValue = any

/** A host locale namespace's translate seat (`locale.bind(namespace)`): a key and its parameters to text. */
export type { HostText } from '@dsh-claude-shell/contracts/services'

/** The scope `inject` opened: disposing it runs the effects registered in it. */
export interface HostFiber {
  dispose(): void
}

/** The sidebar footer, where the account row and the plugin footer entries live. */
export function findFootArea() {
  return document.querySelector<HTMLElement>(FOOT_AREA_SELECTOR)
}

/**
 * Who the skin shows. Nickname: the custom nickname, the signed-in account's
 * name, the HDSL launcher's account name, the cached OS-user probe, the fresh
 * probe. Picture: the signed-in account's avatar, the HDSL launcher's avatar,
 * then nothing, which lets the brand mark show (D15).
 */
export let accountName = ''
export let accountAvatar = ''

/** The account profile's contribution; called when its read answers. */
export function setAccountIdentity(name: unknown, avatar: unknown) {
  accountName = typeof name === 'string' ? name.trim() : ''
  accountAvatar = typeof avatar === 'string' ? avatar : ''
}

/**
 * The host half owns the OS user (`os.userInfo().username`); this side fetches
 * it once, caches it and mirrors the answer into local storage so a reload
 * shows the name from the first frame. No workspace parsing, no polling.
 */
let usernameFromHost = ''

/** Last OS-user probe this browser saw; the cache that outlives the page. */
const PROBED_USERNAME_KEY = 'dsh-claude-shell.probed-username'
let probedUsername = readStoredProbeUsername()

function readStoredProbeUsername() {
  return localStorage.getItem(PROBED_USERNAME_KEY) || ''
}

function storeProbeUsername(value: string) {
  if (value) localStorage.setItem(PROBED_USERNAME_KEY, value)
}

/** The host half's OS user; an answer the contract does not carry is not adopted. */
const usernameResource = createHostResource(USERNAME_ROUTE, (data) => {
  if (!data || data.ok !== true || typeof data.username !== 'string') return undefined
  usernameFromHost = data.username.trim().slice(0, USERNAME_MAX)
  if (usernameFromHost) {
    probedUsername = usernameFromHost
    storeProbeUsername(usernameFromHost)
  }
  return usernameFromHost
})

export function onUsernameLoaded(listener: (username: string) => void) {
  return usernameResource.onLoaded(listener)
}

export function loadUsername() {
  usernameResource.load()
}

let hdslContract = false
let hdslName = ''
let hdslAvatar = false

/**
 * The HDSL launcher's account contract, when this instance was launched by it.
 * An answer that is no contract is not adopted, so the chain skips the
 * launcher (D15).
 */
const hdslResource = createHostResource(HDSL_ROUTE, (data) => {
  if (!data || data.ok !== true || data.contract !== true) return undefined
  hdslContract = true
  hdslName = typeof data.name === 'string' ? data.name.trim().slice(0, USERNAME_MAX) : ''
  hdslAvatar = data.hasSkinImage === true
  return true
})

export function onHdslLoaded(listener: (adopted: true) => void) {
  return hdslResource.onLoaded(listener)
}

export function loadHdsl() {
  hdslResource.load()
}

/** The nickname every skin surface shows, or '' when nothing resolved. */
export function resolveDisplayName() {
  const custom = readPrefs().username
  if (custom) return custom
  if (accountName) return accountName
  if (hdslName) return hdslName
  if (probedUsername) return probedUsername
  return usernameFromHost
}

export function getUsername() {
  return resolveDisplayName() || 'User'
}

/** The picture every skin surface shows, or '' to let the brand mark show. */
export function resolveAvatarUrl() {
  if (accountAvatar) return accountAvatar
  if (hdslContract && hdslAvatar) return HDSL_SKIN_ROUTE
  return ''
}

/** Host context reference for services that read host state outside apply(ctx)'s call stack. */
export let hostCtx: HostContext | null = null
export function setHostContext(ctx: HostContext | null) {
  hostCtx = ctx
  // A new host context means a new OS user and a new launcher, so the next
  // apply resolves again. The probe cache survives on purpose: same machine.
  usernameResource.reset()
  usernameFromHost = ''
  hdslResource.reset()
  hdslContract = false
  hdslName = ''
  hdslAvatar = false
  accountName = ''
  accountAvatar = ''
}
