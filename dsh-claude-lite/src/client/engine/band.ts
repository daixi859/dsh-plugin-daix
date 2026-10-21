/**
 * The band pass: lift the header's title, actions and tab strip into the
 * window caption strip when there is room for them.
 *
 * The desktop band says where the caption is (engine/desktop-band.ts). This
 * pass measures the header row against it and publishes the placement as
 * custom properties on <body> plus token marks on the header element; the
 * sheet (theme/band.css) turns those into positions. No overlay (web, mac,
 * hidden overlay) means a null band and an untouched header.
 *
 * The geometry is dsh-claude-style's header-band arithmetic, reduced to the
 * furniture lite keeps: one title, one utilities cluster, one corner, one tab
 * strip. No rightbar handling, no menu-button trajectory — the menu mark is
 * read straight off the DOM.
 */
import { schedulePass } from '../core/bus.ts'
import { setAttributeIfChanged } from './dom.ts'
import { CONVERSATION_HEADER_SELECTOR, TITLE_ROW_SELECTOR, VIEW_TABS_SELECTOR, WINDOWS_MENU_SELECTOR } from '../constants.ts'
import { desktopBand, type DesktopBand } from './desktop-band.ts'

/** Optical nudges and clearances, in css px. */
const TITLE_NUDGE = 2
const GAP = 8
/** The caption buttons' furniture when the overlay hides its measures. */
const FURNITURE = 48
/** The narrowest title worth lifting. */
const MIN_TITLE = 120

/** The tokens the header element carries when its parts are lifted. */
export const BAND_ATTR = 'data-dsh-lite-header-band'

/** The custom properties the pass publishes on <body>. */
const ROW_LIFT = '--dsh-lite-header-band-row-lift'
const TITLE_TOP = '--dsh-lite-header-band-title-top'
const TITLE_LEFT = '--dsh-lite-header-band-left'
const TITLE_MAX = '--dsh-lite-header-band-max'
const TABS_LEFT = '--dsh-lite-header-band-tabs-left'
const BAND_RIGHT = '--dsh-lite-header-band-right'

interface Box { left: number, top: number, width: number, height: number, right: number }

/** The element's border box in page coordinates, or null when it paints nowhere. */
function inPageBox(element: Element | null): Box | null {
  if (element === null || !element.isConnected) return null
  const box = element.getBoundingClientRect()
  if (box.width === 0 && box.height === 0) return null
  return { left: box.left, top: box.top, width: box.width, height: box.height, right: box.right }
}

export interface BandPass {
  release(): void
}

/** The live pass's scheduler, set by installBand, read by resyncBand. */
let notify: (() => void) | null = null

/** Ask for one geometry pass; the prefs mirror calls this on a palette flip. */
export function resyncBand(): void {
  notify?.()
}

