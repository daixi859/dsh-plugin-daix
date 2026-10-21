/**
 * The host class names the skin reads, as data: host CSS-module local name →
 * the skin's own part name. core/parts.ts walks these tables and writes the
 * part names onto the elements as the walk's attribute, so every rule matches
 * one attribute whole and a host rename is one line here.
 *
 * This is dsh-claude-style's table, cut down to the parts lite paints: the
 * frame, the sidebar and the conversation header. The conversation and the
 * right column keep the host's own — that is the whole point of lite.
 */
import { CONVERSATION_HEADER_SLOT_SELECTOR, ROOT_SLOT_SELECTOR, SIDEBAR_SLOT_SELECTOR } from '../constants.ts'

/** Host CSS-module local name → the skin's part name. */
export type PartTable = Record<string, string>

/** The walk's attribute: the part names an element stands for, space-separated. */
export const PART_ATTR = 'data-dsh-lite-part'

/** The hold attribute: `data-dsh-lite-holds~="name"`, kept current by the walk. */
export const HOLDS_ATTR = 'data-dsh-lite-holds'

/** The shell's three columns, read from the root slot down. */
export const FRAME_PARTS: PartTable = {
  sidebarCol: 'sidebar-column',
  centerCol: 'center-column',
  rightbarCol: 'rightbar-column',
}

/** The sidebar, from its slot anchor down. */
export const SIDEBAR_PARTS: PartTable = {
  logoRow: 'logo-row',
  brand: 'brand-button',
  brandIdentity: 'brand-identity',
  brandMark: 'brand-mark',
  brandName: 'brand-name',
  railMark: 'rail-mark',
  toggle: 'sidebar-toggle',
  panelIcon: 'panel-icon',
  newSession: 'new-session',
  newSessionLabelMask: 'new-session-mask',
  newSessionContent: 'new-session-content',
  newSessionShortcut: 'new-session-shortcut',
  separator: 'key-separator',
  panelList: 'panel-list',
  panelRow: 'panel-row',
  panelGlyph: 'panel-glyph',
  regionArea: 'region-area',
  footArea: 'foot-area',
  footerActions: 'footer-actions',
  footerButtons: 'footer-buttons',
  settingsArea: 'settings-area',
  sectionHeader: 'section-header',
  sectionLabel: 'section-label',
  sectionActions: 'section-actions',
  headerActionsHidden: 'section-actions-hidden',
  treeBody: 'tree-body',
  groupSection: 'group-section',
  projectRow: 'project-row',
  sessionRow: 'session-row',
  title: 'row-title',
  projectText: 'row-project-text',
  time: 'row-time',
  rowActions: 'row-actions',
  iconButton: 'row-icon-button',
  slot: 'row-slot',
  folder: 'row-folder',
  folderActive: 'row-folder-active',
  chevron: 'row-chevron',
  arrow: 'row-arrow',
  active: 'row-active',
  selected: 'row-selected',
  menuOpen: 'row-menu-open',
  searchSlot: 'search-slot',
  searchButton: 'search-button',
  triggerRow: 'settings-trigger',
  list: 'list',
  listArea: 'list-area',
}

/** The conversation's header, from its slot anchor down. */
export const HEADER_PARTS: PartTable = {
  header: 'conversation-header',
  headerLeading: 'header-leading',
  titleRow: 'title-row',
  titleCluster: 'title-cluster',
  crumbs: 'header-title',
  crumbSeg: 'header-crumb',
  headerActions: 'header-actions',
  headerUtilities: 'header-utilities',
  headerCorner: 'header-corner',
  tabs: 'view-tabs',
  tab: 'view-tab',
  tabActive: 'view-tab-active',
  label: 'header-label',
}

/** One region: the host subtree its parts are read in, and the parts themselves. */
export interface PartRegion {
  /** The host subtree the region's parts are read in; a host contract. */
  within: string
  parts: PartTable
  /**
   * Parts read on the anchor's own element children alone — where the host
   * puts a slot's content. A local name as common as `root` cannot be read
   * anywhere inside the region.
   */
  rootParts?: PartTable
}

/** Every region, in the order the walk enters them. */
export function partRegions(): PartRegion[] {
  return [
    {
      within: ROOT_SLOT_SELECTOR,
      parts: FRAME_PARTS,
      rootParts: { frame: 'layout-frame' },
    },
    {
      within: SIDEBAR_SLOT_SELECTOR,
      parts: SIDEBAR_PARTS,
      rootParts: { root: 'sidebar-root', collapsed: 'sidebar-collapsed', quietBars: 'sidebar-quiet', fading: 'sidebar-fading' },
    },
    { within: CONVERSATION_HEADER_SLOT_SELECTOR, parts: HEADER_PARTS },
  ]
}

/**
 * The structural relations a stylesheet reads as a hold: a rule naming an
 * element because of what its subtree contains reads the holds attribute
 * instead, and the walk keeps that mark current. Lite keeps the two the
 * band and the frame rules read.
 */
export interface HoldRelation {
  /** The word a stylesheet reads in `[data-dsh-lite-holds~="…"]`. */
  name: string
  /** Selector for the element that takes the mark. */
  holder: string
  /** Selector for the held side, matched on each node the walk visits. */
  held: string
  /** Only the held node's own parent counts. */
  direct?: boolean
}

/** Every relation a stylesheet reads. */
export function holdRelations(): HoldRelation[] {
  const part = (name: string) => `[${PART_ATTR}~="${name}"]`
  return [
    // band.css: the frame paints to the window's top only where its own first
    // column is the sidebar.
    { name: 'sidebar-column', holder: part('layout-frame'), held: part('sidebar-column'), direct: true },
    // band.css: the header owns the tab strip, and only that header loses its
    // bottom edge.
    { name: 'view-tabs', holder: part('conversation-header'), held: part('view-tabs') },
  ]
}
