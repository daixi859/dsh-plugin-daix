import { FEATURE_PREF_DEFAULTS, HANDOFF_ATTR } from './constants'
import { loadHdsl, loadUsername, setHostContext } from './core/host'
import type { HostContext } from './core/host'
import { loadModelCopy } from './core/model-copy'
import { adoptPrefs, adoptSettingsForm, clearPrefsAttributes, disposePrefsBinding, prefs, readPrefs, retireFooterTakeover, subscribePrefs } from './core/prefs'
import { installScheduler, reportFeatureFailure } from './core/scheduler'
import type { HandleName, Ui } from './core/scheduler'
import { mountStylesheet, parkForeignSheets, watchForeignSheets } from './core/stylesheet'
import { externalOwnerActive, subscribeExternalOwner } from './shared/visual-owner'
import { handleName, setFeatureRegistry } from './core/feature'
import type { Feature } from './core/feature'
import { FEATURES } from 'virtual:dsh-claude-shell/features'
import { BUILD_ID } from 'virtual:dsh-claude-shell/generated'

// At module scope on purpose: the sweep runs right after this factory
// returns, so an `apply()` body would be too late. The head watch
// (core/stylesheet.ts, started by apply) covers the sheets that arrive later.
parkForeignSheets()

/** A feature its preference switches on and off live (a key of FEATURE_PREF_DEFAULTS). */
type SwitchedFeature = Feature & { pref: keyof typeof FEATURE_PREF_DEFAULTS }

const isSwitched = (feature: Feature): feature is SwitchedFeature => Object.hasOwn(FEATURE_PREF_DEFAULTS, feature.pref ?? '')

/**
 * Whether a feature comes and goes during the generation: its preference is
 * a live switch.
 */
const isLive = (feature: Feature) => isSwitched(feature)

/**
 * Whether a live feature is wanted now: a boolean switch is on unless stored
 * as `false`, and a choice switch runs under the values its manifest names
 * (`prefValues`).
 */
function isWanted(feature: Feature) {
  if (!isSwitched(feature)) return true
  const value = readPrefs()[feature.pref]
  return feature.prefValues === undefined
    ? value !== false
    : typeof value === 'string' && feature.prefValues.includes(value)
}

