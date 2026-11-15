import { useSyncExternalStore } from 'react'

import { endOf, type Move, SCENARIOS, type Scenario, type ScenarioKey, simulate, type WorldNow } from './world'

/*
 * What the lab's pieces share: which direction shows the graph, which
 * request plays, the clock and how fast it runs, what the person did, and
 * whether the window is drawn at the app's narrowest. Kept in the address's
 * query, beside the app's place in its hash, so a reload comes back to it.
 */

export const DIRECTIONS = ['a', 'b', 'c', 'd'] as const
export type Direction = (typeof DIRECTIONS)[number]

export const NAMES: Readonly<Record<Direction, string>> = {
  a: 'In the conversation',
  b: 'Over the board',
  c: 'On a task’s page',
  d: 'Lines on the board',
}

export const LINES: Readonly<Record<Direction, string>> = {
  a: 'The coordinator’s answer holds one card for the request, drawn top to bottom, in place of a card per task.',
  b: 'Each request in flight is a band over the board’s lanes; pointing at a task finds its card below.',
  c: 'Each task of a request has a Request view beside Conversation and Outputs: the whole graph, this task in it.',
  d: 'The board stays as it is, each waiting task says what it waits for, and pointing at a card draws its line through the board.',
}

export const SCENARIO_KEYS: ReadonlyArray<ScenarioKey> = ['two', 'six', 'twelve']
export const SCENARIO_NAMES: Readonly<Record<ScenarioKey, string>> = { two: '2 tasks', six: '6 tasks', twelve: '12 tasks' }

export const SPEEDS = [1, 2, 4] as const

const store = <A>(initial: A) => {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next: A | ((now: A) => A)) => {
      const was = value
      value = typeof next === 'function' ? (next as (now: A) => A)(value) : next
      if (value !== was) for (const listener of listeners) listener()
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}

const query = new URLSearchParams(window.location.search)
const asked = (query.get('d') ?? '').toLowerCase()
const askedScenario = query.get('s') ?? ''

export const direction = store<Direction>(DIRECTIONS.find((one) => one === asked) ?? 'a')
export const scenarioKey = store<ScenarioKey>(SCENARIO_KEYS.find((one) => one === askedScenario) ?? 'six')
export const narrow = store(query.get('narrow') === '1')
export const speed = store<number>(Number(query.get('speed') ?? 2) || 2)
/** Playing, or held still where it is (for a screenshot, `?t=34&paused=1`). */
export const playing = store(query.get('paused') !== '1')
/** The person's moves, each at the minute it was made. */
export const moves = store<ReadonlyArray<Move>>([])
/** The clock, in minutes of work since the coordinator split the request. */
export const clock = store<number>(Number(query.get('t') ?? 0) || 0)

export const scenario = (): Scenario => SCENARIOS[scenarioKey.get()]

/* The world now, worked out once per clock, request and moves. */
let cached: { key: string; world: WorldNow } | null = null
export const worldNow = (): WorldNow => {
  const t = Math.round(clock.get() * 4) / 4
  const key = `${scenarioKey.get()}|${t}|${moves.get().length}`
  if (cached?.key !== key) cached = { key, world: simulate(scenario(), moves.get(), t) }
  return cached.world
}
let ended: { key: string; at: number } | null = null
/** Where the run ends: the last change, where nobody does anything more. */
export const endNow = (): number => {
  const key = `${scenarioKey.get()}|${moves.get().length}`
  if (ended?.key !== key) ended = { key, at: endOf(scenario(), moves.get()) }
  return ended.at
}

type Moving = Move extends infer M ? (M extends Move ? Omit<M, 'at'> : never) : never

/** Something the person did, at the clock's minute. */
export const move = (one: Moving) => {
  moves.set((was) => [...was, { ...one, at: clock.get() } as Move])
}

const toAddress = () => {
  const next = new URLSearchParams(window.location.search)
  next.set('d', direction.get().toUpperCase())
  next.set('s', scenarioKey.get())
  if (narrow.get()) next.set('narrow', '1')
  else next.delete('narrow')
  next.delete('t')
  next.delete('paused')
  window.history.replaceState(window.history.state, '', `${window.location.pathname}?${next.toString()}${window.location.hash}`)
}
direction.subscribe(toAddress)
scenarioKey.subscribe(toAddress)
narrow.subscribe(toAddress)
// A new request starts from the beginning, with nothing done to it.
scenarioKey.subscribe(() => {
  moves.set([])
  clock.set(0)
  playing.set(true)
})

export const useStore = <A>(one: { get: () => A; subscribe: (listener: () => void) => () => void }) =>
  useSyncExternalStore(one.subscribe, one.get)

/** The world now, for a component: drawn again as the clock, the request or the moves change. */
export const useWorld = (): WorldNow => {
  useStore(clock)
  useStore(scenarioKey)
  useStore(moves)
  return worldNow()
}

/** What an action would have done, said for a moment over the bar. */
export const said = store<string | null>(null)
let saying: ReturnType<typeof setTimeout> | undefined
export const say = (line: string) => {
  said.set(line)
  clearTimeout(saying)
  saying = setTimeout(() => said.set(null), 3200)
}

/** The app's router, for opening a task from the graph. */
export const router: { current: { navigate: (to: { to: string; params?: Record<string, string> }) => unknown } | null } = { current: null }
