/**
 * The module scripts/build.mjs generates while bundling (D36): build output
 * the source imports by name instead of reading it from text placeholders.
 */
declare module 'virtual:dsh-claude-shell/generated' {
  /** The skin's stylesheet: the generated token sheet and the src/ stylesheets in order. */
  export const STYLESHEET: string
  /** A hash of the bundle, written in after bundling (D19). */
  export const BUILD_ID: string
  /** The version of the package this bundle was built from; the account Remote wants a client build version. */
  export const CLIENT_VERSION: string
}

/** The feature registry scripts/build.mjs generates from the manifests (D42), in install order. */
declare module 'virtual:dsh-claude-shell/features' {
  export const FEATURES: import('./core/feature').Feature[]
}
