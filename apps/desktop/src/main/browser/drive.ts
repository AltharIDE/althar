import type { PageTarget } from '@althar/runtime/pageBridge'

import type { Refusal, SignInService } from './addresses'
import { deviceOf, type Viewport } from './devices'
import type { Chosen, Described, Filled, Found, Layout, Located, Scrolled, Snapshot } from './driving'
import { elementLine, selectorLine } from './elementWords'
import type { PageLine } from './page'
import { type Box, pickedOf } from './picked'

/*
 * The parts of an agent driving a page beside its conversation that need no
 * Electron (ADR-100): keys as the page's input pipeline takes them, the log
 * of what the page said and what failed, how the person's own input is told
 * from the lead's, what the in-page driver may answer (read as untrusted, as
 * anything from a page is), and every answer in words for the agent. pages.ts
 * hangs these on a page; nothing here reaches one.
 */

/** The isolated world an agent's script runs in: neither the page's (0), the overlay and driver's (7301), nor Electron's for a preload (999). */
export const WORLD_EVAL = 7_302

/** How long things take, in milliseconds; a test sets its own. */
export interface Pace {
  /** After an action, how long to wait for what it sets going (a navigation, a refusal) to show. */
  readonly settle: number
  /** The longest a page is waited for to load. */
  readonly load: number
  /** How long the page keeps saying the lead is at work after its last action. */
  readonly fade: number
  /** How often a wait looks again. */
  readonly poll: number
  /** The longest a script an agent runs is waited for. */
  readonly script: number
}

export const PACE: Pace = { settle: 150, load: 15_000, fade: 2_500, poll: 150, script: 30_000 }

/** The most elements one snapshot reads. */
export const SNAPSHOT_LIMIT = 1_500

/** The tallest a whole page is taken, in CSS pixels: a longer one is cut there. */
export const TALLEST = 16_000

/** The longest a script's answer is kept, in characters. */
export const LONGEST_ANSWER = 20_000

// ─── Keys ──────────────────────────────────────────────────────────────

/** Chrome DevTools Protocol's modifier bits. */
export const MODIFIER = { alt: 1, control: 2, meta: 4, shift: 8 } as const

export interface KeyStroke {
  readonly key: string
  readonly code: string
  readonly keyCode: number
  /** The character it types, or '' for a key that types none. */
  readonly text: string
  /** The modifier bit it is, or 0. */
  readonly modifier: number
  /** 1 for a left-hand modifier. */
  readonly location: number
}

const named = (key: string, code: string, keyCode: number, text = ''): KeyStroke => ({
  key,
  code,
  keyCode,
  text,
  modifier: 0,
  location: 0,
})

const NAMED: Readonly<Record<string, KeyStroke>> = {
  enter: named('Enter', 'Enter', 13, '\r'),
  return: named('Enter', 'Enter', 13, '\r'),
  tab: named('Tab', 'Tab', 9),
  escape: named('Escape', 'Escape', 27),
  esc: named('Escape', 'Escape', 27),
  backspace: named('Backspace', 'Backspace', 8),
  delete: named('Delete', 'Delete', 46),
  del: named('Delete', 'Delete', 46),
  insert: named('Insert', 'Insert', 45),
  space: named(' ', 'Space', 32, ' '),
  spacebar: named(' ', 'Space', 32, ' '),
  arrowleft: named('ArrowLeft', 'ArrowLeft', 37),
  left: named('ArrowLeft', 'ArrowLeft', 37),
  arrowup: named('ArrowUp', 'ArrowUp', 38),
  up: named('ArrowUp', 'ArrowUp', 38),
  arrowright: named('ArrowRight', 'ArrowRight', 39),
  right: named('ArrowRight', 'ArrowRight', 39),
  arrowdown: named('ArrowDown', 'ArrowDown', 40),
  down: named('ArrowDown', 'ArrowDown', 40),
  home: named('Home', 'Home', 36),
  end: named('End', 'End', 35),
  pageup: named('PageUp', 'PageUp', 33),
  pagedown: named('PageDown', 'PageDown', 34),
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i + 1}`, named(`F${i + 1}`, `F${i + 1}`, 112 + i)])),
}

const modifierKey = (key: string, code: string, keyCode: number, modifier: number): KeyStroke => ({
  key,
  code,
  keyCode,
  text: '',
  modifier,
  location: 1,
})

const MODIFIERS: Readonly<Record<string, KeyStroke | 'controlormeta'>> = {
  control: modifierKey('Control', 'ControlLeft', 17, MODIFIER.control),
  ctrl: modifierKey('Control', 'ControlLeft', 17, MODIFIER.control),
  shift: modifierKey('Shift', 'ShiftLeft', 16, MODIFIER.shift),
  alt: modifierKey('Alt', 'AltLeft', 18, MODIFIER.alt),
  option: modifierKey('Alt', 'AltLeft', 18, MODIFIER.alt),
  meta: modifierKey('Meta', 'MetaLeft', 91, MODIFIER.meta),
  cmd: modifierKey('Meta', 'MetaLeft', 91, MODIFIER.meta),
  command: modifierKey('Meta', 'MetaLeft', 91, MODIFIER.meta),
  super: modifierKey('Meta', 'MetaLeft', 91, MODIFIER.meta),
  controlormeta: 'controlormeta',
  commandorcontrol: 'controlormeta',
  cmdorctrl: 'controlormeta',
}

/** US layout's punctuation: the code and the key code the page reads. */
const PUNCTUATION: Readonly<Record<string, readonly [string, number]>> = {
  '-': ['Minus', 189],
  '=': ['Equal', 187],
  '[': ['BracketLeft', 219],
  ']': ['BracketRight', 221],
  '\\': ['Backslash', 220],
  ';': ['Semicolon', 186],
  "'": ['Quote', 222],
  ',': ['Comma', 188],
  '.': ['Period', 190],
  '/': ['Slash', 191],
  '`': ['Backquote', 192],
}

