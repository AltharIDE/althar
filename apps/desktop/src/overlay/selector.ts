/*
 * A CSS selector for an element the person pointed at, which finds it, and
 * no other, on the page as it was: the shortest run of steps up from it
 * that is unique. Every name a page chose (an id, a class, a label) is
 * written as CSS reads it: a plain name as it is, anything else as a quoted
 * value, escaped by the CSSOM's own rules rather than left to the page's
 * `CSS.escape`, so no name a page can give breaks out of its step, and the
 * selector always parses.
 */

const hex = (code: number) => `\\${code.toString(16)} `

/**
 * A name as a CSS identifier, as CSSOM's `CSS.escape` writes one: a
 * control character or a leading digit as its code point, NUL as the
 * replacement character, a lone `-` and any other punctuation behind a
 * backslash, and letters, digits, `-`, `_` and anything past ASCII as they
 * are.
 */
export const escapeIdent = (name: string): string => {
  let out = ''
  for (let i = 0; i < name.length; i += 1) {
    const code = name.charCodeAt(i)
    const first = name.charCodeAt(0)
    if (code === 0) out += '�'
    else if ((code >= 0x1 && code <= 0x1f) || code === 0x7f) out += hex(code)
    else if (i === 0 && code >= 0x30 && code <= 0x39) out += hex(code)
    else if (i === 1 && code >= 0x30 && code <= 0x39 && first === 0x2d) out += hex(code)
    else if (i === 0 && code === 0x2d && name.length === 1) out += `\\${name.charAt(i)}`
    else if (
      code >= 0x80 ||
      code === 0x2d ||
      code === 0x5f ||
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a)
    )
      out += name.charAt(i)
    else out += `\\${name.charAt(i)}`
  }
  return out
}

/**
 * A value as a quoted CSS string, as CSSOM serializes one: `"` and `\`
 * behind a backslash, control characters and line breaks as their code
 * points, NUL as the replacement character.
 */
export const cssString = (value: string): string => {
  let out = '"'
  for (const char of value) {
    const code = char.charCodeAt(0)
    if (code === 0) out += '�'
    else if ((code >= 0x1 && code <= 0x1f) || code === 0x7f) out += hex(code)
    else if (char === '"' || char === '\\') out += `\\${char}`
    else out += char
  }
  return `${out}"`
}

/* A class a page's tooling makes and remakes (a CSS module's hash, Tailwind's state variants) reads poorly as the element's name. */
const MODULE_CLASS = /^(?:[A-Za-z0-9-]+?)(?:-module)?__([A-Za-z0-9-]+)__[A-Za-z0-9_-]{4,}$/

/** A class as it was written in its stylesheet: `RunsOn-module__needs__x1Y2` is `needs`. */
export const shortClass = (name: string): string => MODULE_CLASS.exec(name)?.[1] ?? name

/* Labels and test ids long enough to be prose are poor handles. */
const LABEL_LONGEST = 80

/** Attributes that name an element on purpose, in the order they make the best handle. */
const NAMING = ['data-testid', 'data-test', 'data-qa', 'aria-label', 'name'] as const

const tagOf = (element: Element) => element.localName

/* A name that reads as itself after `#` or `.`; any other is matched as a quoted value, which reads better than its escapes do. */
const PLAIN = /^(?:-?[A-Za-z_]|--)[A-Za-z0-9_-]*$/

/** An element's id as a step: `#title`, or `[id="…"]` for one that isn't a plain name. */
const idStep = (id: string) => (PLAIN.test(id) ? `#${id}` : `[id=${cssString(id)}]`)

/** A class as part of a step: `.needs`, or `[class~="…"]` for one that isn't a plain name (`md:p-4`, `w-1/2`). */
const classStep = (name: string) => (PLAIN.test(name) ? `.${name}` : `[class~=${cssString(name)}]`)

/** One step of a selector for an element, without regard to its siblings: its id, a naming attribute, its first class, or its tag. */
export const stepOf = (element: Element): string => {
  const tag = escapeIdent(tagOf(element))
  if (element.id !== '') return idStep(element.id)
  for (const name of NAMING) {
    const value = element.getAttribute(name)
    if (value !== null && value !== '' && value.length <= LABEL_LONGEST) return `${tag}[${name}=${cssString(value)}]`
  }
  const named = [...element.classList].find((one) => one !== '')
  return named === undefined ? tag : `${tag}${classStep(named)}`
}

const finds = (root: ParentNode, selector: string): number => {
  try {
    return root.querySelectorAll(selector).length
  } catch {
    // Never for a selector made here; a page can't make one fail, but a count of none keeps walking up.
    return 0
  }
}

/** Its place among its siblings of the same tag, where its step alone doesn't tell them apart. */
const placed = (element: Element, step: string): string => {
  const parent = element.parentElement
  if (parent === null) return step
  const same = [...parent.children].filter((one) => tagOf(one) === tagOf(element))
  if (same.length < 2 || [...parent.children].filter((one) => one !== element && stepOf(one) === step).length === 0) return step
  return `${step}:nth-of-type(${same.indexOf(element) + 1})`
}

/** The shortest selector, walking up from the element, that finds it and no other in its document. */
export const selectorOf = (element: Element): string => {
  const document = element.ownerDocument
  const parts: Array<string> = []
  let at: Element | null = element
  while (at !== null) {
    const step = stepOf(at)
    // An id is a step alone; anything else is told apart from same-named siblings by its place.
    parts.unshift(at.id !== '' ? step : placed(at, step))
    const selector = parts.join(' > ')
    if (finds(document, selector) === 1 && document.querySelector(selector) === element) return selector
    // An id that isn't unique (pages repeat them) is still a step; walking up from it narrows it.
    at = at.parentElement
  }
  return parts.join(' > ')
}

/** The element at a glance, as the comment's chip names it: its tag and its first class as written, `span.needs`. */
export const labelOf = (element: Element): string => {
  const tag = tagOf(element)
  if (element.id !== '') return `${tag}#${element.id}`.slice(0, 120)
  const named = [...element.classList].find((one) => one !== '')
  if (named !== undefined) return `${tag}.${shortClass(named)}`.slice(0, 120)
  const label = element.getAttribute('aria-label')
  return label !== null && label !== '' ? `${tag}[aria-label]` : tag
}
