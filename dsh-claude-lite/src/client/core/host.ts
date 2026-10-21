/**
 * The host context the loader hands the client's apply, as far as this skin
 * reads it: a fiber with the entry's id, a lenient service getter, an effect
 * registration and a late service injection. Anything else the shell read
 * (username, HDSL, routes) no plugin of this size needs.
 */
export interface HostFiber {
  entry?: { id?: string }
}

export interface HostContext {
  fiber?: HostFiber
  get<T = unknown>(name: string): T
  effect(effect: () => void, label: string): void
  inject?(names: string[], callback: (scope: HostScope) => void): void
}

/** A scope with the services an inject declaration named. */
export interface HostScope {
  effect(effect: () => void, label: string): void
  [name: string]: unknown
}