/** A character's key: shifted when Shift is in the chord, as written when it stands alone, lower case in a shortcut (`Control+A` presses `a`). */
const characterStroke = (char: string, shift: boolean, chorded: boolean): KeyStroke => {
  const letter = /^[a-zA-Z]$/.test(char)
  const key = letter ? (shift ? char.toUpperCase() : chorded ? char.toLowerCase() : char) : char
  if (/^[a-zA-Z]$/.test(char))
    return { key, code: `Key${char.toUpperCase()}`, keyCode: char.toUpperCase().charCodeAt(0), text: key, modifier: 0, location: 0 }
  if (/^[0-9]$/.test(char)) return { key, code: `Digit${char}`, keyCode: char.charCodeAt(0), text: key, modifier: 0, location: 0 }
  const punctuation = PUNCTUATION[char]
  if (punctuation !== undefined) return { key, code: punctuation[0], keyCode: punctuation[1], text: key, modifier: 0, location: 0 }
  return { key, code: '', keyCode: 0, text: key, modifier: 0, location: 0 }
}

export type Chord = { readonly ok: true; readonly strokes: ReadonlyArray<KeyStroke> } | { readonly ok: false; readonly why: string }

const unknownKey = (key: string): Chord => ({
  ok: false,
  why: `“${key.slice(0, 40)}” isn’t a key I know. Use a name such as Enter, Tab, Escape, ArrowDown, PageDown or F5, a single character, or a chord such as Control+A (ControlOrMeta for the system’s own shortcut key).`,
})

/** A key or a chord (`Enter`, `Shift+Tab`, `ControlOrMeta+K`, `Control++`) as the keys pressed in order, modifiers first. */
export const chordOf = (key: string, mac: boolean): Chord => {
  const text = key.trim()
  if (text === '' || text.length > 64) return unknownKey(key)
  let head = ''
  let main = text
  if (text.endsWith('+') && text.length > 1) {
    main = '+'
    head = text.slice(0, -1)
    if (head.endsWith('+')) head = head.slice(0, -1)
  } else if (text.includes('+') && text !== '+') {
    const at = text.lastIndexOf('+')
    head = text.slice(0, at)
    main = text.slice(at + 1)
  }
  const strokes: Array<KeyStroke> = []
  let shift = false
  for (const part of head === '' ? [] : head.split('+')) {
    const modifier = MODIFIERS[part.trim().toLowerCase()]
    if (modifier === undefined) return unknownKey(key)
    const stroke = modifier === 'controlormeta' ? (MODIFIERS[mac ? 'meta' : 'control'] as KeyStroke) : modifier
    if (stroke.modifier === MODIFIER.shift) shift = true
    if (strokes.some((one) => one.modifier === stroke.modifier)) return unknownKey(key)
    strokes.push(stroke)
  }
  const lower = main.toLowerCase()
  const modifier = MODIFIERS[lower]
  if (modifier !== undefined) {
    const stroke = modifier === 'controlormeta' ? (MODIFIERS[mac ? 'meta' : 'control'] as KeyStroke) : modifier
    if (strokes.some((one) => one.modifier === stroke.modifier)) return unknownKey(key)
    return { ok: true, strokes: [...strokes, stroke] }
  }
  const stroke = NAMED[lower] ?? (Array.from(main).length === 1 ? characterStroke(main, shift, head !== '') : undefined)
  if (stroke === undefined) return unknownKey(key)
  return { ok: true, strokes: [...strokes, stroke] }
}

