import type {
  Chosen,
  Described,
  Done,
  Driver,
  Failed,
  Filled,
  Found,
  Layout,
  Located,
  Query,
  Scrolled,
  Snapshot,
  Target,
} from '../main/browser/driving'
import type { Box } from '../main/browser/picked'
import { describe } from './describe'
import { labelOf } from './selector'

/*
 * The lead's eyes and hands in a page beside the conversation (ADR-100,
 * agents driving pages). Run by the main process in the page's isolated
 * world, beside the comment overlay: it shares the page's elements but none
 * of its scripts, so the page can't call it, change what it does or read
 * what it holds. It reads (the accessibility tree with references, an
 * element's place, what a field holds) and prepares (focus, selection, a
 * scroll); the main process does the pressing and typing with real input
 * events, so the page sees what it would from a person. Everything here
 * answers in plain data, in words for the lead where it can't.
 */

/** What the driver needs of the overlay it is installed beside: drawing the lead's outline. */
export interface DriverHooks {
  readonly mark: (rect: Box) => void
  /** Takes the outlines away at once; how many there were. */
  readonly unmark: () => number
}

/** The most elements a snapshot holds, and the longest a name or a run of text in it is. */
const LIMIT_NODES = 1_500
const LONGEST_NAME = 100
const LONGEST_TEXT = 200
const LONGEST_VALUE = 200
const LONGEST_HREF = 240
/** Options of a list listed under it, and how deep a document is read. */
const MOST_OPTIONS = 50
const DEEPEST = 500
/** A page's height a scroll by a page covers: a little less than the viewport, so a line is read twice rather than lost. */
const PAGE_STEP = 0.85

/** Elements that hold no part of what the page shows, and the overlay's own host. */
const SKIPPED = new Set(['script', 'style', 'template', 'noscript', 'head', 'meta', 'link', 'title', 'base', 'datalist', 'althar-overlay'])

/** Every ARIA role a `role` attribute may name; anything else is ignored, as a browser ignores it. */
const ROLES = new Set([
  'alert',
  'alertdialog',
  'application',
  'article',
  'banner',
  'blockquote',
  'button',
  'caption',
  'cell',
  'checkbox',
  'code',
  'columnheader',
  'combobox',
  'complementary',
  'contentinfo',
  'definition',
  'dialog',
  'directory',
  'document',
  'emphasis',
  'feed',
  'figure',
  'form',
  'grid',
  'gridcell',
  'group',
  'heading',
  'img',
  'link',
  'list',
  'listbox',
  'listitem',
  'log',
  'main',
  'marquee',
  'math',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'meter',
  'navigation',
  'note',
  'option',
  'paragraph',
  'progressbar',
  'radio',
  'radiogroup',
  'region',
  'row',
  'rowgroup',
  'rowheader',
  'scrollbar',
  'search',
  'searchbox',
  'separator',
  'slider',
  'spinbutton',
  'status',
  'strong',
  'switch',
  'tab',
  'table',
  'tablist',
  'tabpanel',
  'term',
  'textbox',
  'timer',
  'toolbar',
  'tooltip',
  'tree',
  'treegrid',
  'treeitem',
])

/** Roles a person presses, picks or types in: each gets a reference. */
const INTERACTIVE = new Set([
  'link',
  'button',
  'textbox',
  'searchbox',
  'checkbox',
  'radio',
  'combobox',
  'listbox',
  'option',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'treeitem',
])

/** Roles named by what they hold: a button is called what it says. */
const NAMED_BY_CONTENT = new Set([
  'button',
  'link',
  'heading',
  'option',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'treeitem',
  'checkbox',
  'radio',
  'switch',
  'columnheader',
  'rowheader',
  'caption',
  'tooltip',
  'term',
])

/** Roles whose reference or name adds nothing: their words, and their place, are all that is said. */
const PLAIN = new Set([
  'listitem',
  'cell',
  'gridcell',
  'row',
  'rowgroup',
  'columnheader',
  'rowheader',
  'caption',
  'term',
  'definition',
  'paragraph',
])

/** Roles that mean something with no name and no children. */
const STANDS_ALONE = new Set(['separator', 'progressbar', 'meter', 'slider', 'spinbutton', 'scrollbar'])

/** Roles whose children are the field's own, never read as the page's, when the element is a native field. */
const FIELDS = new Set(['textbox', 'searchbox', 'spinbutton', 'slider', 'checkbox', 'radio', 'progressbar', 'meter', 'switch'])
const NATIVE_FIELDS = new Set(['input', 'textarea', 'progress', 'meter'])

const INPUT_ROLES: Readonly<Record<string, string | null>> = {
  text: 'textbox',
  email: 'textbox',
  tel: 'textbox',
  url: 'textbox',
  search: 'searchbox',
  password: 'textbox',
  number: 'spinbutton',
  range: 'slider',
  checkbox: 'checkbox',
  radio: 'radio',
  button: 'button',
  submit: 'button',
  reset: 'button',
  image: 'button',
  file: 'button',
  color: 'button',
  date: 'textbox',
  'datetime-local': 'textbox',
  month: 'textbox',
  time: 'textbox',
  week: 'textbox',
  hidden: null,
}

/** Input types that hold text a person types. */
const TYPED = new Set(['text', 'email', 'tel', 'url', 'search', 'password', 'number', 'date', 'datetime-local', 'month', 'time', 'week'])

