// Scrappy: what the page holds: the surface and direction shown, and what the person did on it (tasks started, calls answered).
import { useSyncExternalStore } from 'react'

import { type Draft, freshDraft } from './directions/start/pieces'

export type Surface = 'start' | 'lineage' | 'rules' | 'tools' | 'parts'
export type Direction = 'A' | 'B' | 'C' | 'Today'

export interface Place {
  readonly label: string
  readonly hash: string
}

export interface SurfaceInfo {
  readonly value: Surface
  readonly name: string
  readonly directions: ReadonlyArray<{ readonly value: Direction; readonly name: string; readonly about: string }>
  /** Where in the app the surface shows, the first where it opens. */
  readonly places: ReadonlyArray<Place>
}

const BOTH = '#/projects/p1?room=both'
const BOARD = '#/projects/p1?room=board'
const PARENT = '#/threads/th-adr'
const CHILD = '#/threads/th-codex-net'
const RULES = '#/projects/p1?room=settings&section=rules'
const ASK = '#/threads/th-runs'
const TOOLS = '#/settings/skills'
const MCP = '#/threads/th-design'
const REVIEW = '#/threads/th-review'

/** The surfaces in the strip's order, keys 1 to 5, each with its directions, keys A, B, C (and T for today). */
export const SURFACES: ReadonlyArray<SurfaceInfo> = [
  {
    value: 'start',
    name: 'New task',
    places: [
      { label: 'Board', hash: BOTH },
      { label: 'Board alone', hash: BOARD },
    ],
    directions: [
      { value: 'A', name: 'A dialog', about: 'New task opens a dialog over the board: words or Linear issues, model, review, branch' },
      {
        value: 'B',
        name: 'The composer',
        about: 'The project’s composer starts a task or talks to the coordinator, by a switch at its edge',
      },
      { value: 'C', name: 'On the board', about: 'A card at the top of the board you write into, started where it is' },
      { value: 'Today', name: 'Today', about: 'Only the coordinator starts tasks, after its countdown' },
    ],
  },
  {
    value: 'lineage',
    name: 'Leads and the coordinator',
    places: [
      { label: 'Board', hash: BOARD },
      { label: 'Parent’s thread', hash: PARENT },
      { label: 'Child’s thread', hash: CHILD },
    ],
    directions: [
      {
        value: 'A',
        name: 'A line of lineage',
        about: 'A started-by line on the child’s card; the parent’s thread has its card, no countdown',
      },
      {
        value: 'B',
        name: 'Under its parent',
        about: 'The child sits under its parent on the board; the parent’s card counts it, with a hold',
      },
      { value: 'Today', name: 'Today', about: 'Leads can’t start tasks; the coordinator speaks only in its own thread' },
    ],
  },
  {
    value: 'rules',
    name: 'What asks',
    places: [
      { label: 'Rules', hash: RULES },
      { label: 'An ask in a task', hash: ASK },
    ],
    directions: [
      { value: 'A', name: 'Four kinds', about: 'Rules lead with the four kinds that still ask, then your own Never and Ask' },
      { value: 'B', name: 'The charter, shorter', about: 'Today’s sentences, with what can’t be undone as their first and the modes gone' },
      { value: 'Today', name: 'Today', about: 'Rules as built: a mode, Allow everything as a switch, six kinds' },
    ],
  },
  {
    value: 'tools',
    name: 'MCP and skills',
    places: [
      { label: 'Settings', hash: TOOLS },
      { label: 'Calls in a thread', hash: MCP },
    ],
    directions: [
      {
        value: 'A',
        name: 'By where found',
        about: 'Servers and skills listed by the config they came from, each with a switch and its roles',
      },
      { value: 'B', name: 'By role', about: 'A table of what each role gets: lead, reviewer, coordinator' },
      { value: 'Today', name: 'Today', about: 'Althar’s skills only; none of your MCP servers' },
    ],
  },
  {
    value: 'parts',
    name: 'Sketches',
    places: [
      { label: 'A change’s parts', hash: PARENT },
      { label: 'A review', hash: REVIEW },
      { label: 'A push by an agent', hash: CHILD },
    ],
    directions: [
      {
        value: 'A',
        name: 'Sketch',
        about: 'Parts as chips on a task’s header, a review that says whether it runs the code, an agent’s own push',
      },
    ],
  },
]

export const surfaceOf = (surface: Surface) => SURFACES.find((one) => one.value === surface) ?? SURFACES[0]!

/** A task the person started on the page, as it was asked for. */
export interface Started {
  readonly id: string
  readonly title: string
  readonly issue: string | null
  readonly model: string
  readonly modelId: string
  readonly review: boolean
  readonly small: boolean
  readonly toward: string | null
  readonly worksIn: 'worktree' | 'checkout'
  readonly at: number
  /** B: what was written in the composer, which the conversation shows as the person's message. */
  readonly words?: string | null
}

export interface Proto {
  readonly surface: Surface
  readonly direction: Direction
  /** No strip under the window: for screenshots. */
  readonly bare: boolean
  /** The new-task dialog, or the board's new card, open. */
  readonly composing: boolean
  /** In the composer direction: whether it talks to the coordinator or starts a task. */
  readonly to: 'coordinator' | 'task'
  readonly started: ReadonlyArray<Started>
  /** The parent's hold on the task its lead started, while held. */
  readonly childHeld: boolean
  /** Calls the person answered on the page, by id. */
  readonly answered: Readonly<Record<string, 'allowed' | 'refused'>>
  /** Servers and skills switched off on the page, by id; and roles taken off. */
  readonly off: ReadonlyArray<string>
  /** Words handed from the new task to the coordinator's composer, once. */
  readonly handed: string | null
  /** B: the task being written in the project's composer. */
  readonly composer: Draft
}

let state: Proto = {
  surface: 'start',
  direction: 'A',
  bare: false,
  composing: false,
  to: 'task',
  started: [],
  childHeld: false,
  answered: {},
  off: [],
  handed: null,
  composer: freshDraft(),
}
const listeners = new Set<() => void>()

const set = (next: Partial<Proto>) => {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

export const proto = {
  get: () => state,
  set,
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  startOver: () => set({ composing: false, started: [], childHeld: false, answered: {}, off: [], to: 'task', composer: freshDraft() }),
  start: (tasks: ReadonlyArray<Omit<Started, 'id' | 'at'>>) =>
    set({
      composing: false,
      composer: freshDraft(),
      started: [
        ...tasks.map((task, index) => ({ ...task, id: `tk-new-${state.started.length + index}`, at: Date.now() })),
        ...state.started,
      ],
    }),
  toggle: (id: string) => set({ off: state.off.includes(id) ? state.off.filter((one) => one !== id) : [...state.off, id] }),
  answer: (id: string, how: 'allowed' | 'refused') => set({ answered: { ...state.answered, [id]: how } }),
}

export const useProto = () => useSyncExternalStore(proto.subscribe, proto.get)