/** What a Mac does for an editing shortcut, which its keyboard layer says to the page and a synthesized key doesn't. */
const MAC_COMMANDS: Readonly<Record<string, string>> = {
  a: 'selectAll',
  c: 'copy',
  v: 'paste',
  x: 'cut',
  z: 'undo',
  y: 'redo',
}

/** The DevTools Protocol's key events for a chord: each key down in order, then each up in reverse. */
export const keyEvents = (strokes: ReadonlyArray<KeyStroke>, mac: boolean): ReadonlyArray<Readonly<Record<string, unknown>>> => {
  const events: Array<Record<string, unknown>> = []
  let held = 0
  for (const stroke of strokes) {
    held |= stroke.modifier
    const types = stroke.modifier === 0 && (held & (MODIFIER.alt | MODIFIER.control | MODIFIER.meta)) === 0 && stroke.text !== ''
    const command =
      mac && stroke.modifier === 0 && (held & MODIFIER.meta) !== 0 && (held & MODIFIER.control) === 0
        ? MAC_COMMANDS[stroke.key.toLowerCase()]
        : undefined
    events.push({
      type: types ? 'keyDown' : 'rawKeyDown',
      modifiers: held,
      key: stroke.key,
      code: stroke.code,
      windowsVirtualKeyCode: stroke.keyCode,
      nativeVirtualKeyCode: stroke.keyCode,
      ...(types ? { text: stroke.text, unmodifiedText: stroke.text } : {}),
      ...(stroke.location === 0 ? {} : { location: stroke.location }),
      ...(command === undefined ? {} : { commands: [command] }),
    })
  }
  for (const stroke of [...strokes].reverse()) {
    events.push({
      type: 'keyUp',
      modifiers: held,
      key: stroke.key,
      code: stroke.code,
      windowsVirtualKeyCode: stroke.keyCode,
      nativeVirtualKeyCode: stroke.keyCode,
      ...(stroke.location === 0 ? {} : { location: stroke.location }),
    })
    held &= ~stroke.modifier
  }
  return events
}

/** How many `keydown` events the page sees from a chord: one for each key in it. */
export const keydowns = (strokes: ReadonlyArray<KeyStroke>): number => strokes.length

// ─── The person's input wins ───────────────────────────────────────────

/**
 * Where the lead stands against the page's count of presses, keys and wheel
 * turns from a real device: what it injected and expected to be counted, and
 * where the count began. More than that is the person.
 */
export interface Hand {
  baseline: number
  injected: number
}

/** Whether the person used the page since the hand began, given the count now; a count that went down is a new document, and starts over. */
export const personUsed = (hand: Hand, now: number | null): boolean => {
  if (now === null) return false
  if (now < hand.baseline) {
    hand.baseline = now
    hand.injected = 0
    return false
  }
  return now > hand.baseline + hand.injected
}

// ─── What the page said, and what failed ───────────────────────────────

export type LogKind = 'console' | 'network'
export type LogLevel = 'error' | 'warning' | 'info' | 'debug'

export interface LogEntry {
  /** Counts up from 1 for the page's life, across its navigations. */
  readonly n: number
  readonly kind: LogKind
  readonly level: LogLevel
  readonly text: string
}

export interface Logs {
  /** Keeps one more; the oldest past the capacity goes. Returns its number. */
  readonly add: (kind: LogKind, level: string, text: string) => number
  /** The number of the last entry, or 0 before any. */
  readonly mark: () => number
  /** The entries kept. */
  readonly all: () => ReadonlyArray<LogEntry>
}

const LONGEST_ENTRY = 400
const LEVELS: ReadonlyArray<LogLevel> = ['error', 'warning', 'info', 'debug']

const levelOf = (level: string): LogLevel => {
  if (level === 'warn') return 'warning'
  return (LEVELS as ReadonlyArray<string>).includes(level) ? (level as LogLevel) : 'info'
}

