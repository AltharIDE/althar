// Scrappy: what every direction's page shares: the project's runnables, their runs, and what the page opens on.
import { createContext, useContext, useSyncExternalStore } from 'react'

export type Direction = 'Today' | 'A' | 'B' | 'C' | 'D' | 'E'
/** What the project knows to run: nothing yet, the one its repository says, many, or many with several running. */
export type Scenario = 'empty' | 'one' | 'many' | 'busy'
/** Where a runnable came from: worked out from the repository, or kept by the person or the coordinator. */
export type Source = 'repository' | 'person' | 'coordinator'
/** Where a run runs: a copy of the default branch, or this task's worktree. */
export type Place = 'main' | 'task'
/** How a run of it goes, in the prototype: serves on a port, opens a window, finishes, or fails. */
export type Goes =
  | { readonly kind: 'serves'; readonly port: number }
  | { readonly kind: 'window' }
  | { readonly kind: 'finishes' }
  | { readonly kind: 'fails' }

export interface Runnable {
  readonly id: string
  /** What it is, in a word or two; without one, its command names it. */
  readonly name?: string
  readonly command: string
  /** here: where you are (the default branch from the project, this task's worktree from a task). main: the default branch, always. */
  readonly where: 'here' | 'main'
  readonly source: Source
  /** The package.json script it runs, where it is one: althar · dev. */
  readonly script?: string
  readonly goes: Goes
}

export type RunState = 'starting' | 'running' | 'ended' | 'failed' | 'stopped'

export interface Run {
  readonly id: string
  readonly runnableId: string
  readonly place: Place
  readonly state: RunState
  readonly url: string | null
  readonly startedAt: number
  readonly endedAt: number | null
  readonly code: number | null
}

/** What the page opens on, for its screenshots: the direction's list, a step of adding, editing, managing, the palette, the rail. */
export type Opening =
  | 'menu'
  | 'more'
  | 'add'
  | 'scripts'
  | 'ask'
  | 'asked'
  | 'edit'
  | 'manage'
  | 'detail'
  | 'palette'
  | 'search'
  | 'settings'
  | 'rail'
  | 'output'
  | null

export interface Proto {
  readonly direction: Direction
  readonly scenario: Scenario
  readonly runnables: ReadonlyArray<Runnable>
  readonly defaultId: string | null
  readonly runs: ReadonlyArray<Run>
  readonly opening: Opening
  /** The coordinator is reading the repository for what runs. */
  readonly asking: boolean
  /** The page has no strip of states under the window: for screenshots. */
  readonly bare: boolean
}

/* ——— This repository, as it runs: real scripts, real ports. ——— */

const MIN = 60_000

export const RUNNABLES: Record<string, Runnable> = {
  dev: {
    id: 'dev',
    name: 'Public site',
    command: 'bun run dev',
    where: 'here',
    source: 'repository',
    script: 'althar · dev',
    goes: { kind: 'serves', port: 5320 },
  },
  storybook: {
    id: 'storybook',
    name: 'Storybook',
    command: 'bun --filter @althar/ui storybook',
    where: 'here',
    source: 'person',
    script: '@althar/ui · storybook',
    goes: { kind: 'serves', port: 6006 },
  },
  desktop: {
    id: 'desktop',
    name: 'Desktop app',
    command: 'bun --filter @althar/desktop dev',
    where: 'here',
    source: 'coordinator',
    script: '@althar/desktop · dev',
    goes: { kind: 'window' },
  },
  site: {
    id: 'site',
    name: 'Site preview',
    command: 'bun run site',
    where: 'here',
    source: 'person',
    script: 'althar · site',
    goes: { kind: 'serves', port: 5320 },
  },
  unit: {
    id: 'unit',
    name: 'UI tests',
    command: 'bun --filter @althar/ui test',
    where: 'here',
    source: 'person',
    script: '@althar/ui · test',
    goes: { kind: 'finishes' },
  },
  e2e: {
    id: 'e2e',
    name: 'Desktop end-to-end tests',
    command: 'bun --filter @althar/desktop test:e2e',
    where: 'here',
    source: 'coordinator',
    script: '@althar/desktop · test:e2e',
    goes: { kind: 'fails' },
  },
  probe: {
    id: 'probe',
    name: 'Probe the agents’ tools',
    command: 'bun --filter @althar/runtime probe:tools',
    where: 'main',
    source: 'person',
    script: '@althar/runtime · probe:tools',
    goes: { kind: 'finishes' },
  },
}

