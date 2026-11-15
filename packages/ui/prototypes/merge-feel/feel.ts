import { useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'

import { reducedMotion } from '@althar/ui'

import { OUT } from './fx'

/*
 * A merge as the page plays it: pressed, it says Merging at once; the host
 * takes it into its queue a moment later; it lands a while after, on its
 * own or when L is pressed. Each place that offers Merge (the thread's
 * card, Outputs, a board card) registers its element here; the direction
 * picked plays its feel over it at each of the three moments.
 */

export type Stage = 'ready' | 'merging' | 'queued' | 'merged'
export type Place = 'thread' | 'outputs' | 'board'

/** From the press to the host saying it's in its queue. */
const ACK = 520
/** From the queue to landing, when it lands on its own. */
const QUEUE = 2600
/** Landings closer than this after another are quiet: one celebrates, the rest settle. */
const CALM = 3000

export interface Item {
  id: string
  place: Place
  root: HTMLElement
  hold: HTMLElement
  layer: HTMLElement
}

/** What a direction keeps between the moments of one merge: its cover, its line. */
export type Bag = Record<string, unknown>

export interface Fx {
  item: Item
  bag: Bag
  reduce: boolean
  /** The Merge button, as it is now. */
  button: () => HTMLElement | null
  /** Where the merge stands, in its place: the Merge stop's knot, the words beside its pull request, a board card's word. */
  target: () => HTMLElement | null
  /** The thread card's stops, in order. */
  stops: () => HTMLElement[]
}

export interface Direction {
  key: string
  letter: string
  name: string
  idea: string
  press: string
  queue: string
  land: string
  /** Keeps the card's height from the press until it lands, so nothing moves under the pointer. */
  hold: boolean
  onPress?: (fx: Fx) => void
  /** Just before the host takes it into its queue, while the button is still there. */
  beforeQueue?: (fx: Fx) => void
  onQueue?: (fx: Fx) => void
  /** `loud`: the first to land after a quiet spell; the rest of a crowd land quietly. */
  onLand?: (fx: Fx, loud: boolean) => void
  /** How everything lands quietly, in this direction. */
  onQuiet?: (fx: Fx) => void
}

interface Settings {
  dir: Direction | null
  forceReduce: boolean
  auto: boolean
}
const settings: Settings = { dir: null, forceReduce: false, auto: true }
export const configure = (next: Partial<Settings>) => Object.assign(settings, next)
const reduce = () => settings.forceReduce || reducedMotion()

const items = new Map<string, Item>()
const bags = new Map<string, Bag>()
const timers = new Map<string, number[]>()
const batched = new Set<string>()
let stages: Readonly<Record<string, Stage>> = {}
let lastLanding = Number.NEGATIVE_INFINITY

const listeners = new Set<() => void>()
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
export const useStage = (id: string): Stage => useSyncExternalStore(subscribe, () => stages[id] ?? 'ready')
export const stageOf = (id: string): Stage => stages[id] ?? 'ready'
const set = (changes: Record<string, Stage>) =>
  flushSync(() => {
    stages = { ...stages, ...changes }
    for (const l of listeners) l()
  })

export function register(item: Item) {
  items.set(item.id, item)
  return () => {
    items.delete(item.id)
  }
}

const later = (id: string, ms: number, run: () => void) => {
  const t = window.setTimeout(run, ms)
  timers.set(id, [...(timers.get(id) ?? []), t])
}

const q = (root: Element, part: string) => root.querySelector<HTMLElement>(`[class*="__${part}__"]`)

function fxOf(item: Item): Fx {
  const bag = bags.get(item.id) ?? {}
  bags.set(item.id, bag)
  const stops = () => [...item.root.querySelectorAll<HTMLElement>('li[class*="__stop__"]')]
  return {
    item,
    bag,
    reduce: reduce(),
    button: () =>
      [...item.root.querySelectorAll<HTMLElement>('button')].find(
        (b) => /merge/i.test(b.textContent ?? '') && !b.hasAttribute('aria-haspopup'),
      ) ?? null,
    stops,
    target: () => {
      if (item.place === 'thread') {
        const stop = stops().find((li) => q(li, 'what')?.textContent === 'Merge')
        return stop === undefined ? null : q(stop, 'knot')
      }
      if (item.place === 'outputs') return q(item.root, 'state')
      const word = q(item.root, 'word')
      return (word?.firstElementChild as HTMLElement | null) ?? word
    },
  }
}

/** The card itself, which keeps its height while its button is gone. */
const cardOf = (item: Item) => item.hold.firstElementChild as HTMLElement | null

function holdHeight(item: Item) {
  const card = cardOf(item)
  if (card !== null) card.style.minHeight = `${card.offsetHeight}px`
}
/** Lets the card take its new height, easing to it, once the merge has landed. */
function release(item: Item) {
  const card = cardOf(item)
  if (card === null || card.style.minHeight === '') return
  const from = card.offsetHeight
  card.style.minHeight = ''
  const to = card.offsetHeight
  if (from === to || reduce()) return
  card.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 300, easing: OUT })
}