const oneLine = (text: string): string => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > LONGEST_ENTRY ? `${line.slice(0, LONGEST_ENTRY - 1)}…` : line
}

/** A page's log; `from` carries on the count of a page that went to sleep, so a mark an agent holds still reads on. */
export const logsOf = (capacity = 500, from = 0): Logs => {
  let entries: Array<LogEntry> = []
  let last = from
  return {
    add: (kind, level, text) => {
      last += 1
      entries.push({ n: last, kind, level: levelOf(level), text: oneLine(text) })
      if (entries.length > capacity) entries = entries.slice(entries.length - capacity)
      return last
    },
    mark: () => last,
    all: () => entries,
  }
}

/** What a read of the log found: the entries after a point, at most `max`, and where to read from next. */
export interface LogRead {
  readonly entries: ReadonlyArray<LogEntry>
  readonly next: number
  /** How many more there are after these. */
  readonly more: number
  /** Whether entries after the point were dropped as the log filled. */
  readonly lost: boolean
}

export const readLogs = (logs: Logs, since: number, kind: 'all' | 'console' | 'network', max = 100): LogRead => {
  const all = logs.all()
  const after = all.filter((entry) => entry.n > since && (kind === 'all' || entry.kind === kind))
  const shown = after.slice(0, max)
  const lost = all.length > 0 && (all[0]?.n ?? 1) > since + 1
  const last = shown.at(-1)
  return {
    entries: shown,
    // Past what was shown, the next read goes on from the last one shown; with nothing shown, from the end.
    next: after.length > max && last !== undefined ? last.n : logs.mark(),
    more: Math.max(0, after.length - shown.length),
    lost,
  }
}

const LEVEL_WORD: Readonly<Record<LogLevel, string>> = { error: 'error', warning: 'warn ', info: 'info ', debug: 'debug' }

