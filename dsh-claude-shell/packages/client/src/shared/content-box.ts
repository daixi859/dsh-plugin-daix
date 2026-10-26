/**
 * The box a container's content covers: the union of its element children's
 * boxes, or its own box when it draws no child.
 *
 * The host measures the view-tab row it draws from 0.2.1-rc.3 — that row spans
 * the header so the host counts room for every tab, while the strip the reader
 * sees is the plate and the overflow button standing in it. A placement that
 * reasons about the visible strip takes this box rather than the row's own
 * (features/view-tabs, features/header-band).
 *
 * @param container - the element whose children are what it draws.
 * @returns the union of the children's boxes; null when nothing has extent.
 */
export function contentBox(container: Element) {
  let box: DOMRect | null = null
  for (const child of container.children) {
    const childBox = child.getBoundingClientRect()
    if (childBox.width === 0 && childBox.height === 0) continue
    box = box === null ? childBox : new DOMRect(
      Math.min(box.left, childBox.left),
      Math.min(box.top, childBox.top),
      Math.max(box.right, childBox.right) - Math.min(box.left, childBox.left),
      Math.max(box.bottom, childBox.bottom) - Math.min(box.top, childBox.top),
    )
  }
  if (box !== null) return box
  const own = container.getBoundingClientRect()
  return own.width === 0 && own.height === 0 ? null : own
}