const MANY = ['dev', 'storybook', 'desktop', 'site', 'unit', 'e2e', 'probe'].map((id) => RUNNABLES[id]!)

/** The one the repository says, as Althar works it out today: unnamed, so its command names it. */
const ONE: Runnable = { ...RUNNABLES.dev!, name: undefined }

/** What the coordinator finds when asked: what the repository runs that isn't kept yet. */
export const FOUND: ReadonlyArray<Runnable> = [
  { ...RUNNABLES.desktop!, id: 'found-desktop' },
  { ...RUNNABLES.storybook!, id: 'found-storybook', source: 'coordinator' },
  {
    id: 'found-check',
    name: 'Checks',
    command: 'bun run check',
    where: 'here',
    source: 'coordinator',
    script: 'althar · check',
    goes: { kind: 'finishes' },
  },
]

const run = (runnableId: string, place: Place, state: RunState, startedMinutesAgo: number, more: Partial<Run> = {}): Run => {
  const goes = RUNNABLES[runnableId]!.goes
  const port = goes.kind === 'serves' ? goes.port + (place === 'task' ? 1 : 0) : null
  return {
    id: `${runnableId}-${place}`,
    runnableId,
    place,
    state,
    url: state === 'running' && port !== null ? `http://localhost:${port}/` : null,
    startedAt: Date.now() - startedMinutesAgo * MIN,
    endedAt: null,
    code: null,
    ...more,
  }
}

const BUSY: ReadonlyArray<Run> = [
  // The default branch: the public site up, Storybook starting, the UI tests passed, the end-to-end tests failed.
  run('dev', 'main', 'running', 12),
  run('storybook', 'main', 'starting', 0.1),
  run('unit', 'main', 'ended', 6, { endedAt: Date.now() - 3 * MIN, code: 0 }),
  run('e2e', 'main', 'failed', 14, { endedAt: Date.now() - 8 * MIN, code: 1 }),
  // This task: its Storybook up beside main's, its desktop app open, its UI tests failed.
  run('storybook', 'task', 'running', 4),
  run('desktop', 'task', 'running', 2),
  run('unit', 'task', 'failed', 5, { endedAt: Date.now() - 1 * MIN, code: 1 }),
]

const seeded = (scenario: Scenario): Pick<Proto, 'runnables' | 'defaultId' | 'runs'> => {
  switch (scenario) {
    case 'empty':
      return { runnables: [], defaultId: null, runs: [] }
    case 'one':
      return { runnables: [ONE], defaultId: ONE.id, runs: [] }
    case 'many':
      return { runnables: MANY, defaultId: 'dev', runs: [] }
    case 'busy':
      return { runnables: MANY, defaultId: 'dev', runs: BUSY }
  }
}

/* ——— The store. ——— */

let state: Proto = {
  direction: 'A',
  scenario: 'many',
  ...seeded('many'),
  opening: null,
  asking: false,
  bare: false,
}
const listeners = new Set<() => void>()