export const logWords = (read: LogRead, since: number, kind: 'all' | 'console' | 'network'): string => {
  const what = kind === 'all' ? 'Console messages and failed requests' : kind === 'console' ? 'Console messages' : 'Failed requests'
  if (read.entries.length === 0) return `${what}: nothing new since ${since}. Log mark: ${read.next}.`
  return [
    `${what} since ${since} (${read.entries.length}${read.more > 0 ? ` of ${read.entries.length + read.more}` : ''}):`,
    ...(read.lost ? ['(Older entries were dropped as the log filled.)'] : []),
    ...read.entries.map(
      (entry) => `[${entry.n}] ${entry.kind === 'network' ? 'network' : 'console'} ${LEVEL_WORD[entry.level]} ${entry.text}`,
    ),
    read.more > 0 ? `Read on from ${read.next} for the other ${read.more}. Log mark: ${read.next}.` : `Log mark: ${read.next}.`,
  ].join('\n')
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** One line saying what went wrong in the page after a point, or '' where nothing did: the lead then reads it with page_logs. */
export const troubleSince = (logs: Logs, since: number): string => {
  let errors = 0
  let warnings = 0
  let failures = 0
  for (const entry of logs.all()) {
    if (entry.n <= since) continue
    if (entry.kind === 'network') failures += 1
    else if (entry.level === 'error') errors += 1
    else if (entry.level === 'warning') warnings += 1
  }
  const parts = [
    ...(errors > 0 ? [count(errors, 'console error')] : []),
    ...(warnings > 0 ? [count(warnings, 'console warning')] : []),
    ...(failures > 0 ? [count(failures, 'failed request')] : []),
  ]
  return parts.length === 0
    ? ''
    : `Meanwhile: ${parts.join(', ')}. page_logs with since ${since} reads ${errors + warnings + failures === 1 ? 'it' : 'them'}.`
}

// ─── What the in-page driver may answer ────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const textIn = (value: unknown, longest: number): string | null =>
  typeof value === 'string' && value.length <= longest && !value.includes('\u0000') ? value : null

const SIDE = 100_000
const numberIn = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= -SIDE * 10 && value <= SIDE * 10 ? value : null

const boxIn = (value: unknown): Box | null => {
  if (!isRecord(value)) return null
  const x = numberIn(value.x)
  const y = numberIn(value.y)
  const width = numberIn(value.width)
  const height = numberIn(value.height)
  return x === null || y === null || width === null || height === null ? null : { x, y, width, height }
}

const REF = /^e\d{1,9}$/

const whyOf = (value: Record<string, unknown>): string | null => textIn(value.why, 500)

/** The driver's answer to `locate`, where every part is what it should be; null for anything else. */
export const locatedOf = (value: unknown): Located | null => {
  if (!isRecord(value)) return null
  if (value.ok === false) {
    const why = whyOf(value)
    return why === null ? null : { ok: false, why }
  }
  if (value.ok !== true) return null
  const ref = textIn(value.ref, 12)
  const role = textIn(value.role, 60)
  const name = textIn(value.name, 300)
  const rect = boxIn(value.rect)
  const at = isRecord(value.at) ? { x: numberIn(value.at.x), y: numberIn(value.at.y) } : { x: null, y: null }
  const picked = pickedOf(value.picked)
  const covered = value.covered === null ? null : textIn(value.covered, 120)
  if (
    ref === null ||
    !REF.test(ref) ||
    role === null ||
    name === null ||
    rect === null ||
    at.x === null ||
    at.y === null ||
    picked === null ||
    (value.covered !== null && covered === null) ||
    typeof value.disabled !== 'boolean' ||
    typeof value.editable !== 'boolean' ||
    typeof value.inView !== 'boolean'
  )
    return null
  return {
    ok: true,
    ref,
    role,
    name,
    rect,
    at: { x: at.x, y: at.y },
    picked,
    covered,
    disabled: value.disabled,
    editable: value.editable,
    inView: value.inView,
  }
}

const LONGEST_SNAPSHOT = 200_000

export const snapshotOf = (value: unknown): Snapshot | { readonly ok: false; readonly why: string } | null => {
  if (!isRecord(value)) return null
  if (value.ok === false) {
    const why = whyOf(value)
    return why === null ? null : { ok: false, why }
  }
  const text = textIn(value.text, LONGEST_SNAPSHOT)
  const nodes = numberIn(value.nodes)
  if (value.ok !== true || text === null || nodes === null || typeof value.truncated !== 'boolean') return null
  return { ok: true, text, nodes, truncated: value.truncated }
}

export const layoutOf = (value: unknown): Layout | null => {
  if (!isRecord(value)) return null
  const width = numberIn(value.width)
  const height = numberIn(value.height)
  const scrollX = numberIn(value.scrollX)
  const scrollY = numberIn(value.scrollY)
  const contentWidth = numberIn(value.contentWidth)
  const contentHeight = numberIn(value.contentHeight)
  if (width === null || height === null || scrollX === null || scrollY === null || contentWidth === null || contentHeight === null)
    return null
  return { width, height, scrollX, scrollY, contentWidth, contentHeight }
}

export const scrolledOf = (value: unknown): Scrolled | null => {
  if (!isRecord(value)) return null
  if (value.ok === false) {
    const why = whyOf(value)
    return why === null ? null : { ok: false, why }
  }
  const x = numberIn(value.x)
  const y = numberIn(value.y)
  if (value.ok !== true || x === null || y === null || typeof value.atStart !== 'boolean' || typeof value.atEnd !== 'boolean') return null
  return { ok: true, x, y, atStart: value.atStart, atEnd: value.atEnd }
}

export const filledOf = (value: unknown): Filled | null => {
  if (!isRecord(value)) return null
  if (value.ok === false) {
    const why = whyOf(value)
    return why === null ? null : { ok: false, why }
  }
  const text = textIn(value.value, LONGEST_ANSWER)
  return value.ok === true && text !== null ? { ok: true, value: text } : null
}

export const chosenOf = (value: unknown): Chosen | null => {
  if (!isRecord(value)) return null
  if (value.ok === false) {
    const why = whyOf(value)
    return why === null ? null : { ok: false, why }
  }
  if (value.ok !== true || !Array.isArray(value.chosen) || value.chosen.length > 100) return null
  const chosen: Array<string> = []
  for (const one of value.chosen as ReadonlyArray<unknown>) {
    const text = textIn(one, 500)
    if (text === null) return null
    chosen.push(text)
  }
  return { ok: true, chosen }
}

export const describedOf = (value: unknown): Described | null => {
  if (!isRecord(value)) return null
  if (value.ok === false) {
    const why = whyOf(value)
    return why === null ? null : { ok: false, why }
  }
  const picked = pickedOf(value.picked)
  return value.ok === true && picked !== null ? { ok: true, picked } : null
}

/** The driver's plain yes or no, `{ ok: true }` or `{ ok: false, why }`. */
export const doneOf = (value: unknown): { readonly ok: true } | { readonly ok: false; readonly why: string } | null => {
  if (!isRecord(value)) return null
  if (value.ok === true) return { ok: true }
  const why = value.ok === false ? whyOf(value) : null
  return why === null ? null : { ok: false, why }
}

/** The count of real presses, keys and wheel turns; null where the page didn't answer with a count. */
export const inputOf = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null)

