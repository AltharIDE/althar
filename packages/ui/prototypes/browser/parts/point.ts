// Scrappy: an element as the lead reads it: a selector that finds it again, and its words.

const MODULE_CLASS = /^([A-Za-z0-9-]+)__([A-Za-z0-9-]+)__[A-Za-z0-9_-]{4,}$/

/** A class as written in its stylesheet: RunsOn__needs__x1Y2 is needs. */
const short = (name: string) => MODULE_CLASS.exec(name)?.[2] ?? name

const css = (value: string) => (typeof CSS !== 'undefined' && 'escape' in CSS ? CSS.escape(value) : value)

/** A value as a quoted CSS string: backslashes and quotes escaped, line breaks as code points. */
const quoted = (value: string) => `"${value.replace(/[\\"]/g, '\\$&').replace(/[\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}"`

/** One step of a selector: the tag, its id, its label, or its first class. */
const step = (el: Element): string => {
  const tag = el.tagName.toLowerCase()
  if (el.id !== '') return `#${css(el.id)}`
  const label = el.getAttribute('aria-label')
  if (label !== null && label.length < 60) return `${tag}[aria-label=${quoted(label)}]`
  const named = [...el.classList].find((one) => !one.startsWith('ch-'))
  return named === undefined ? tag : `${tag}.${css(named)}`
}

const unique = (doc: Document, selector: string) => {
  try {
    return doc.querySelectorAll(selector).length === 1
  } catch {
    return false
  }
}

/** The shortest selector, walking up, that finds this element and no other. */
export const selectorOf = (el: Element): string => {
  const doc = el.ownerDocument
  const parts: string[] = []
  let at: Element | null = el
  while (at !== null && at !== doc.body && at !== doc.documentElement) {
    let part = step(at)
    const parent: Element | null = at.parentElement
    if (parent !== null) {
      const same = [...parent.children].filter((one) => one.tagName === at?.tagName && step(one) === part)
      if (same.length > 1)
        part = `${part}:nth-of-type(${[...parent.children].filter((one) => one.tagName === at?.tagName).indexOf(at) + 1})`
    }
    parts.unshift(part)
    const selector = parts.join(' > ')
    if (unique(doc, selector)) return selector
    at = parent
  }
  return parts.join(' > ')
}

/** The element at a glance, in the overlay's label: span.needs, section[aria-label]. */
export const labelOf = (el: Element): string => {
  const tag = el.tagName.toLowerCase()
  const named = [...el.classList].find((one) => !one.startsWith('ch-'))
  if (named !== undefined) return `${tag}.${short(named)}`
  if (el.getAttribute('aria-label') !== null) return `${tag}[aria-label]`
  return el.id === '' ? tag : `${tag}#${el.id}`
}

/** Its words, as one line, cut short: each piece of text apart, as the page lays them out apart. */
export const textOf = (el: Element): string => {
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const pieces: string[] = []
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const piece = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (piece !== '') pieces.push(piece)
  }
  const words = pieces.join(' ')
  return words.length > 90 ? `${words.slice(0, 89)}…` : words
}

/** Finds it again on the page, where it is still there. */
export const find = (doc: Document | null | undefined, selector: string): Element | null => {
  if (doc == null) return null
  try {
    return doc.querySelector(selector)
  } catch {
    return null
  }
}
