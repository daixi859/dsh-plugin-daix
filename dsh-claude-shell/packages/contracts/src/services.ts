/**
 * The host services the skin reads, as the skin needs them (D44).
 *
 * Each interface declares only the members the skin actually touches, with the
 * meaning it gives them; the host's own types are wider and are not shipped
 * here, so this file is the contract a host upgrade is checked against. These
 * shapes were read off the host build (0.2.1-alpha.1).
 *
 * A service the host does not mount comes back `undefined` from `ctx.get`, so
 * every reader takes the value as possibly absent (D12) — that is the reason
 * these types are returned as `| undefined` rather than asserted.
 */

/** A host value that publishes snapshots and changes: a form, a store. */
export interface HostSnapshotSource<Snapshot> {
  getSnapshot(): Snapshot
  subscribe(listener: () => void): () => void
}

/* ---------- the settings seats ---------- */

/** The `slots` service: what is registered under a key, and how a plugin adds its own. */
export interface HostSlotsService {
  entries(key: string): HostSlotRegistration[]
  register(key: string, id: string, component: unknown): unknown
  inject?(key: string, id: string, component: unknown): unknown
}

/** One registered slot entry: how it was declared, so its id can be matched. */
interface HostSlotRegistration {
  options: { id?: string }
}

/**
 * The host's settings-form service (`configForms`, D10): one form per
 * namespace, plus the catalogue of namespaces it serves.
 */
export interface HostConfigFormsService {
  get(namespace: string): HostConfigForm | undefined | null
  /** The catalogue of served namespaces; it loads on demand. */
  describe?(): HostSnapshotSource<HostFormsDescription> & { ensure?(): unknown }
}

/** What the form service says it serves: one entry per served namespace. */
interface HostFormsDescription {
  view?: { namespaces?: { ns?: unknown }[] }
}

/** One namespace's form: its current values, their changes, and a field write. */
export interface HostConfigForm {
  getSnapshot(): HostConfigSnapshot
  /** Write one field; the host answers with a promise, or a plain boolean when it settles at once. */
  set(field: string, value: unknown): Promise<unknown> | boolean | undefined
  subscribe?(listener: () => void): () => void
}

/** One form snapshot: whether its controller is ready, and the values it holds. */
interface HostConfigSnapshot {
  status?: string
  value?: unknown
}

/** A host locale namespace's translate seat (`locale.bind(namespace)`). */
export type HostText = (key: string, params?: Record<string, string | number>) => string

/* ---------- the account ---------- */

/**
 * The identity one account call carries, which the Host forwards to the
 * Platform as its client headers. The Remote takes it as the method's own
 * argument and the Host refuses a call whose argument fields do not match its
 * descriptor, so a call without it never reaches the Platform.
 */
export interface HostAccountClient {
  /** The calling client build's version. */
  version: string
  /** The UI language in effect when the call was made. */
  locale: string
  /** Seconds east of UTC, as `-new Date().getTimezoneOffset() * 60`. */
  timezoneOffsetSeconds: number
}

/** The account service (`remote.account`): the profile read, and the state stream. */
export interface HostAccountService {
  getProfile(client: HostAccountClient): Promise<HostAccountAnswer>
  watch(signal: AbortSignal): AsyncIterable<HostAccountFrame>
}

/** The profile read's answer: the profile, or nothing when no credential is stored. */
export interface HostAccountAnswer {
  ok?: boolean
  value?: HostAccountProfile
}

/** One account profile: `ready` once its platform answered, with the name, contact and picture. */
interface HostAccountProfile {
  status?: string
  value?: { name?: string, contact?: string, avatarUrl?: string }
  avatarUrl?: string
  /** The host some platforms answer with: the profile nested under its own key. */
  profile?: HostAccountProfile
}

/** One frame of the account state stream: whether a credential is stored, and how a sign-in is doing. */
export interface HostAccountFrame {
  status?: string
  attempt?: { phase?: string, id?: string }
}

/**
 * A handle from `remote.$stream`: an async iterable stepped by hand, which
 * reopens itself across reconnects and is disposed by its owner.
 */
export interface HostStream<Frame> {
  dispose(): void
  [Symbol.asyncIterator](): { next(): Promise<HostStreamStep<Frame>> }
}

/** One step of a stream: the frame, whether the stream ended, and the frame's own acknowledgement. */
export interface HostStreamStep<Frame> {
  done?: boolean
  value: { value: Frame, accept?(): void }
}
