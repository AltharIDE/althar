import { plan, scenario, scenarioKey, stage } from './plan'
import { store, useStore } from './store'
import { endOf, type Move, simulate, type WorldNow } from './world'

export { scenario, scenarioKey, stage } from './plan'
export { store, useStore } from './store'

/*
 * What the lab's pieces share: which option each part shows (the plan in
 * the conversation, the board, a task's page), which request plays, the
 * clock and how fast it runs, what the person did, and whether the window
 * is drawn at the app's narrowest. Kept in the address's query, beside the
 * app's place in its hash, so a reload comes back to it.
 */

/** The three places the graph is tried: where it's planned, on the board while it runs, and from inside one of its tasks. */
export const PARTS = ['chat', 'board', 'task'] as const
export type Part = (typeof PARTS)[number]
export const PART_NAMES: Readonly<Record<Part, string>> = { chat: 'Chat', board: 'Board', task: 'Task' }

export const LETTERS = ['a', 'b', 'c', 'd'] as const
export type Letter = (typeof LETTERS)[number]

/** An option of a part, as the bar names it. */
export interface Option {
  readonly key: Letter
  readonly name: string
  /** What it bets on, in a line, for the bar's tooltip. */
  readonly line: string
}

const query = new URLSearchParams(window.location.search)
const letterOf = (part: Part): Letter => LETTERS.find((one) => one === (query.get(part) ?? '').toLowerCase()) ?? 'a'

/** The option each part shows. */
export const option: Readonly<Record<Part, ReturnType<typeof store<Letter>>>> = {
  chat: store<Letter>(letterOf('chat')),
  board: store<Letter>(letterOf('board')),
  task: store<Letter>(letterOf('task')),
}
/** The part the number keys switch, on the project's page; a task's page always switches Task. */
export const activePart = store<Part>(PARTS.find((one) => one === query.get('part')) ?? 'chat')

export const SPEEDS = [1, 2, 4] as const

export const narrow = store(query.get('narrow') === '1')
export const speed = store<number>(Number(query.get('speed') ?? 4) || 4)
/** Playing, or held still where it is (for a screenshot, `?t=34&paused=1`). */
export const playing = store(query.get('paused') !== '1' && stage.get() === 'run')
/** The person's moves, each at the minute it was made. */
export const moves = store<ReadonlyArray<Move>>([])
/** The clock, in minutes of work since the plan was launched; 0 while it's planned. */
export const clock = store<number>(stage.get() === 'run' ? Number(query.get('t') ?? 0) || 0 : 0)

/* The world now, worked out once per clock, plan and moves. */
let cached: { key: string; plan: unknown; world: WorldNow } | null = null
export const worldNow = (): WorldNow => {
  const t = Math.round(clock.get() * 4) / 4
  const key = `${scenarioKey.get()}|${t}|${moves.get().length}`
  if (cached?.key !== key || cached.plan !== plan.get()) cached = { key, plan: plan.get(), world: simulate(scenario(), moves.get(), t) }
  return cached.world
}
let ended: { key: string; plan: unknown; at: number } | null = null
/** Where the run ends: the last change, where nobody does anything more. */
export const endNow = (): number => {
  const key = `${scenarioKey.get()}|${moves.get().length}`
  if (ended?.key !== key || ended.plan !== plan.get()) ended = { key, plan: plan.get(), at: endOf(scenario(), moves.get()) }
  return ended.at
}

type Moving = Move extends infer M ? (M extends Move ? Omit<M, 'at'> : never) : never

/** Something the person did, at the clock's minute. */
export const move = (one: Moving) => {
  moves.set((was) => [...was, { ...one, at: clock.get() } as Move])
}

const toAddress = () => {
  const next = new URLSearchParams(window.location.search)
  for (const part of PARTS) next.set(part, option[part].get().toUpperCase())
  next.set('part', activePart.get())
  next.set('s', scenarioKey.get())
  next.set('stage', stage.get())
  if (narrow.get()) next.set('narrow', '1')
  else next.delete('narrow')
  next.delete('t')
  next.delete('paused')
  next.delete('d')
  window.history.replaceState(window.history.state, '', `${window.location.pathname}?${next.toString()}${window.location.hash}`)
}
for (const part of PARTS) option[part].subscribe(toAddress)
activePart.subscribe(toAddress)
scenarioKey.subscribe(toAddress)
stage.subscribe(toAddress)
narrow.subscribe(toAddress)

/** Launched, the run starts from its first minute; back to planning, it waits at nothing. */
stage.subscribe(() => {
  moves.set([])
  clock.set(0)
  playing.set(stage.get() === 'run')
})
// A new request starts from its plan, with nothing done to it.
scenarioKey.subscribe(() => stage.set('plan'))

/** Launches the plan: its latest version is what runs. */
export const launch = () => stage.set('run')

/** The world now, for a component: drawn again as the clock, the request, the plan or the moves change. */
export const useWorld = (): WorldNow => {
  useStore(clock)
  useStore(scenarioKey)
  useStore(moves)
  useStore(plan)
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