const set = (next: Partial<Proto>) => {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

const update = (id: string, next: (run: Run) => Partial<Run>) =>
  set({ runs: state.runs.map((one) => (one.id === id ? { ...one, ...next(one) } : one)) })

let made = 0

/** Where a runnable runs from a screen: where you are, or the default branch where it always runs there. */
export const placeOf = (runnable: Runnable, here: Place): Place => (runnable.where === 'main' ? 'main' : here)

export const proto = {
  get: () => state,
  set,
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  scenario: (scenario: Scenario) => set({ scenario, ...seeded(scenario), asking: false }),

  /** Runs it where it runs from this screen: starting, then up where it answers, or ended by itself. */
  run: (runnableId: string, place: Place) => {
    const runnable = state.runnables.find((one) => one.id === runnableId)
    if (runnable === undefined) return
    const id = `${runnableId}-${place}-${(made += 1)}`
    // A run again takes the place of the last run of it there.
    const others = state.runs.filter((one) => !(one.runnableId === runnableId && one.place === place))
    const fresh: Run = { id, runnableId, place, state: 'starting', url: null, startedAt: Date.now(), endedAt: null, code: null }
    set({ runs: [fresh, ...others] })
    const goes = runnable.goes
    window.setTimeout(() => {
      if (state.runs.find((one) => one.id === id)?.state !== 'starting') return
      if (goes.kind === 'serves')
        update(id, () => ({ state: 'running', url: `http://localhost:${goes.port + (place === 'task' ? 1 : 0)}/` }))
      else update(id, () => ({ state: 'running' }))
    }, 1400)
    if (goes.kind === 'finishes' || goes.kind === 'fails')
      window.setTimeout(() => {
        if (state.runs.find((one) => one.id === id)?.state !== 'running') return
        update(id, () => ({ state: goes.kind === 'fails' ? 'failed' : 'ended', endedAt: Date.now(), code: goes.kind === 'fails' ? 1 : 0 }))
      }, 4200)
  },
  stop: (runId: string) => update(runId, () => ({ state: 'stopped', url: null, endedAt: Date.now(), code: null })),
  /** Runs what this run ran again, in the same place. */
  again: (runId: string) => {
    const was = state.runs.find((one) => one.id === runId)
    if (was !== undefined) proto.run(was.runnableId, was.place)
  },
  clear: (runId: string) => set({ runs: state.runs.filter((one) => one.id !== runId) }),

  add: (runnable: Omit<Runnable, 'id'>, id = `kept-${(made += 1)}`) => {
    set({ runnables: [...state.runnables, { ...runnable, id }], defaultId: state.defaultId ?? id })
    return id
  },
  edit: (id: string, next: Partial<Omit<Runnable, 'id'>>) =>
    set({
      runnables: state.runnables.map((one) =>
        one.id === id ? { ...one, ...next, source: one.source === 'repository' ? 'person' : one.source } : one,
      ),
    }),
  remove: (id: string) => {
    const runnables = state.runnables.filter((one) => one.id !== id)
    set({
      runnables,
      defaultId: state.defaultId === id ? (runnables[0]?.id ?? null) : state.defaultId,
      runs: state.runs.filter((one) => one.runnableId !== id || one.state === 'running' || one.state === 'starting'),
    })
  },
  move: (id: string, by: -1 | 1) => {
    const list = [...state.runnables]
    const at = list.findIndex((one) => one.id === id)
    const to = at + by
    if (at < 0 || to < 0 || to >= list.length) return
    ;[list[at], list[to]] = [list[to]!, list[at]!]
    set({ runnables: list })
  },
  makeDefault: (id: string) => set({ defaultId: id }),
  /** Puts them in this order, the first the default: as the app orders them. */
  order: (ids: ReadonlyArray<string>) =>
    set({
      runnables: [
        ...ids.flatMap((id) => state.runnables.filter((one) => one.id === id)),
        ...state.runnables.filter((one) => !ids.includes(one.id)),
      ],
      defaultId: ids[0] ?? state.defaultId,
    }),

  /** Asks the coordinator what the repository runs: it reads a moment, then offers what it found. */
  ask: () => {
    set({ asking: true })
    window.setTimeout(() => set({ asking: false }), 2600)
  },
}

export const useProto = () => useSyncExternalStore(proto.subscribe, proto.get)

/* ——— Where a direction is drawn: the project's front, or a task's bar. ——— */

export interface Screen {
  readonly place: Place
  /** The task on show, on a task's screen. */
  readonly task: { readonly title: string; readonly branch: string } | null
}

export const ScreenContext = createContext<Screen>({ place: 'main', task: null })
export const useScreen = () => useContext(ScreenContext)

/** The task the task screen shows: a real one of this repository's. */
export const TASK = { title: 'Give Download the installer for this computer', branch: 'althar/download-the-installer' }