// ─── Pictures ──────────────────────────────────────────────────────────

/** A PNG's width and height from its header, or null for anything that isn't one. */
export const pngSize = (base64: string): { readonly width: number; readonly height: number } | null => {
  const head = Buffer.from(base64.slice(0, 48), 'base64')
  if (head.length < 24 || head.readUInt32BE(0) !== 0x89504e47 || head.readUInt32BE(12) !== 0x49484452) return null
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) }
}

// ─── Words ─────────────────────────────────────────────────────────────

/** Whose conversation a page is beside. */
export type Whose = 'task' | 'project'

export const beside = (whose: Whose): string => (whose === 'task' ? 'beside this task' : 'beside this project’s conversation')

/** A target as the agent gave it, for a sentence about it. */
export const targetWords = (target: PageTarget | null): string =>
  target === null ? 'the page' : target.ref !== undefined ? target.ref : `\`${target.selector ?? ''}\``

export const words = {
  noPage: 'That isn’t a page Althar can open.',
  quitting: 'Althar is quitting, so the page is going.',
  noWindow: (whose: Whose) =>
    `Althar has no window open, so there is no page ${beside(whose)} to read or drive. Open Althar’s window and ask again.`,
  nothingOpen: (whose: Whose) => `Nothing is open ${beside(whose)}. page_open opens it at an address.`,
  notReady: 'Althar’s pages aren’t ready yet.',
  /** An address that isn't a web address, typed in to open. */
  notAnAddress: 'That isn’t a web address. Give one such as http://localhost:5173/ or example.com.',
  /** The driver's answer couldn't be read. */
  unreadable: 'The page answered in a way Althar couldn’t read, so nothing was done. Take a new snapshot and try again.',
  couldNot: (why: string) => `The page couldn’t do that: ${why}`,
  yielded: (done: string) =>
    `The person clicked, typed or scrolled in the page while you acted on it, so the action stopped${done === '' ? '' : ` (${done})`}. Take a new snapshot to see where the page is now.`,
  /** A call that waited its turn behind one the person's input stopped. */
  yieldedQueued:
    'The person clicked, typed or scrolled in the page while this waited its turn, so it wasn’t done. Take a new snapshot to see where the page is now.',
  /** The person is pointing at the page to comment, and every press in it is theirs. */
  pointing:
    'The person is pointing at the page to comment on it, so Althar left the page alone. Try again once their comment is sent or closed.',
  /** What the runtime gave up on before its turn came: nobody hears this, but it is said all the same. */
  gaveUp: 'This was stopped before it was done: the call it came with was over.',
  staleRef: (ref: string) =>
    `${ref} is from a snapshot of the page as it was before it loaded again, so it may name something else now. Take a new snapshot and use its refs.`,
  noDialog: 'No dialog is open on the page now.',
  /** The page's beforeunload asked to stay, as an agent's action left it. */
  leftUnsaved: 'The page asked to stay, as a page does when something in it isn’t saved; it was left all the same.',
  /** A wait whose looks at the page went unanswered. */
  unanswered: 'the page didn’t answer when Althar looked',
  stillLoading: 'The page was still loading when this was read, so it may change.',
}

/** A dialog the page opened: an alert, a confirm or a prompt, which holds everything in the page until it is answered. */
export interface PageDialog {
  readonly type: 'alert' | 'confirm' | 'prompt'
  readonly message: string
  /** What a prompt offers to start with. */
  readonly defaultPrompt: string
}

const DIALOG_NAME: Readonly<Record<PageDialog['type'], string>> = { alert: 'an alert', confirm: 'a confirm dialog', prompt: 'a prompt' }
const LONGEST_DIALOG = 500

/** A dialog's type as the debugger says it, and what it says, cut where it is long; null for one this page never shows (a leave-page one). */
export const dialogOf = (params: unknown): PageDialog | null => {
  if (typeof params !== 'object' || params === null) return null
  const { type, message, defaultPrompt } = params as Record<string, unknown>
  if (type !== 'alert' && type !== 'confirm' && type !== 'prompt') return null
  const said = typeof message === 'string' ? message : ''
  return {
    type,
    message: said.length > LONGEST_DIALOG ? `${said.slice(0, LONGEST_DIALOG)}…` : said,
    defaultPrompt: typeof defaultPrompt === 'string' ? defaultPrompt.slice(0, LONGEST_DIALOG) : '',
  }
}