/** Merge pressed, in a place. */
export function press(id: string) {
  const item = items.get(id)
  const dir = settings.dir
  if (item === undefined || stageOf(id) !== 'ready') return
  bags.set(id, {})
  if (dir?.hold === true) holdHeight(item)
  // Before the state changes: the button as it was pressed.
  dir?.onPress?.(fxOf(item))
  set({ [id]: 'merging' })
  later(id, ACK, () => {
    dir?.beforeQueue?.(fxOf(item))
    set({ [id]: 'queued' })
    dir?.onQueue?.(fxOf(item))
    if (settings.auto && !batched.has(id)) later(id, QUEUE, () => land([id]))
  })
}

/** Several pressed one after another, as a person going down a lane; they land together, as a queue lands a batch. */
export function pressAll(ids: readonly string[]) {
  const ready = ids.filter((id) => stageOf(id) === 'ready')
  ready.forEach((id, i) => {
    batched.add(id)
    later(id, i * 170, () => press(id))
  })
  if (settings.auto && ready.length > 0) later(ready[0]!, (ready.length - 1) * 170 + ACK + QUEUE, () => land(ready))
}

const order = (a: string, b: string) => {
  const x = items.get(a)?.root
  const y = items.get(b)?.root
  if (x === undefined || y === undefined) return 0
  return x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
}

/** What is in the queue lands: one after another down the page, the first loud where nothing landed a moment ago. */
export function land(ids: readonly string[] = Object.keys(stages)) {
  const queued = ids.filter((id) => stageOf(id) === 'queued').sort(order)
  if (queued.length === 0) return
  const now = performance.now()
  const loud = now - lastLanding > CALM
  lastLanding = now
  queued.forEach((id, i) => {
    const run = () => {
      const item = items.get(id)
      const dir = settings.dir
      set({ [id]: 'merged' })
      batched.delete(id)
      if (item === undefined) return
      const fx = fxOf(item)
      if (i === 0 && loud) dir?.onLand?.(fx, true)
      else if (dir?.onQuiet !== undefined) dir.onQuiet(fx)
      else dir?.onLand?.(fx, false)
      later(id, 1300, () => release(item))
    }
    if (i === 0) run()
    else later(id, i * 90, run)
  })
}

/** Every place back to Merge, as if nothing was pressed. */
export function again() {
  for (const list of timers.values()) for (const t of list) clearTimeout(t)
  timers.clear()
  batched.clear()
  bags.clear()
  lastLanding = Number.NEGATIVE_INFINITY
  for (const item of items.values()) {
    item.layer.replaceChildren()
    const card = cardOf(item)
    if (card !== null) card.style.minHeight = ''
    // Only what the page started: the kit's own animations (a stop breathing, a spinner) keep going.
    for (const a of item.root.getAnimations({ subtree: true }))
      if (!(a instanceof CSSAnimation) && !(a instanceof CSSTransition)) a.cancel()
  }
  set(Object.fromEntries(Object.keys(stages).map((id) => [id, 'ready' as const])))
}