const BUTTON_WORDS: Readonly<Record<string, string>> = {
  submit: 'Submit',
  reset: 'Reset',
  image: 'Submit',
  file: 'Choose file',
  color: 'Color',
}

/* ------------------------------------------------------------------ small helpers */

const squash = (text: string) => text.replace(/\s+/g, ' ').trim()

const cut = (text: string, longest: number) => (text.length > longest ? `${text.slice(0, longest - 1)}…` : text)

/** A name or text in a snapshot's quotes. */
const quote = (text: string) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

const isElement = (node: Node): node is Element => node.nodeType === 1

const css = (element: Element) => window.getComputedStyle(element)

/** A box with whole pixels round it. */
const boxOf = (rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }): Box => ({
  x: Math.round(rect.x),
  y: Math.round(rect.y),
  width: Math.round(rect.width),
  height: Math.round(rect.height),
})

/** What the element has inside, as drawn: a shadow root's tree for a host, the nodes slotted in for a slot. */
const childNodesOf = (element: Element): ReadonlyArray<Node> => {
  if (element.localName === 'slot') {
    const assigned = (element as HTMLSlotElement).assignedNodes?.({ flatten: true }) ?? []
    if (assigned.length > 0) return assigned
  } else if (element.shadowRoot !== null) return [...element.shadowRoot.childNodes]
  return [...element.childNodes]
}

/** Whether `inner` is `outer` or inside it, through shadow roots too. */
const within = (inner: Node | null, outer: Node): boolean => {
  for (let at: Node | null = inner; at !== null; at = at.parentNode ?? (at as ShadowRoot).host ?? null) if (at === outer) return true
  return false
}

const attribute = (element: Element, name: string) => element.getAttribute(name)

const isTrue = (element: Element, name: string) => attribute(element, name) === 'true'

/** The element with the page's focus, through shadow roots. */
const focusedElement = (): Element | null => {
  let active = document.activeElement
  while (active?.shadowRoot?.activeElement != null) active = active.shadowRoot.activeElement
  return active
}

/** Whether the element is left out of what the page shows: not drawn, hidden from assistive technology, or a closed dialog. */
const isGone = (element: Element, style: CSSStyleDeclaration): boolean =>
  style.display === 'none' ||
  isTrue(element, 'aria-hidden') ||
  (element.hasAttribute('hidden') && attribute(element, 'hidden') !== 'until-found') ||
  (element.localName === 'dialog' && !element.hasAttribute('open')) ||
  (element.localName === 'input' && (element as HTMLInputElement).type === 'hidden')

/** Whether the element is a block: it breaks the words round it. */
const isBlock = (style: CSSStyleDeclaration): boolean => {
  const display = style.display
  return display !== '' && !display.startsWith('inline') && display !== 'contents'
}

const isDisabled = (element: Element): boolean => {
  if (isTrue(element, 'aria-disabled')) return true
  try {
    return element.matches(':disabled')
  } catch {
    return false
  }
}

const inputType = (element: Element): string => (element.localName === 'input' ? (element as HTMLInputElement).type.toLowerCase() : '')

const isEditableAttribute = (element: Element): boolean => {
  const value = attribute(element, 'contenteditable')
  return value !== null && value !== 'false'
}

/** A field a person types in, whether or not they may now: an input of a typed kind, a textarea, or an element made editable. */
const isTextField = (element: Element): boolean =>
  element.localName === 'textarea' ||
  (element.localName === 'input' && TYPED.has(inputType(element))) ||
  isEditableAttribute(element) ||
  (element as HTMLElement).isContentEditable === true

/* ------------------------------------------------------------------ words: names and text */

/** What an element's `svg` is called: its label, or its title. */
const svgName = (element: Element): string => {
  const label = attribute(element, 'aria-label')
  if (label !== null && squash(label) !== '') return squash(label)
  for (const child of element.children) if (child.localName === 'title') return squash(child.textContent ?? '')
  return ''
}

/**
 * The words in an element as a person reads them: its text, hidden things
 * left out, pictures by their alt, a button's value, with a space where a
 * block or a line break parts the words and none between inline pieces.
 * Fields' own contents are left to the field.
 */
const contentText = (root: Element, includeHidden = false, longest = 400): string => {
  let out = ''
  const walk = (node: Node, muted: boolean): void => {
    if (out.length > longest) return
    if (node.nodeType === 3) {
      if (!muted) out += (node.textContent ?? '').replace(/\s+/g, ' ')
      return
    }
    if (!isElement(node) || SKIPPED.has(node.localName)) return
    const style = css(node)
    if (!includeHidden && isGone(node, style)) return
    // Words in a box that isn't drawn are not read; a child that is drawn again is.
    const unseen = !includeHidden && (style.visibility === 'hidden' || style.visibility === 'collapse')
    const block = isBlock(style)
    if (block) out += ' '
    const name = node.localName
    if (unseen) for (const child of childNodesOf(node)) walk(child, true)
    else if (name === 'img' || name === 'area') out += attribute(node, 'alt') ?? ''
    else if (name === 'svg') out += svgName(node)
    else if (name === 'br') out += ' '
    else if (name === 'input') {
      const type = inputType(node)
      if (type === 'button' || type === 'submit' || type === 'reset') out += (node as HTMLInputElement).value
    } else if (name !== 'textarea' && name !== 'select') for (const child of childNodesOf(node)) walk(child, false)
    if (block) out += ' '
  }
  for (const child of childNodesOf(root)) walk(child, false)
  return squash(out)
}