/** That the page shows a dialog, which nothing in it gets past until it is answered; `during` where the lead's own action opened it. */
export const dialogWords = (dialog: PageDialog, during = false): string => {
  const what = `${DIALOG_NAME[dialog.type]}${dialog.message === '' ? '' : ` saying “${dialog.message}”`}`
  const how =
    dialog.type === 'alert'
      ? 'page_dialog closes it'
      : dialog.type === 'confirm'
        ? 'page_dialog answers it, OK with accept or Cancel without'
        : 'page_dialog answers it, with text to give it, or cancels it'
  return `${during ? `As you acted, the page opened ${what}` : `The page shows ${what}`}, and nothing in it runs until it is answered: ${how}. The person can answer it too.`
}

/** What answering a dialog did, in words. */
export const answeredWords = (dialog: PageDialog, accept: boolean, text: string | null): string => {
  const about = dialog.message === '' ? '' : ` “${dialog.message}”`
  if (dialog.type === 'alert') return `Closed the alert${about}.`
  if (dialog.type === 'confirm') return `Answered ${accept ? 'OK' : 'Cancel'} to the confirm dialog${about}.`
  return accept ? `Answered the prompt${about} with “${text ?? dialog.defaultPrompt}”.` : `Cancelled the prompt${about}.`
}

/** Why an address or a move to one is refused, for the lead: `open` is the lead asking to go there, `action` is something its action would have caused. */
export const refusalWords = (refusal: Refusal, cause: 'open' | 'action', scheme = ''): string => {
  const stayed = 'so the page stayed where it was.'
  if (cause === 'open') {
    switch (refusal) {
      case 'file':
        return `Files on this computer don’t open here: only http and https web pages do, ${stayed}`
      case 'scheme':
        return `Only http and https web pages open here${scheme === '' ? '' : `, not ${scheme} addresses`}, ${stayed}`
      case 'address':
        return words.notAnAddress
    }
  }
  switch (refusal) {
    case 'file':
      return `That would have taken the page to a file on this computer. Only http and https web pages open here, ${stayed}`
    case 'scheme':
      return `That would have taken the page to something that isn’t a web page. Only http and https web pages open here, ${stayed}`
    case 'address':
      return `That would have taken the page to something that isn’t a web address, ${stayed}`
  }
}

export const signInWords = (service: SignInService, cause: 'open' | 'action'): string =>
  `${cause === 'open' ? 'That is' : 'That led to'} ${service}’s sign-in. Sign-ins to Claude, GitHub, GitLab and Linear happen in the person’s own browser, never in this page: Althar opened it there, and this page stayed where it was. Ask the person to sign in if you need it.`

/** What the page's guards did while an action ran, as a sentence; null for a line that is about the page and not the action. */
export const lineWords = (line: PageLine | null): string | null => {
  if (line === null) return null
  switch (line.kind) {
    case 'refused':
      return refusalWords(line.refusal, 'action')
    case 'sign-in':
      return signInWords(line.service, 'action')
    case 'asked':
      return `${line.host === '' ? 'The page' : line.host} asked for the ${line.asked}, which pages here never get.`
    case 'download':
      return `The page tried to download ${line.name === '' ? 'a file' : line.name}. Downloads are refused here${line.offered ? ', and offered to the person’s browser instead' : ''}.`
    case 'failed':
      return `${line.host === '' ? 'The page' : line.host} didn’t answer.`
    case 'gone':
      return 'The page’s process stopped. page_move with reload starts it again.'
  }
}

export const viewportWords = (viewport: Viewport): string => {
  const device = deviceOf(viewport)
  if (device === null) return 'fit (the panel’s own size)'
  return `${viewport} (${device.width}×${device.height}${device.mobile ? ', a touch screen with a mobile browser’s agent' : ''})`
}

/** Where a page is, for the lead. */
export type Place = 'beside' | 'tab' | 'waiting' | 'asleep'

export const placeWords = (place: Place): string => {
  switch (place) {
    case 'beside':
      return 'beside the conversation, on screen'
    case 'tab':
      return 'in a tab of its own, on screen'
    case 'waiting':
      return 'open but not on screen now (another screen is in front); it shows when the conversation does'
    case 'asleep':
      return 'asleep; it wakes where it was when a tool needs it'
  }
}