export function apply(ctx: HostContext) {
  const body = document.body
  const ui: Ui = { retire }
  /** Installed features in install order, as `{ id, handle, stop }`. */
  let installed: { id: string, handle: HandleName | null, stop: () => void }[] = []
  /** Features retired after failing: a preference flip never brings one back this generation. */
  const failed = new Set<string>()
  /** Unsubscribes the live features from the preferences; set once the features install. */
  let offSwitches: (() => void) | null = null
  /** Parks a sibling's stylesheet arriving after this generation; core/stylesheet.ts. */
  let offSheetWatch: (() => void) | null = null
  /** Watches the skin center's stamp on the page; D49. */
  let offOwnerWatch: (() => void) | null = null
  /** Unmounts this generation's stylesheet; set once the sheet is mounted. */
  let stopStylesheet: (() => void) | null = null
  let disposed = false
  /** True while a skin owns the page and this theme stands down (D49). */
  let yielded = externalOwnerActive()

  /**
   * Give the page back, keeping the features `keep` names: run every other
   * feature's teardown and take this package's body attributes and stylesheet
   * away. A yield keeps the settings section and the preference binding: the
   * reader must still reach the plugin's own page, and another plugin taking
   * the screen uninstalls nothing of the reader's (D49).
   */
  function release(keep: string[] = []) {
    // First, so no preference flip installs a feature mid-release.
    if (offSwitches !== null) {
      offSwitches()
      offSwitches = null
    }
    const kept = []
    for (let i = installed.length - 1; i >= 0; i--) {
      if (keep.includes(installed[i].id)) {
        kept.push(installed[i])
        continue
      }
      // One teardown must not block the rest (D12); a failing one is reported.
      try { installed[i].stop() } catch (error) { reportError(error) }
    }
    installed = kept.reverse()
    // Each body attribute goes with whoever writes it: a feature's own with
    // its teardown above, the preference mirror's here, the stamps last.
    clearPrefsAttributes()
    body.removeAttribute('data-dsh-claude-shell')
    body.removeAttribute(HANDOFF_ATTR)
    // This generation's own sheet, handed over rather than taken away when a
    // newer generation has mounted after it (mountStylesheet).
    if (stopStylesheet !== null) {
      stopStylesheet()
      stopStylesheet = null
    }
  }

  /**
   * Undo everything this generation installed. Idempotent: the host runs it
   * on dispose (the effect below), and own() runs it itself when the
   * scheduler cannot be installed.
   */
  function teardown() {
    if (disposed) return
    disposed = true
    if (offOwnerWatch !== null) {
      offOwnerWatch()
      offOwnerWatch = null
    }
    release()
    if (offSheetWatch !== null) {
      offSheetWatch()
      offSheetWatch = null
    }
    setHostContext(null)
    disposePrefsBinding()
  }

  // Registered before anything is installed: registered last, a feature that
  // threw half-way through left the stylesheet and every listener installed
  // so far on the page with no teardown the host could ever run.
  ctx.effect(() => teardown, 'dsh-claude-shell: Claude Code desktop theme')

  /**
   * Switch one feature off for the rest of this generation: run its own
   * teardown, and give back the host surface it had taken over. The footer
   * takeover HIDES host controls (its gate is a body attribute the
   * preferences write), so with the feature gone it must stop hiding them.
   * The scheduler calls this for a sync that keeps failing.
   *
   * `name` may be the feature's id or its handle name. The scheduler retires
   * a failing sync through the handle; a handle that differs from the install
   * name (settings → settingsNav) stops the sync alone — the failure counter
   * already refuses the next pass, and the install keeps running so the
   * settings page stays.
   */
  function retire(name: string) {
    failed.add(name)
    const index = installed.findIndex(entry => entry.id === name || entry.handle === name)
    // A handle-only match does not tear the install down.
    if (index !== -1 && installed[index].id === name) {
      const stop = installed[index].stop
      installed.splice(index, 1)
      // Retiring goes through even when the feature's own teardown fails too.
      try { stop() } catch (error) { reportError(error) }
    }
    if (name === 'footer') retireFooterTakeover()
  }

  /**
   * Install one piece in isolation. One that throws is reported and retired,
   * and the rest of the skin carries on without it.
   * @param id - the failure report's label and the teardown's key.
   * @param handle - the name the piece registers on `ui`; null for the scheduler, which registers none.
   * @returns whether the piece installed.
   */
  function install(id: string, handle: HandleName | null, run: () => (() => void) | void) {
    try {
      const stop = run()
      if (typeof stop === 'function') installed.push({ id, handle, stop })
      return true
    } catch (error) {
      reportFeatureFailure(id, error)
      retire(id)
      return false
    }
  }

  /** Install one feature. */
  function installFeature(feature: Feature) {
    const run = feature.install
    install(feature.id, handleName(feature), () => run(ctx, ui))
  }

  /**
   * Bring a live feature in line with its switch (isWanted): wanted installs
   * it, unwanted runs its teardown and drops its handle, which hands its
   * surface back to the host. Runs at startup and on every preference
   * adoption, so neither needs a reload. A feature retired after failing stays
   * retired.
   */
  function applySwitch(feature: Feature) {
    const handle = handleName(feature)
    const wanted = isWanted(feature)
    const index = installed.findIndex(entry => entry.id === feature.id)
    if (wanted && index === -1 && !failed.has(feature.id)) {
      installFeature(feature)
      return
    }
    if (wanted || index === -1) return
    const stop = installed[index].stop
    installed.splice(index, 1)
    delete ui[handle]
    // Isolation (D12): a teardown that throws is reported, and the feature
    // stays off for the rest of the generation.
    try {
      stop()
    } catch (error) {
      reportFeatureFailure(feature.id, error)
      failed.add(feature.id)
    }
  }

  /**
   * Take the page: stamp, mount the sheet, install the features, schedule.
   * Idempotent over what is already installed, so taking the page back after
   * a yield leaves the settings section alone (D49); a feature retired after
   * failing stays retired (D12).
   *
   * FEATURES is the registry the build generates from the manifests (D42),
   * in install order; the scheduler's pass order is the same order. A live
   * feature follows its switch; the rest install once. A `pref` outside
   * FEATURE_PREF_DEFAULTS is read by the feature itself.
   */
  function own() {
    // The value is the build id (scripts/build.mjs): the stylesheet keys on
    // the attribute alone, and a live page reads which lib/client.js it runs.
    body.setAttribute('data-dsh-claude-shell', BUILD_ID)
    // The handoff marker rides the live stamp: its presence is what lets the
    // skin center offer this theme as a selectable look (D49).
    body.setAttribute(HANDOFF_ATTR, BUILD_ID)
    adoptPrefs(prefs)
    // The sheet carries this package's own tags and is unmounted by
    // release(); the features install onto a page that already wears it.
    if (stopStylesheet === null) stopStylesheet = mountStylesheet()
    for (const feature of FEATURES) {
      if (failed.has(feature.id) || installed.some(entry => entry.id === feature.id)) continue
      if (isLive(feature)) applySwitch(feature)
      else installFeature(feature)
    }
    if (offSwitches === null) {
      offSwitches = subscribePrefs(() => {
        for (const feature of live) applySwitch(feature)
        if (typeof ui.schedule === 'function') ui.schedule()
      })
    }
    // Last: its passes read the `ui` handles lazily. Without it nothing syncs,
    // and a live stylesheet over overrides that never run is worse than no
    // skin at all — so if it cannot install, the whole skin rolls back.
    if (installed.some(entry => entry.id === 'scheduler')) return
    if (!install('scheduler', null, () => installScheduler(ctx, ui, handleNames))) teardown()
  }

  setHostContext(ctx)
  // Bind the official settings form before anything reads a preference:
  // the host serves namespaces through `ctx.configForms`. Bound once here,
  // and retried when the settings page installs.
  adoptSettingsForm(ctx)
  // The service can mount after this plugin: wait for it declaratively and
  // bind then, so the first settings change never meets an unbound store.
  if (typeof ctx.inject === 'function') ctx.inject(['configForms'], () => { adoptSettingsForm(ctx) })
  loadModelCopy()
  loadUsername()
  loadHdsl()
  // Preferences are read asynchronously from the host settings namespace;
  // applying the defaults first keeps every gated rule in a defined state
  // for the frames before that read settles, and is exactly the shipped
  // behaviour when it never does. This runs while yielded too: the reader
  // must still reach the settings page and see their own values (D49).
  adoptPrefs(prefs)

  setFeatureRegistry(FEATURES)
  const live = FEATURES.filter(isLive)
  const handleNames = FEATURES.map(handleName)
  // A sibling plugin's stylesheet can arrive at any time; the watch parks it
  // while it is still nobody's (core/stylesheet.ts).
  offSheetWatch = watchForeignSheets()
  // A skin can arrive or leave whichever way the page booted; the
  // verdict is read again on every flip rather than remembered (D49).
  offOwnerWatch = subscribeExternalOwner(active => {
    if (active === yielded) return
    yielded = active
    if (active) release(['settings'])
    else own()
  })

  if (yielded) {
    // A skin already has this page (D49). The settings section is the
    // one feature that stays: the reader still has to reach this theme's own
    // page. adoptPrefs mirrors nothing onto a yielded page, and the release
    // leaves the section alone.
    installFeature(FEATURES.find(feature => feature.id === 'settings')!)
    release(['settings'])
    return
  }
  own()
}