const byId = (element: Element, id: string): Element | null => {
  const root = element.getRootNode() as Document | ShadowRoot
  return root.getElementById?.(id) ?? element.ownerDocument.getElementById(id)
}

/** What `aria-labelledby` points at, read whole, hidden pieces included. */
const labelledBy = (element: Element): string => {
  const ids = (attribute(element, 'aria-labelledby') ?? '').split(/\s+/).filter((id) => id !== '')
  const parts: Array<string> = []
  for (const id of ids) {
    const found = byId(element, id)
    if (found === null) continue
    const own = attribute(found, 'aria-label')
    parts.push(own !== null && squash(own) !== '' ? squash(own) : contentText(found, true))
  }
  return squash(parts.join(' '))
}

/** What the page's markup calls an element natively: its labels, its alt, its value as a button, its legend or caption. */
const nativeName = (element: Element): string => {
  switch (element.localName) {
    case 'input': {
      const type = inputType(element)
      if (type === 'image') return squash(attribute(element, 'alt') ?? '') || BUTTON_WORDS[type] || ''
      if (type === 'button' || type === 'submit' || type === 'reset') {
        const value = squash((element as HTMLInputElement).value)
        if (value !== '') return value
        const labels = labelsOf(element)
        return labels !== '' ? labels : (BUTTON_WORDS[type] ?? '')
      }
      return labelsOf(element) || (type === 'file' ? 'Choose file' : '')
    }
    case 'textarea':
    case 'select':
    case 'meter':
    case 'progress':
    case 'output':
      return labelsOf(element)
    case 'img':
    case 'area':
      return squash(attribute(element, 'alt') ?? '')
    case 'fieldset': {
      for (const child of element.children) if (child.localName === 'legend') return contentText(child)
      return ''
    }
    case 'table': {
      for (const child of element.children) if (child.localName === 'caption') return contentText(child)
      return ''
    }
    case 'figure': {
      for (const child of element.children) if (child.localName === 'figcaption') return contentText(child)
      return ''
    }
    case 'svg':
      return svgName(element)
    case 'optgroup':
      return squash(attribute(element, 'label') ?? '')
    case 'option': {
      const label = squash(attribute(element, 'label') ?? '')
      return label !== '' ? label : squash(element.textContent ?? '')
    }
    default:
      return ''
  }
}

/** The text of the `<label>`s that point at a form control. */
const labelsOf = (element: Element): string => {
  const labels = (element as HTMLInputElement).labels
  if (labels == null) return ''
  return squash([...labels].map((label) => contentText(label)).join(' '))
}

/** An element's accessible name, in the usual order, cut short. */
const nameOf = (element: Element, role: string | null, clickable: boolean): string => {
  const labelled = labelledBy(element)
  if (labelled !== '') return cut(labelled, LONGEST_NAME)
  const label = attribute(element, 'aria-label')
  if (label !== null && squash(label) !== '') return cut(squash(label), LONGEST_NAME)
  const native = nativeName(element)
  if (native !== '') return cut(native, LONGEST_NAME)
  if (clickable || (role !== null && NAMED_BY_CONTENT.has(role))) {
    const content = contentText(element)
    if (content !== '') return cut(content, LONGEST_NAME)
  }
  const title = squash(attribute(element, 'title') ?? '')
  if (title !== '') return cut(title, LONGEST_NAME)
  const placeholder = squash(attribute(element, 'placeholder') ?? '')
  return placeholder === '' ? '' : cut(placeholder, LONGEST_NAME)
}

/* ------------------------------------------------------------------ roles */

const headingLevel = (element: Element): number => {
  const given = Number(attribute(element, 'aria-level'))
  if (Number.isInteger(given) && given >= 1) return given
  const tag = /^h([1-6])$/.exec(element.localName)
  return tag === null ? 2 : Number(tag[1])
}

/** The role a `role` attribute gives, the first it names that is one; `none` for a presentational element, null for no attribute. */
const explicitRole = (element: Element): string | null => {
  const tokens = (attribute(element, 'role') ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token !== '')
  for (const token of tokens) {
    if (token === 'presentation' || token === 'none') return 'none'
    if (ROLES.has(token)) return token
  }
  return null
}

const IMPLICIT: Readonly<Record<string, string>> = {
  button: 'button',
  summary: 'button',
  textarea: 'textbox',
  option: 'option',
  optgroup: 'group',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  nav: 'navigation',
  main: 'main',
  aside: 'complementary',
  article: 'article',
  ul: 'list',
  ol: 'list',
  menu: 'list',
  li: 'listitem',
  dl: 'list',
  dt: 'term',
  dd: 'definition',
  table: 'table',
  thead: 'rowgroup',
  tbody: 'rowgroup',
  tfoot: 'rowgroup',
  tr: 'row',
  td: 'cell',
  caption: 'caption',
  img: 'img',
  dialog: 'dialog',
  details: 'group',
  fieldset: 'group',
  hr: 'separator',
  blockquote: 'blockquote',
  figure: 'figure',
  progress: 'progressbar',
  meter: 'meter',
  output: 'status',
  search: 'search',
  p: 'paragraph',
}