export interface PageFacts {
  readonly whose: Whose
  readonly window: boolean
  readonly open: boolean
  readonly address: string
  readonly title: string
  readonly viewport: Viewport
  readonly place: Place
  readonly loading: boolean
  readonly back: boolean
  readonly forward: boolean
  readonly line: PageLine | null
  readonly mark: number
  /** A dialog the page shows now, which holds it until answered. */
  readonly dialog: PageDialog | null
}

export const shown = (address: string, title: string) =>
  `${address === '' ? 'a blank page' : address}${title === '' ? '' : ` (“${title}”)`}`

/** What is open beside a conversation: for page_state. */
export const stateWords = (facts: PageFacts): string => {
  const window = facts.window ? [] : ['Althar’s window: not open, so the other page tools wait until it is.']
  if (!facts.open) return [words.nothingOpen(facts.whose), ...window].join('\n')
  const history = [facts.back ? 'back is possible' : null, facts.forward ? 'forward is possible' : null].filter((one) => one !== null)
  const says = lineWords(facts.line)
  return [
    `Page ${beside(facts.whose)}: ${shown(facts.address, facts.title)}`,
    `Shown: ${placeWords(facts.place)}`,
    `Viewport: ${viewportWords(facts.viewport)}`,
    ...(facts.place === 'asleep'
      ? []
      : [`${facts.loading ? 'Loading now. ' : ''}History: ${history.length === 0 ? 'none' : history.join(', ')}`]),
    ...(says === null ? [] : [`The page says: ${says}`]),
    ...(facts.dialog === null ? [] : [dialogWords(facts.dialog)]),
    ...window,
    `Log mark: ${facts.mark}`,
  ].join('\n')
}

/** What a read of a page starts with: where it is. */
export const pageHeader = (address: string, title: string, viewport: Viewport): string =>
  `Page: ${shown(address, title)}${viewport === 'fit' ? '' : ` · viewport ${viewportWords(viewport)}`}`

export const snapshotWords = (header: string, snapshot: Snapshot, scope: PageTarget | null): string =>
  [
    header,
    ...(scope === null ? [] : [`Scope: ${targetWords(scope)}`]),
    snapshot.text,
    ...(snapshot.truncated ? [`(Stopped at ${snapshot.nodes} elements. Pass ref or selector to read one part of the page.)`] : []),
  ].join('\n')

/** The name of an element as the lead reads it: `button “Save”`. */
export const named_ = (found: Pick<Found, 'role' | 'name'>): string => (found.name === '' ? found.role : `${found.role} “${found.name}”`)

/** An action's answer: what it did, to what, then the notes the page added. */
export const acted = (verb: string, found: Found | null, notes: ReadonlyArray<string>): string =>
  [
    found === null ? `${verb}.` : `${verb} ${named_(found)}.`,
    ...(found === null ? [] : [elementLine(found.picked), selectorLine(found.picked.selector)]),
    ...notes.filter((note) => note !== ''),
  ].join('\n')

/** That the page went somewhere, or didn't, after an action; '' where it stayed. */
export const movedWords = (before: string, after: { readonly address: string; readonly title: string }): string =>
  before === after.address ? '' : `The page is now at ${shown(after.address, after.title)}.`

export const coveredWords = (covered: string | null): string =>
  covered === null ? '' : `\`${covered}\` was over it, so the press went to that.`

export const scrolledWords = (scrolled: Extract<Scrolled, { ok: true }>, layout: Layout | null): string =>
  `Scrolled to ${Math.round(scrolled.x)}, ${Math.round(scrolled.y)}${scrolled.atEnd ? ' (the end)' : scrolled.atStart ? ' (the start)' : ''}${
    layout === null ? '' : ` of a ${layout.contentWidth}×${layout.contentHeight} page, seen through ${layout.width}×${layout.height}`
  }.`

/** A script's answer as text, cut where it is long. */
export const answerOf = (value: unknown): string => {
  if (value === undefined) return 'undefined'
  let text: string
  if (typeof value === 'string') text = value
  else {
    try {
      // What JSON can't say (a function, a symbol) is named by its kind.
      text = JSON.stringify(value, null, 2) ?? typeof value
    } catch {
      text = '(a value that can’t be shown as text)'
    }
  }
  return text.length > LONGEST_ANSWER ? `${text.slice(0, LONGEST_ANSWER)}\n… (cut at ${LONGEST_ANSWER} characters)` : text
}
