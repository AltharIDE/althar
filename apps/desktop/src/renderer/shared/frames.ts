/*
 * What made the page slow, for main's log (docs/decisions/foundations.md,
 * The UI is instant): a frame that took 100 ms or more to draw, as Chromium's
 * long animation frames see it (long tasks where it has none), and a press
 * whose next frame came that late, as its event timing says, much as INP
 * counts it. Each says how long, and what it was on by its test id or its
 * role and its kind of element, and a frame its longest script by its file's
 * name and function: never what the page shows, or anything a person wrote.
 * They go a few at a time, every few seconds at most, in a packaged build as
 * in development, and stay in the logs on this computer.
 */

/** A frame or a press that took long, as main's log keeps it. */
export interface SlowFrame {
  readonly kind: 'frame' | 'task' | 'press'
  /** How long it took, in milliseconds: a frame's or a task's own, a press's until its next frame. */
  readonly ms: number
  /** How much of a frame held input back, where Chromium says. */
  readonly blockingMs?: number
  /** A press's event: click, keydown, pointerdown. */
  readonly event?: string
  /** What a press was on: its test id, or its role and its kind of element. */
  readonly on?: string
  /** A frame's longest script: what started it, and its file's name and function. */
  readonly script?: string
}

/** What goes to main at once: a few of them, and how many more there were. */
export interface SlowFrames {
  readonly frames: ReadonlyArray<SlowFrame>
  readonly more: number
}

/** How long a frame or a press may take before it is said. */
export const SLOW_MS = 100

/** How often what was seen goes to main, at most. */
export const SENT_EVERY = 5_000

/** The most that go at once; the rest are counted. */
export const MOST = 20

/** An entry as the observer gives it: the fields of each kind read here, all of them optional. */
interface Entry {
  readonly entryType: string
  readonly name: string
  readonly duration: number
  readonly blockingDuration?: number
  readonly interactionId?: number
  readonly target?: unknown
  readonly scripts?: ReadonlyArray<{
    readonly duration: number
    readonly invoker?: string
    readonly sourceURL?: string
    readonly sourceFunctionName?: string
  }>
}

/** Watches one kind of entry, calling `seen` with each list of them, until the returned function is called; null where there is none. */
export type Observe = (type: string, options: Record<string, unknown>, seen: (entries: ReadonlyArray<Entry>) => void) => (() => void) | null

/** The page's own PerformanceObserver, where it observes `type`. */
const observeHere: Observe = (type, options, seen) => {
  const Observer = globalThis.PerformanceObserver
  if (Observer === undefined || !Observer.supportedEntryTypes.includes(type)) return null
  const observer = new Observer((list) => seen(list.getEntries() as unknown as ReadonlyArray<Entry>))
  observer.observe({ type, buffered: true, ...options })
  return () => observer.disconnect()
}

/** The role an element has without saying it, for those a press is on. */
const IMPLIED: Readonly<Record<string, string>> = {
  a: 'link',
  button: 'button',
  input: 'textbox',
  select: 'combobox',
  summary: 'button',
  textarea: 'textbox',
}

/** Kept to letters, digits and a few marks, and cut short: nothing else can reach the log. */
const plain = (text: string, most = 60) => text.replace(/[^\w.:#$<>-]/g, '').slice(0, most)

/** What a press was on: its test id, else its role, and its kind of element from its first class, without the class's hash. */
export const targetOf = (target: unknown): string | undefined => {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return undefined
  const tested = target.closest('[data-testid]')?.getAttribute('data-testid')
  if (tested !== null && tested !== undefined && tested !== '') return `testid:${plain(tested)}`
  const tag = target.tagName.toLowerCase()
  const role = target.getAttribute('role') ?? IMPLIED[tag] ?? tag
  const [kind] = target.classList
  return kind === undefined ? plain(role) : `${plain(role, 30)}.${plain(kind.replace(/_[\w-]{4,5}$/, ''), 40)}`
}

/** A frame's longest script: what started it, and its file's name and function, never the path it is at. */
const scriptOf = (scripts: Entry['scripts']) => {
  const [longest] = [...(scripts ?? [])].toSorted((a, b) => b.duration - a.duration)
  if (longest === undefined) return undefined
  const file = (longest.sourceURL ?? '').split(/[/\\]/).at(-1)?.split(/[?#]/)[0] ?? ''
  return plain([longest.invoker ?? '', file, longest.sourceFunctionName ?? ''].filter(Boolean).join(':'), 120) || undefined
}

/** What one entry says, where it took long enough to; nothing for one that didn't, or a press that was no interaction. */
export const slowOf = (entry: Entry): SlowFrame | undefined => {
  const ms = Math.round(entry.duration)
  if (ms < SLOW_MS) return undefined
  if (entry.entryType === 'long-animation-frame') {
    const script = scriptOf(entry.scripts)
    return {
      kind: 'frame',
      ms,
      ...(entry.blockingDuration === undefined ? {} : { blockingMs: Math.round(entry.blockingDuration) }),
      ...(script === undefined ? {} : { script }),
    }
  }
  if (entry.entryType === 'longtask') return { kind: 'task', ms }
  if (entry.entryType === 'event' && (entry.interactionId ?? 0) > 0) {
    const on = targetOf(entry.target)
    return { kind: 'press', ms, event: plain(entry.name, 30), ...(on === undefined ? {} : { on }) }
  }
  return undefined
}

export interface FramesOptions {
  readonly observe?: Observe
  /** Calls `send` after `ms`, until the returned function is called: the page's own timer unless a test says. */
  readonly later?: (send: () => void, ms: number) => () => void
}

const laterHere = (send: () => void, ms: number) => {
  const timer = setTimeout(send, ms)
  return () => clearTimeout(timer)
}

/** Watches the page's frames and presses, sending what took long to main's log, until the returned function is called. */
export const watchFrames = (
  host: { readonly logFrames?: (frames: SlowFrames) => void },
  { observe = observeHere, later = laterHere }: FramesOptions = {},
): (() => void) => {
  const send = host.logFrames
  if (send === undefined) return () => undefined
  let seen: Array<SlowFrame> = []
  let more = 0
  let waiting: (() => void) | undefined
  const out = () => {
    waiting = undefined
    if (seen.length === 0) return
    send({ frames: seen, more })
    seen = []
    more = 0
  }
  const took = (entries: ReadonlyArray<Entry>) => {
    for (const entry of entries) {
      const slow = slowOf(entry)
      if (slow === undefined) continue
      if (seen.length < MOST) seen.push(slow)
      else more += 1
    }
    if (seen.length > 0) waiting ??= later(out, SENT_EVERY)
  }
  // Long animation frames where Chromium has them, which say which script held the frame; long tasks where it hasn't.
  const frames = observe('long-animation-frame', {}, took) ?? observe('longtask', {}, took)
  // A press's time until its next frame: Chromium says only those over the threshold, from 16 ms up.
  const presses = observe('event', { durationThreshold: SLOW_MS }, took)
  return () => {
    frames?.()
    presses?.()
    waiting?.()
    out()
  }
}
