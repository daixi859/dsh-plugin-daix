/**
 * The desktop band: read the window caption's geometry from the
 * Window Controls Overlay and publish it as custom properties and marks.
 *
 * The web page has no overlay and gets a null band — the title stays in the
 * header and no lite rule moves anything. On win32 the overlay trajectory
 * tells the band's height, its caption buttons' width and whether it shows;
 * the values land on <body> as --dsh-frame-top-clearance (the same property
 * dsh-claude-style publishes, so the host's own band-aware rules agree) and
 * on <html> as the titlebar mark the sheets read.
 */

/** The live band: its measures, and the teardown. */
export interface DesktopBand {
  platform: 'win32'
  /** The caption row's height in css px; 0 while the overlay is hidden. */
  height: number
  /** The caption buttons' total width in css px. */
  controls: { size: number }
  /** Restore the marks and stop listening. */
  release(): void
}

/** The custom property the band's height is published through. */
export const FRAME_TOP_CLEARANCE_PROPERTY = '--dsh-frame-top-clearance'
/** The html mark: which titlebar shape is live. */
export const WINDOWS_TITLEBAR_ATTRIBUTE = 'data-windows-titlebar'

type OverlayRect = { y: number, height: number, width: number, x: number }
type Overlay = {
  isVisible: boolean
  getTitlebarAreaRect?(): OverlayRect
  ongeometrychange: ((this: Overlay, event: Event) => void) | null
  addEventListener?(type: string, listener: (event: Event) => void): void
  removeEventListener?(type: string, listener: (event: Event) => void): void
}

function overlay(): Overlay | null {
  return (navigator as unknown as { windowControlsOverlay?: Overlay }).windowControlsOverlay ?? null
}

/**
 * Read the band once and subscribe to its changes. Returns null off win32 or
 * without an overlay; otherwise the live band.
 */
export function desktopBand(onChange: () => void): DesktopBand | null {
  const control = overlay()
  const platformHint = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? ''
  if (control === null || !/win/i.test(platformHint)) return null

  let height = 0
  let controlsSize = 0
  let visible = false

  const publish = () => {
    const root = document.documentElement
    const body = document.body
    if (body === null) return
    if (visible) {
      body.style.setProperty(FRAME_TOP_CLEARANCE_PROPERTY, `${height}px`)
      root.setAttribute(WINDOWS_TITLEBAR_ATTRIBUTE, 'overlay')
    } else {
      body.style.removeProperty(FRAME_TOP_CLEARANCE_PROPERTY)
      root.setAttribute(WINDOWS_TITLEBAR_ATTRIBUTE, 'public')
    }
  }

  const read = () => {
    visible = control.isVisible === true
    if (visible) {
      const rect = control.getTitlebarAreaRect?.()
      if (rect != null) {
        height = Math.round(rect.height)
        // The caption buttons sit on the titlebar rect's right. The overlay
        // states no width, so it is measured the way the shell measures it:
        // the buttons' block is the band's own standard 3-button run, whose
        // width rides the zoom-scaled 48px-per-button furniture.
        controlsSize = Math.round(48 * (height / 32))
      }
    }
    publish()
    onChange()
  }

  const handler = () => read()
  read()
  control.ongeometrychange = handler
  control.addEventListener?.('geometrychange', handler)
  window.addEventListener('resize', handler)

  return {
    platform: 'win32',
    get height() { return height },
    controls: { get size() { return controlsSize } },
    release() {
      control.ongeometrychange = null
      control.removeEventListener?.('geometrychange', handler)
      window.removeEventListener('resize', handler)
    },
  }
}
