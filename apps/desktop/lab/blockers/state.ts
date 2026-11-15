import { store, useStore } from './store'
import { endOf, type Move, simulate, STORY, type WorldNow } from './world'

export { store, useStore } from './store'

/*
 * What the lab's pieces share: the direction on show, the clock and how fast
 * it runs, what the person did, and whether the window is at the app's
 * narrowest. Kept in the address's query, beside the app's place in its hash,
 * so a reload comes back to it.
 */

export type Letter = 'a' | 'b' | 'c'

export interface Direction {
  readonly key: Letter
  readonly name: string
  /** What it bets on, in a line, for the bar's tooltip. */
  readonly line: string
}

export const DIRECTIONS: ReadonlyArray<Direction> = [
  {
    key: 'a',
    name: 'Its own place in Up next',
    line: 'Waiting tasks sit in Up next under their own heading, each saying what it waits for and how that stands. You set what a task waits for on the task; an abandoned blocker is a card in Needs you with the choices on it.',
  },
  {
    key: 'b',
    name: 'Under its blocker',
    line: 'A waiting task rides at the foot of the card it waits for, wherever that card is, so a chain reads at a glance. You add what comes after from the blocker; an abandoned blocker keeps its card in Needs you, with the choices.',
  },
  {
    key: 'c',
    name: 'In words',
    line: 'Nothing new on the board: a waiting task is a planned row that says when it starts. You set it by telling the coordinator; an abandoned blocker is the coordinator’s question, with what it would do.',
  },
]

const query = new URLSearchParams(window.location.search)

export const direction = store<Letter>(DIRECTIONS.find((one) => one.key === (query.get('d') ?? '').toLowerCase())?.key ?? 'a')

export const SPEEDS = [1, 2, 4] as const
export const narrow = store(query.get('narrow') === '1')
export const speed = store<number>(Number(query.get('speed') ?? 2) || 2)
/** Playing, or held still where it is (for a screenshot, `?t=26&paused=1`). */
export const playing = store(query.get('paused') !== '1')
/** The person's moves, each at the minute it was made; the day's own (`STORY`) unless `story=0`. */
const story = (): ReadonlyArray<Move> => (query.get('story') === '0' ? [] : STORY)
export const moves = store<ReadonlyArray<Move>>(story())
/** The clock, in minutes since the day's picture starts. */
export const clock = store<number>(Number(query.get('t') ?? 0) || 0)

/* The world now, worked out once per quarter minute and moves. */
let cached: { t: number; moves: ReadonlyArray<Move>; world: WorldNow } | null = null
export const worldNow = (): WorldNow => {
  const t = Math.round(clock.get() * 4) / 4
  if (cached?.t !== t || cached.moves !== moves.get()) cached = { t, moves: moves.get(), world: simulate(moves.get(), t) }
  return cached.world
}
let ended: { moves: ReadonlyArray<Move>; at: number } | null = null
/** Where the day ends: the last change, where nobody does anything more. */
export const endNow = (): number => {
  if (ended?.moves !== moves.get()) ended = { moves: moves.get(), at: endOf(moves.get()) }
  return ended.at
}

/** A move, before it has its minute. */
export type Moving = Move extends infer M ? (M extends Move ? Omit<M, 'at'> : never) : never

/** Something the person did, at the clock's minute. */
export const move = (one: Moving) => {
  moves.set((was) => [...was, { ...one, at: clock.get() } as Move])
}

/** Back to the start of the day, with nothing the person did but the day's own. */
export const again = () => {
  moves.set(story())
  clock.set(0)
  playing.set(true)
}

const toAddress = () => {
  const next = new URLSearchParams(window.location.search)
  next.set('d', direction.get().toUpperCase())
  if (narrow.get()) next.set('narrow', '1')
  else next.delete('narrow')
  next.delete('t')
  next.delete('paused')
  window.history.replaceState(window.history.state, '', `${window.location.pathname}?${next.toString()}${window.location.hash}`)
}
direction.subscribe(toAddress)
narrow.subscribe(toAddress)

/** The world now, for a component: drawn again as the clock or the moves change. */
export const useWorld = (): WorldNow => {
  useStore(clock)
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

/** The app's router, for opening a task from a lab piece. */
export const router: { current: { navigate: (to: { to: string; params?: Record<string, string> }) => unknown } | null } = { current: null }

export const PROJECT = 'p_lab'
export const COORDINATOR = 'thc_lab'
export const taskIdOf = (key: string) => `t_${key}`
export const threadIdOf = (key: string) => `th_${key}`
export const keyOfThread = (threadId: string): string | null => (threadId.startsWith('th_') ? threadId.slice(3) : null)

/** Opens a task's page in the window. */
export const openTask = (key: string) => {
  void router.current?.navigate({ to: '/threads/$threadId', params: { threadId: threadIdOf(key) } })
}
