/**
 * The marking pass: walk the regions, write the part names and the holds, and
 * keep both current while the page changes.
 *
 * The tables (parts-table.ts) say which host local names become which part
 * names. The walk reads each region's slot anchor, marks the anchor's subtree
 * — the rootParts on the anchor's own children alone — and recomputes the
 * holds. Everything is idempotent: an element whose stamps would not change
 * is left alone, so a re-walk never invalidates style.
 */
import { schedulePass } from '../core/bus.ts'
import { localClassName, setAttributeIfChanged } from './dom.ts'
import {
  HOLDS_ATTR,
  PART_ATTR,
  holdRelations,
  partRegions,
  type HoldRelation,
  type PartRegion,
  type PartTable,
} from './parts-table.ts'

export interface PartsVocabulary {
  part: string
  holds: string
}

let regions: PartRegion[] = []
let relations: HoldRelation[] = []
let observer: MutationObserver | null = null
let stopped = false

/** The part names one element carries, under one region's table. */
function partsOf(element: Element, table: PartTable): string[] {
  const names: string[] = []
  for (const [local, part] of Object.entries(table)) {
    if (localClassName(element, local)) names.push(part)
  }
  return names
}

/** Stamp one element with one table's parts, merged into what it already carries. */
function stamp(element: Element, table: PartTable): void {
  const names = partsOf(element, table)
  if (names.length === 0) return
  const current = (element.getAttribute(PART_ATTR) ?? '').split(/\s+/).filter((name) => name !== '')
  const merged = [...new Set([...current, ...names])]
  setAttributeIfChanged(element, PART_ATTR, merged.join(' '))
}

/** Walk one subtree with one table, depth first, stamps merged. */
function walk(element: Element, table: PartTable): void {
  stamp(element, table)
  for (const child of element.children) walk(child, table)
}

/** Apply every region and recompute every hold. Idempotent throughout. */
function apply(): void {
  if (stopped) return
  for (const region of regions) {
    let anchors: NodeListOf<Element>
    try {
      anchors = document.querySelectorAll(region.within)
    } catch {
      continue
    }
    anchors.forEach((anchor) => {
      for (const child of anchor.children) {
        // rootParts: the slot's content reads on the anchor's own children alone.
        if (region.rootParts !== undefined) stamp(child, region.rootParts)
        walk(child, region.parts)
      }
      walk(anchor, region.parts)
    })
  }
  // The holds: for each relation, mark the holders of every held side.
  for (const relation of relations) {
    let held: NodeListOf<Element>
    try {
      held = document.querySelectorAll(relation.held)
    } catch {
      continue
    }
    held.forEach((node) => {
      const holder = relation.direct === true ? node.parentElement : node.closest(relation.holder)
      if (holder === null) return
      const current = (holder.getAttribute(HOLDS_ATTR) ?? '').split(/\s+/).filter((name) => name !== '')
      if (!current.includes(relation.name)) {
        setAttributeIfChanged(holder, HOLDS_ATTR, [...current, relation.name].join(' '))
      }
    })
  }
}

/** The schedule wrapper: a burst of mutations costs one walk. */
function scheduleApply(): void {
  schedulePass('read', apply)
}

/**
 * Install the pass: one full walk now, then an observer that re-walks whenever
 * the page changes inside or around the regions. Returns the teardown.
 */
export function installParts(onMarked?: () => void): () => void {
  stopped = false
  regions = partRegions()
  relations = holdRelations()
  apply()
  onMarked?.()

  observer = new MutationObserver(() => scheduleApply())
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'data-slot', 'data-sidebar-collapsed'],
  })
  return () => {
    stopped = true
    observer?.disconnect()
    observer = null
    clearParts()
  }
}

/** Strip the walk's attributes from everything that carries them. */
export function clearParts(): void {
  const marked = document.querySelectorAll(`[${PART_ATTR}], [${HOLDS_ATTR}]`)
  marked.forEach((element) => {
    element.removeAttribute(PART_ATTR)
    element.removeAttribute(HOLDS_ATTR)
  })
}