/** The role an element has, or null where it has none worth a line: a container the page's words pass through. */
const roleOf = (element: Element, named: () => string): string | null => {
  const given = explicitRole(element)
  if (given === 'none') return null
  if (given !== null) return given
  const tag = element.localName
  switch (tag) {
    case 'a':
    case 'area':
      return element.hasAttribute('href') ? 'link' : null
    case 'input': {
      const type = inputType(element)
      if (type === 'text' && element.hasAttribute('list')) return 'combobox'
      return INPUT_ROLES[type] ?? 'textbox'
    }
    case 'select':
      return element.hasAttribute('multiple') || Number(attribute(element, 'size')) > 1 ? 'listbox' : 'combobox'
    case 'header':
      return element.closest('article, aside, main, nav, section') === null ? 'banner' : null
    case 'footer':
      return element.closest('article, aside, main, nav, section') === null ? 'contentinfo' : null
    case 'section':
      return named() !== '' ? 'region' : null
    case 'form':
      return named() !== '' ? 'form' : null
    case 'th':
      return attribute(element, 'scope') === 'row' ? 'rowheader' : 'columnheader'
    case 'img':
      return attribute(element, 'alt') === '' ? null : 'img'
    case 'svg':
      return svgName(element) !== '' ? 'img' : null
    case 'iframe':
    case 'frame':
      return 'iframe'
    case 'video':
    case 'audio':
    case 'canvas':
      return tag
    default:
      break
  }
  if (isEditableAttribute(element) && !isTrue(element, 'aria-readonly')) return 'textbox'
  return IMPLICIT[tag] ?? null
}

/* ------------------------------------------------------------------ the driver */