/** Install the pass; returns its teardown. */
export function installBand(): () => void {
  let stopped = false
  let band: DesktopBand | null = null
  let row: Element | null = null
  let resizeObserver: ResizeObserver | null = null

  // Keep a live handle on the row, the strip and the menu mark.
  const track = () => {
    const next = pickRow()
    if (next !== row) {
      row = next
      resizeObserver?.disconnect()
      if (row !== null) {
        resizeObserver ??= new ResizeObserver(() => scheduleSync())
        resizeObserver.observe(row)
      }
      scheduleSync()
    }
  }

  /** The first title row whose header carries a crumb or a utilities cluster. */
  function pickRow(): Element | null {
    const rows = document.querySelectorAll(TITLE_ROW_SELECTOR)
    for (const candidate of rows) {
      const header = candidate.closest(CONVERSATION_HEADER_SELECTOR)
      if (header === null) continue
      const hasContent = header.querySelector('[data-dsh-lite-part~="header-title"], [data-dsh-lite-part~="header-utilities"]') !== null
      if (hasContent) return candidate
    }
    return null
  }

  let measuring = false
  const scheduleSync = () => {
    if (stopped || measuring) return
    measuring = true
    schedulePass('read', () => {
      measuring = false
      if (stopped) return
      track()
      sync()
    })
  }

  const sync = () => {
    if (stopped) return
    const body = document.body
    if (body === null) return

    if (band === null) {
      band = desktopBand(() => scheduleSync())
      if (band === null) return
    }
    if (band.height <= 0) return clear(body)

    const width = window.innerWidth
    const header = row?.closest(CONVERSATION_HEADER_SELECTOR) ?? null
    const rowBox = inPageBox(row)
    const crumbsBox = inPageBox(header?.querySelector('[data-dsh-lite-part~="header-title"]') ?? null)
    const utilitiesBox = inPageBox(header?.querySelector('[data-dsh-lite-part~="header-utilities"]') ?? null)
    const cornerBox = inPageBox(header?.querySelector('[data-dsh-lite-part~="header-corner"]') ?? null)
    const stripBox = inPageBox(header?.querySelector(VIEW_TABS_SELECTOR) ?? null)
    const menuBox = inPageBox(document.querySelector(WINDOWS_MENU_SELECTOR))
    const rowStyle = row !== null ? getComputedStyle(row) : null

    if (rowBox === null || crumbsBox === null) return clear(body)

    // Furniture: the caption buttons, at least a menu mark.
    const furniture = Math.max(FURNITURE, menuBox?.right ?? 0)
    const controlsSize = band.controls.size > 0 ? band.controls.size : FURNITURE
    const edge = width - controlsSize - GAP

    // The strip rides the band when the host has already centred it up there.
    const inBand = stripBox !== null && stripBox.top < band.height
    const stripWidth = stripBox?.width ?? 0

    // The utilities cluster lifts when it clears the furniture and the strip.
    const clusterWidth = (utilitiesBox?.width ?? 0) + (cornerBox?.width ?? 0) + GAP
    const liftActions = clusterWidth > GAP && edge - clusterWidth >= Math.max(furniture, (stripBox?.right ?? 0)) + GAP

    const left = Math.max(rowBox.left, furniture + GAP)
    const rightStop = liftActions ? edge - clusterWidth : edge + GAP
    const room = rightStop - GAP - (inBand ? stripWidth + GAP : 0) - left
    const liftTitle = room >= MIN_TITLE

    if (!liftTitle && !liftActions && !inBand) return clear(body)

    const titleCentre = band.height / 2 + TITLE_NUDGE
    const appliedLift = parseFloat(rowStyle?.getPropertyValue('margin-top') ?? '0') || 0
    const rise = Math.max(0, Math.round(rowBox.top - appliedLift - (titleCentre + crumbsBox.height / 2 - TITLE_NUDGE)))

    body.style.setProperty(ROW_LIFT, `${-rise}px`)
    body.style.setProperty(TITLE_TOP, `${Math.round(titleCentre)}px`)
    body.style.setProperty(TITLE_LEFT, `${Math.round(left)}px`)
    body.style.setProperty(TITLE_MAX, `${Math.max(0, Math.round(room))}px`)
    body.style.setProperty(BAND_RIGHT, `${controlsSize + GAP}px`)

    const titleWidth = liftTitle ? Math.min(crumbsBox.width, room) : 0
    const leftStop = liftTitle ? left + titleWidth : furniture
    const centre = (leftStop + rightStop) / 2
    body.style.setProperty(TABS_LEFT, `${Math.round(centre)}px`)

    if (header !== null) {
      const tokens = [liftTitle ? 'title' : '', inBand ? 'tabs' : '', liftActions ? 'actions' : ''].filter((token) => token !== '')
      setAttributeIfChanged(header, BAND_ATTR, tokens.join(' '))
    }
  }

  const clear = (body: HTMLElement) => {
    for (const property of [ROW_LIFT, TITLE_TOP, TITLE_LEFT, TITLE_MAX, TABS_LEFT, BAND_RIGHT]) {
      body.style.removeProperty(property)
    }
    const header = row?.closest(CONVERSATION_HEADER_SELECTOR)
    if (header !== null) setAttributeIfChanged(header, BAND_ATTR, '')
  }

  track()
  notify = scheduleSync
  const mutation = new MutationObserver(() => scheduleSync())
  mutation.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'data-dsh-lite-part'] })
  window.addEventListener('resize', scheduleSync)

  return () => {
    stopped = true
    notify = null
    mutation.disconnect()
    resizeObserver?.disconnect()
    window.removeEventListener('resize', scheduleSync)
    band?.release()
    const body = document.body
    if (body !== null) clear(body)
  }
}
