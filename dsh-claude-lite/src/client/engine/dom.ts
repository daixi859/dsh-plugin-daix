/**
 * The DOM helpers the walk and the band share.
 */

/**
 * Does the element's class list carry this CSS-module local name?
 *
 * The host hashes its class names (`_2H3hWW_root`, `_root_38jqx_3`), so a
 * stylesheet cannot match one whole, and a substring match takes whatever else
 * holds that fragment. The local name is the hash stripped from both shapes:
 * the tail of `<hash>_<local>` and the head-minus-index of
 * `_<local>_<hash>_<n>`.
 */
export function localClassName(element: Element, name: string): boolean {
  const classes = typeof element.className === 'string' ? element.className : ''
  if (classes === '') return false
  for (const cls of classes.split(/\s+/)) {
    if (cls === name) return true
    if (cls.startsWith(`_${name}_`)) return true
    if (cls.endsWith(`_${name}`)) return true
  }
  return false
}

/** Set an attribute only when the value would change, so a walk never invalidates style. */
export function setAttributeIfChanged(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) === value) return
  element.setAttribute(name, value)
}