export const installDriver = (hooks: DriverHooks, trusted: (event: Event) => boolean = (event) => event.isTrusted): Driver => {
  /* ---------------------------------------------- references */
  let counter = 0
  const ids = new WeakMap<Element, string>()
  const known = new Map<string, WeakRef<Element>>()

  const refOf = (element: Element): string => {
    const given = ids.get(element)
    if (given !== undefined) return given
    counter += 1
    const id = `e${counter}`
    ids.set(element, id)
    known.set(id, new WeakRef(element))
    return id
  }

  /** Forgets the references of elements the page let go of. */
  const prune = () => {
    for (const [id, weak] of known) if (weak.deref() === undefined) known.delete(id)
  }

  const nameTarget = (target: Target): string =>
    target.ref !== undefined && target.ref !== '' ? target.ref : `\`${target.selector ?? ''}\``

  const resolve = (target: Target): Element | Failed => {
    const ref = target.ref?.trim() ?? ''
    if (ref !== '') {
      const element = known.get(ref)?.deref()
      if (element !== undefined && element.isConnected) return element
      if (/^e\d+$/.test(ref) && Number(ref.slice(1)) <= counter && Number(ref.slice(1)) > 0)
        return { ok: false, why: `${ref} isn’t on the page any more. Take a new snapshot.` }
      return { ok: false, why: `${ref} isn’t a reference from a snapshot. Take a snapshot and use a ref from it, or give a selector.` }
    }
    const selector = target.selector?.trim() ?? ''
    if (selector === '') return { ok: false, why: 'Say which element: a ref from the snapshot, or a CSS selector.' }
    let found: Element | null
    try {
      found = document.querySelector(selector)
    } catch (error) {
      return {
        ok: false,
        why: `\`${selector}\` isn’t a selector the page can read: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
    return found ?? { ok: false, why: `Nothing on the page matches \`${selector}\`.` }
  }

  const failed = (value: Element | Failed): value is Failed => !isElement(value as Node)

  /* ---------------------------------------------- the real device's input */

  let input = 0
  const count = (event: Event) => {
    if (trusted(event)) input += 1
  }
  const INPUTS = ['pointerdown', 'keydown', 'wheel'] as const
  for (const kind of INPUTS) window.addEventListener(kind, count, { capture: true, passive: true })

  /**
   * The frames of the page's own origin (Storybook's preview, an editor's frame) are listened to as well, each time the
   * count is asked for: the person's press or key in one is theirs as much as one in the page. A frame of another
   * origin can't be listened to from here.
   *
   * Kept by the document it was last listened to in, not by the frame's window: a frame that loads another document
   * keeps its window's identity, but its old window's listeners are gone with the document, so it is listened to again.
   */
  const heard = new WeakSet<Document>()
  const listenToFrames = (within: Document, depth: number) => {
    if (depth > 4) return
    for (const frame of within.querySelectorAll('iframe, frame')) {
      let inner: Window | null = null
      let document_: Document | null = null
      try {
        inner = (frame as HTMLIFrameElement).contentWindow
        document_ = inner?.document ?? null
      } catch {
        continue
      }
      if (inner === null || document_ === null) continue
      if (!heard.has(document_)) {
        heard.add(document_)
        for (const kind of INPUTS) inner.addEventListener(kind, count, { capture: true, passive: true })
      }
      listenToFrames(document_, depth + 1)
    }
  }
  const counted = (): number => {
    try {
      listenToFrames(document, 0)
    } catch {
      // A frame that went as it was looked at is listened to next time, if it comes back.
    }
    return input
  }

  /* ---------------------------------------------- the snapshot */

  interface Walk {
    readonly lines: Array<string>
    nodes: number
    readonly limit: number
    truncated: boolean
    level: number
  }
  interface Run {
    text: string
  }

  const emit = (walk: Walk, depth: number, line: string): boolean => {
    if (walk.nodes >= walk.limit) {
      walk.truncated = true
      return false
    }
    walk.nodes += 1
    walk.lines.push(`${'  '.repeat(depth)}${line}`)
    return true
  }

  /** The words gathered since the last node, as a line of text at this depth. */
  const flush = (walk: Walk, run: Run, depth: number) => {
    const text = squash(run.text)
    run.text = ''
    if (text !== '') emit(walk, depth, `- text ${quote(cut(text, LONGEST_TEXT))}`)
  }

  /** Whether a press on it does something the page set up beyond a native control: it shows a hand, or can be tabbed to. */
  const isClickable = (element: Element, style: CSSStyleDeclaration): boolean => {
    if (element === document.body || element === document.documentElement) return false
    const tabindex = attribute(element, 'tabindex')
    if (tabindex !== null && Number(tabindex) >= 0) return true
    if (style.cursor !== 'pointer') return false
    const parent = element.parentElement
    return parent === null || css(parent).cursor !== 'pointer'
  }

  const checkedOf = (element: Element, role: string): 'true' | 'mixed' | null => {
    const aria = attribute(element, 'aria-checked')
    if (aria === 'true' || aria === 'mixed') return aria
    if (aria === 'false') return null
    if (role === 'checkbox' || role === 'radio' || role === 'switch') {
      const field = element as HTMLInputElement
      if (element.localName === 'input') return field.indeterminate && role === 'checkbox' ? 'mixed' : field.checked ? 'true' : null
    }
    return null
  }

  const stateFlags = (element: Element, role: string, pointer: boolean): Array<string> => {
    const flags: Array<string> = []
    if (role === 'heading') flags.push(`[level=${headingLevel(element)}]`)
    const checked = checkedOf(element, role)
    if (checked === 'true') flags.push('[checked]')
    if (checked === 'mixed') flags.push('[checked=mixed]')
    if (isTrue(element, 'aria-selected') || (element.localName === 'option' && (element as HTMLOptionElement).selected))
      flags.push('[selected]')
    const pressed = attribute(element, 'aria-pressed')
    if (pressed === 'true') flags.push('[pressed]')
    if (pressed === 'mixed') flags.push('[pressed=mixed]')
    const expanded = attribute(element, 'aria-expanded')
    if (expanded === 'true') flags.push('[expanded]')
    else if (expanded === 'false') flags.push('[collapsed]')
    else if (element.localName === 'summary' && element.parentElement?.localName === 'details')
      flags.push((element.parentElement as HTMLDetailsElement).open ? '[expanded]' : '[collapsed]')
    if (isDisabled(element)) flags.push('[disabled]')
    if (isTrue(element, 'aria-required') || (element as HTMLInputElement).required === true) flags.push('[required]')
    if (isTrue(element, 'aria-readonly') || (element as HTMLInputElement).readOnly === true) flags.push('[readonly]')
    if (isTrue(element, 'aria-invalid')) flags.push('[invalid]')
    const current = attribute(element, 'aria-current')
    if (current !== null && current !== 'false') flags.push('[current]')
    if (inputType(element) === 'password') flags.push('[password]')
    if (element === focusedElement()) flags.push('[focused]')
    if (pointer) flags.push('[cursor=pointer]')
    return flags
  }

  /** What a field holds now, as the snapshot says it; nothing for a password. */
  const shownValue = (element: Element, role: string): string | null => {
    if (inputType(element) === 'password') return null
    if (element.localName === 'select') {
      const chosen = [...(element as HTMLSelectElement).selectedOptions].map((option) => squash(option.label || option.text))
      return chosen.join(', ')
    }
    if (element.localName === 'input' || element.localName === 'textarea') {
      if (role === 'checkbox' || role === 'radio' || role === 'switch' || role === 'button') return null
      return (element as HTMLInputElement).value
    }
    return null
  }

  const needsRef = (role: string, name: string, interactive: boolean): boolean => {
    if (interactive || role === 'iframe') return true
    if (PLAIN.has(role)) return false
    if (role === 'heading') return name !== ''
    return name !== ''
  }

  const visitChildren = (nodes: ReadonlyArray<Node>, depth: number, walk: Walk, run: Run, suppress: boolean, unseen = false) => {
    for (const node of nodes) {
      if (walk.truncated) return
      if (node.nodeType === 3) {
        if (!suppress && !unseen) run.text += (node.textContent ?? '').replace(/\s+/g, ' ')
        continue
      }
      if (isElement(node)) visitElement(node, depth, walk, run, suppress)
    }
  }

  const options = (select: Element, depth: number, walk: Walk) => {
    let shown = 0
    let more = 0
    const visit = (parent: Element, at: number) => {
      for (const child of parent.children) {
        if (child.localName === 'optgroup') {
          if (shown >= MOST_OPTIONS) {
            more += child.children.length
            continue
          }
          const label = squash(attribute(child, 'label') ?? '')
          emit(walk, at, `- group${label === '' ? '' : ` ${quote(cut(label, LONGEST_NAME))}`}`)
          visit(child, at + 1)
        } else if (child.localName === 'option') {
          if (shown >= MOST_OPTIONS) {
            more += 1
            continue
          }
          shown += 1
          const flags = [(child as HTMLOptionElement).selected ? '[selected]' : '', isDisabled(child) ? '[disabled]' : ''].filter(Boolean)
          emit(walk, at, `- option ${quote(cut(nativeName(child), LONGEST_NAME))}${flags.map((flag) => ` ${flag}`).join('')}`)
        }
      }
    }
    visit(select, depth)
    if (more > 0) emit(walk, depth, `- … ${more} more options`)
  }

  const visitElement = (element: Element, depth: number, walk: Walk, run: Run, suppress: boolean) => {
    if (SKIPPED.has(element.localName)) return
    const style = css(element)
    if (isGone(element, style)) return
    if (element.localName === 'br') {
      run.text += ' '
      return
    }
    const parent = element.parentElement
    // A table's caption and a fieldset's legend are its name, already said on its line.
    if (
      (element.localName === 'caption' || element.localName === 'legend') &&
      parent !== null &&
      nameOf(parent, null, false) === cut(contentText(element), LONGEST_NAME)
    )
      return
    // A label's words are its control's name: the control says them.
    const quiet = suppress || (element.localName === 'label' && (element as HTMLLabelElement).control != null)
    walk.level += 1
    try {
      if (walk.level > DEEPEST) {
        walk.truncated = true
        return
      }
      const hidden = style.visibility === 'hidden' || style.visibility === 'collapse'
      const given = hidden ? null : roleOf(element, () => nameOf(element, null, false))
      const clickable = !hidden && !quiet && given === null && isClickable(element, style)
      const role = given ?? (clickable ? 'generic' : null)
      // A closed details shows its summary alone; a host shows the tree it holds, with what is slotted in.
      const childNodes =
        element.localName === 'details' && !(element as HTMLDetailsElement).open
          ? childNodesOf(element).filter((node) => isElement(node) && node.localName === 'summary')
          : childNodesOf(element)

      if (role === null) {
        if (!isBlock(style)) return visitChildren(childNodes, depth, walk, run, quiet, hidden)
        flush(walk, run, depth)
        const inner: Run = { text: '' }
        visitChildren(childNodes, depth, walk, inner, quiet, hidden)
        flush(walk, inner, depth)
        return
      }

      // Inside what is named by its words, a node that isn't something to press has said all it has in that name.
      if (quiet && !clickable && !INTERACTIVE.has(role)) return visitChildren(childNodes, depth, walk, run, true, hidden)

      flush(walk, run, depth)
      const interactive = clickable || INTERACTIVE.has(role)
      const label = nameOf(element, role, clickable)
      const flags = stateFlags(element, role, clickable && style.cursor === 'pointer')
      const ref = needsRef(role, label, interactive) ? refOf(element) : null
      const showName = label === '' ? '' : ` ${quote(label)}`
      const tail: Array<string> = []
      if (ref !== null) tail.push(`[ref=${ref}]`)
      let after = ''
      if (role === 'link') {
        const href = (element as HTMLAnchorElement).href
        if (typeof href === 'string' && href !== '') after += ` -> ${cut(href, LONGEST_HREF)}`
      }
      if (role === 'iframe') {
        const source = attribute(element, 'src')
        after += `${source === null || source === '' ? '' : ` -> ${cut(source, LONGEST_HREF)}`} (its contents aren’t read)`
      }
      const value = shownValue(element, role)
      if (value !== null && value !== '' && role !== 'img') after += ` value=${quote(cut(value, LONGEST_VALUE))}`
      const header = `- ${role === 'generic' ? 'clickable' : role}${showName}${[...flags, ...tail].map((part) => ` ${part}`).join('')}${after}`

      const start = walk.lines.length
      if (!emit(walk, depth, header)) return
      if (role === 'iframe' || role === 'img' || role === 'video' || role === 'audio' || role === 'canvas') return
      if (element.localName === 'select') return options(element, depth + 1, walk)
      if (FIELDS.has(role) && NATIVE_FIELDS.has(element.localName)) return
      const inner: Run = { text: '' }
      const byContent = clickable || NAMED_BY_CONTENT.has(role)
      visitChildren(childNodes, depth + 1, walk, inner, quiet || byContent)
      if (!byContent) flush(walk, inner, depth + 1)

      // A node whose only content is its words says them on its own line; one with nothing in it and nothing to say goes.
      const written = walk.lines.length - start - 1
      if (walk.truncated) return
      if (written === 1 && label === '' && !interactive && ref === null && flags.length === 0) {
        const child = walk.lines[start + 1] ?? ''
        const prefix = `${'  '.repeat(depth + 1)}- text `
        if (child.startsWith(prefix)) {
          walk.lines.length = start
          walk.nodes -= 2
          const said = child.slice(prefix.length).slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
          emit(walk, depth, `- ${role}: ${said}`)
        }
      } else if (written === 0 && label === '' && !interactive && flags.length === 0 && !STANDS_ALONE.has(role) && role !== 'generic') {
        walk.lines.length = start
        walk.nodes -= 1
      }
    } finally {
      walk.level -= 1
    }
  }

  const snapshot = (scope: Target | null, limit: number): Snapshot | Failed => {
    prune()
    const walk: Walk = { lines: [], nodes: 0, limit: Math.max(1, limit > 0 ? limit : LIMIT_NODES), truncated: false, level: 0 }
    const run: Run = { text: '' }
    if (scope === null) {
      const root = document.body ?? document.documentElement
      visitChildren([root], 0, walk, run, false)
    } else {
      const found = resolve(scope)
      if (failed(found)) return found
      if (isGone(found, css(found))) return { ok: false, why: `${nameTarget(scope)} is hidden, so there is nothing of it to read.` }
      visitChildren([found], 0, walk, run, false)
    }
    flush(walk, run, 0)
    return { ok: true, text: walk.lines.join('\n'), nodes: walk.nodes, truncated: walk.truncated }
  }

  /* ---------------------------------------------- finding and preparing */

  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight })

  const locate = (target: Target, scroll: boolean): Located => {
    const found = resolve(target)
    if (failed(found)) return found
    if (scroll && typeof found.scrollIntoView === 'function')
      found.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
    const rect = boxOf(found.getBoundingClientRect())
    if (rect.width < 1 || rect.height < 1)
      return {
        ok: false,
        why: `${nameTarget(target)} takes up no space on the page, so it can’t be pressed. It may be hidden: take a new snapshot.`,
      }
    const { width, height } = viewport()
    const left = Math.max(0, rect.x)
    const top = Math.max(0, rect.y)
    const right = Math.min(width, rect.x + rect.width)
    const bottom = Math.min(height, rect.y + rect.height)
    const inView = right > left && bottom > top
    const at = inView
      ? { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) }
      : {
          x: Math.max(0, Math.min(width - 1, Math.round(rect.x + rect.width / 2))),
          y: Math.max(0, Math.min(height - 1, Math.round(rect.y + rect.height / 2))),
        }
    const root = found.getRootNode() as Document | ShadowRoot
    const top1 = typeof root.elementFromPoint === 'function' ? root.elementFromPoint(at.x, at.y) : null
    const covering =
      top1 === null || top1.localName === 'althar-overlay' || within(found, top1) || within(top1, found) ? null : labelOf(top1)
    const role = roleOf(found, () => nameOf(found, null, false))
    const disabled = isDisabled(found)
    const readOnly = isTrue(found, 'aria-readonly') || (found as HTMLInputElement).readOnly === true
    return {
      ok: true,
      ref: refOf(found),
      role: role ?? 'generic',
      name: nameOf(found, role, false),
      rect,
      at,
      picked: describe(found, window),
      covered: covering,
      disabled,
      editable: isTextField(found) && !disabled && !readOnly,
      inView,
    } satisfies Found
  }

  const aField = (target: Target): Element | Failed => {
    const found = resolve(target)
    if (failed(found)) return found
    // A label stands for the control it names.
    if (found.localName === 'label' && (found as HTMLLabelElement).control !== null) return (found as HTMLLabelElement).control as Element
    return found
  }

  const focus = (target: Target): Done | Failed => {
    const found = aField(target)
    if (failed(found)) return found
    ;(found as HTMLElement).focus?.()
    const active = focusedElement()
    if (active === null || !(active === found || within(active, found) || within(found, active)) || active === document.body)
      return { ok: false, why: `${nameTarget(target)} can’t take the page’s focus. Click it instead.` }
    return { ok: true }
  }

  const selectAll = (target: Target): Done | Failed => {
    const found = aField(target)
    if (failed(found)) return found
    if (!isTextField(found)) return { ok: false, why: `${nameTarget(target)} isn’t a field that holds text.` }
    ;(found as HTMLElement).focus?.()
    if (found.localName === 'input' || found.localName === 'textarea') {
      const field = found as HTMLInputElement
      try {
        field.select()
      } catch {
        try {
          field.setSelectionRange(0, field.value.length)
        } catch {
          // A field with no selection to set (a date's) is replaced whole when its value is.
        }
      }
    } else {
      const selection = window.getSelection()
      selection?.selectAllChildren(found)
    }
    return { ok: true }
  }

  const valueOf = (target: Target): string | null => {
    const found = aField(target)
    if (failed(found)) return null
    if (found.localName === 'textarea') return (found as HTMLTextAreaElement).value
    if (found.localName === 'input') return TYPED.has(inputType(found)) ? (found as HTMLInputElement).value : null
    if (found.localName === 'select')
      return [...(found as HTMLSelectElement).selectedOptions].map((option) => squash(option.text)).join(', ')
    if (isTextField(found)) return (found as HTMLElement).innerText ?? found.textContent ?? ''
    return null
  }

  const tell = (field: Element, data: string | null) => {
    field.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
  }

  const fill = (target: Target, text: string, replace: boolean): Filled => {
    const found = aField(target)
    if (failed(found)) return found
    if (!isTextField(found) || isDisabled(found))
      return { ok: false, why: `${nameTarget(target)} isn’t a field that takes text${isDisabled(found) ? ': it is disabled' : ''}.` }
    if (found.localName === 'input' || found.localName === 'textarea') {
      const field = found as HTMLInputElement | HTMLTextAreaElement
      if (field.readOnly) return { ok: false, why: `${nameTarget(target)} is read-only.` }
      const prototype = found.localName === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
      const next = replace ? text : field.value + text
      if (descriptor?.set === undefined) field.value = next
      else descriptor.set.call(field, next)
      tell(field, text)
      return { ok: true, value: inputType(field) === 'password' ? '•'.repeat(field.value.length) : field.value }
    }
    const editable = found as HTMLElement
    editable.focus()
    if (replace) window.getSelection()?.selectAllChildren(editable)
    const inserted = typeof document.execCommand === 'function' && document.execCommand('insertText', false, text)
    if (!inserted) {
      if (replace) editable.textContent = text
      else editable.append(document.createTextNode(text))
      tell(editable, text)
    }
    return { ok: true, value: editable.innerText ?? editable.textContent ?? '' }
  }

  const select = (target: Target, values: ReadonlyArray<string>): Chosen => {
    const given = resolve(target)
    if (failed(given)) return given
    const list = given.localName === 'option' ? given.closest('select') : given
    if (list === null || list.localName !== 'select')
      return {
        ok: false,
        why: `${nameTarget(target)} isn’t a select list. If it is a menu the page draws, click it, then click its option.`,
      }
    const field = list as HTMLSelectElement
    if (isDisabled(field)) return { ok: false, why: `${nameTarget(target)} is disabled.` }
    if (!field.multiple && values.length > 1)
      return { ok: false, why: `${nameTarget(target)} takes one option; ${values.length} were given.` }
    const all = [...field.options]
    const labelOf1 = (option: HTMLOptionElement) => squash(option.label || option.text)
    const wanted: Array<HTMLOptionElement> = []
    for (const value of values) {
      const asked = squash(value)
      const lower = asked.toLowerCase()
      const found =
        all.find((option) => labelOf1(option) === asked) ??
        all.find((option) => option.value === value) ??
        all.find((option) => labelOf1(option).toLowerCase() === lower)
      if (found === undefined)
        return {
          ok: false,
          why: `${nameTarget(target)} has no option "${asked}". Its options: ${all.map((option) => `"${labelOf1(option)}"`).join(', ')}.`,
        }
      if (found.disabled) return { ok: false, why: `The option "${labelOf1(found)}" is disabled.` }
      wanted.push(found)
    }
    for (const option of all) option.selected = wanted.includes(option)
    field.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok: true, chosen: wanted.map(labelOf1) }
  }

  /* ---------------------------------------------- scrolling, looking, measuring */

  const scrollable = (element: Element): boolean => {
    const overflow = css(element).overflowY
    return (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') && element.scrollHeight > element.clientHeight
  }

  const scroll = (target: Target | null, to: 'top' | 'bottom' | 'up' | 'down' | null, by: number | null): Scrolled => {
    let scroller: Element | null = null
    if (target !== null) {
      const found = resolve(target)
      if (failed(found)) return found
      if (to === null && by === null) {
        if (typeof found.scrollIntoView === 'function') found.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
      } else {
        for (let at: Element | null = found; at !== null && scroller === null; at = at.parentElement) if (scrollable(at)) scroller = at
      }
    }
    const roomy = scroller ?? document.scrollingElement ?? document.documentElement
    const frame = scroller === null ? viewport().height : scroller.clientHeight
    const now = () => (scroller === null ? window.scrollY : scroller.scrollTop)
    const total = () =>
      scroller === null ? Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0) : scroller.scrollHeight
    if (to !== null || by !== null) {
      const step = by !== null && Number.isFinite(by) ? Math.abs(by) : Math.round(frame * PAGE_STEP)
      const top =
        to === 'top'
          ? 0
          : to === 'bottom'
            ? Math.max(0, total() - frame)
            : to === 'up'
              ? now() - step
              : to === 'down'
                ? now() + step
                : now() + (by ?? 0)
      const next = Math.max(0, Math.min(Math.max(0, total() - frame), top))
      if (scroller === null && typeof window.scrollTo === 'function') window.scrollTo({ top: next, behavior: 'instant' })
      else roomy.scrollTop = next
    }
    const y = Math.round(now())
    return {
      ok: true,
      x: Math.round(scroller === null ? window.scrollX : scroller.scrollLeft),
      y,
      atStart: y <= 0,
      atEnd: y + frame >= total() - 1,
    }
  }

  const has = (query: Query): boolean => {
    if (query.text === undefined && query.selector === undefined && query.ref === undefined) return false
    if (query.text !== undefined) {
      const wanted = squash(query.text).toLowerCase()
      if (
        wanted === '' ||
        !contentText(document.body ?? document.documentElement, false, Number.POSITIVE_INFINITY)
          .toLowerCase()
          .includes(wanted)
      )
        return false
    }
    const shows = (found: Element | Failed) => !failed(found) && !isGone(found, css(found)) && css(found).visibility !== 'hidden'
    if (query.selector !== undefined && !shows(resolve({ selector: query.selector }))) return false
    if (query.ref !== undefined && !shows(resolve({ ref: query.ref }))) return false
    return true
  }

  const describing = (target: Target): Described => {
    const found = resolve(target)
    return failed(found) ? found : { ok: true, picked: describe(found, window) }
  }

  const layout = (): Layout => {
    const html = document.documentElement
    const body = document.body
    return {
      width: Math.round(window.innerWidth),
      height: Math.round(window.innerHeight),
      scrollX: Math.round(window.scrollX),
      scrollY: Math.round(window.scrollY),
      contentWidth: Math.round(Math.max(html.scrollWidth, body?.scrollWidth ?? 0)),
      contentHeight: Math.round(Math.max(html.scrollHeight, body?.scrollHeight ?? 0)),
    }
  }

  return {
    snapshot,
    locate,
    focus,
    selectAll,
    fill,
    valueOf,
    select,
    scroll,
    has,
    describe: describing,
    input: counted,
    layout,
    mark: (rect) => hooks.mark(rect),
    unmark: () => hooks.unmark(),
  }
}
