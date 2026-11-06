// Scrappy: what the page holds: the surface and direction shown, and what the person did on it (tasks started, calls answered).
import { useSyncExternalStore } from 'react'

import { type Draft, freshDraft } from './directions/start/pieces'

export type Surface = 'start' | 'lineage' | 'rules' | 'tools' | 'tune' | 'parts' | 'sketches'
export type Direction = 'A' | 'B' | 'C' | 'D' | 'Today'

export interface Place {
  readonly label: string
  readonly hash: string
}

export interface SurfaceInfo {
  readonly value: Surface
  readonly name: string
  /** Its name in the strip, where the full one is long; the full one is its tooltip. */
  readonly short?: string
  readonly directions: ReadonlyArray<{ readonly value: Direction; readonly name: string; readonly about: string }>
  /** Where in the app the surface shows, the first where it opens. */
  readonly places: ReadonlyArray<Place>
}

const BOARD = '#/projects/p1?room=board'
const PARENT = '#/threads/th-adr'
const CHILD = '#/threads/th-codex-net'
const RULES = '#/projects/p1?room=settings&section=rules'
const ASK = '#/threads/th-runs'
const TOOLS = '#/settings/skills'
const MCP = '#/threads/th-design'
const REVIEW = '#/threads/th-review'
const TALK = '#/projects/p1?room=talk'
const GENERAL = '#/projects/p1?room=settings&section=general'
const ACCOUNT = '#/settings/what-asks'
const MANY = '#/threads/th-runs'

/** The surfaces in the strip's order, keys 1 to 6, each with its directions, keys A to D (and T for today). New task (start) is set aside: the person keeps starting tasks with the coordinator for now. */
export const SURFACES: ReadonlyArray<SurfaceInfo> = [
  {
    value: 'lineage',
    name: 'Leads and the coordinator',
    short: 'Leads',
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
      { label: 'Project’s Rules', hash: RULES },
      { label: 'Your Settings', hash: ACCOUNT },
      { label: 'An ask in a task', hash: ASK },
    ],
    directions: [
      { value: 'A', name: 'In the project', about: 'Chosen: Rules lead with the four kinds that still ask, then your own Never and Ask' },
      {
        value: 'B',
        name: 'In your Settings',
        about: 'The four kinds and your own commands live in Settings, the same in every project; a project keeps only its own',
      },
      { value: 'Today', name: 'Today', about: 'Rules as built: a mode, Allow everything as a switch, six kinds' },
    ],
  },
  {
    value: 'tools',
    name: 'MCP and skills',
    short: 'MCP',
    places: [
      { label: 'Settings', hash: TOOLS },
      { label: 'Calls in a thread', hash: MCP },
    ],
    directions: [
      {
        value: 'A',
        name: 'A column per agent',
        about: 'The role table you chose, with a column for each of your agents: tick one to add it there',
      },
      {
        value: 'B',
        name: 'Marks in the row',
        about: 'The role table, each server with its agents’ marks, faint where it’s missing, and Add to …',
      },
      {
        value: 'C',
        name: 'One switch',
        about: 'The role table, with one switch that keeps your agents the same, and what’s left to settle',
      },
      { value: 'Today', name: 'Today', about: 'Althar’s skills only; none of your MCP servers' },
    ],
  },
  {
    value: 'tune',
    name: 'Changed by agents',
    places: [
      { label: 'Coordinator', hash: TALK },
      { label: 'Settings', hash: GENERAL },
      { label: 'Rules', hash: RULES },
    ],
    directions: [
      {
        value: 'A',
        name: 'A line each',
        about: 'Chosen: what the coordinator changed is a line each in its thread, with Undo; Settings says who changed a row',
      },
      { value: 'Today', name: 'Today', about: 'Only you change settings' },
    ],
  },
  {
    value: 'parts',
    name: 'A task’s parts',
    short: 'Parts',
    places: [
      { label: 'Three parts', hash: PARENT },
      { label: 'Ten parts', hash: MANY },
      { label: 'A review', hash: REVIEW },
    ],
    directions: [
      { value: 'A', name: 'After title', about: 'The first three follow the title in the bar; the rest behind “N more”' },
      { value: 'B', name: 'A row', about: 'A row of their own, each with where it stands; what doesn’t fit behind “N more”' },
      { value: 'C', name: 'One button', about: 'Parts, with its count, beside the faces; it opens every part by group' },
      {
        value: 'D',
        name: 'Beside thread',
        about: 'The same button opens them in the free margin beside the thread, open until closed',
      },
      { value: 'Today', name: 'Today', about: 'Files, Run and the menu; a pull request is attached from the menu' },
    ],
  },
  {
    value: 'sketches',
    name: 'Sketches',
    places: [
      { label: 'A review', hash: REVIEW },
      { label: 'A push by an agent', hash: CHILD },
    ],
    directions: [{ value: 'A', name: 'Sketch', about: 'A review that says whether it runs the code; an agent’s own push' }],
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
  /** A task's parts, D: the rail beside the thread open. */
  readonly rail: boolean
}

let state: Proto = {
  surface: 'lineage',
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
  rail: true,
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
  startOver: () =>
    set({ composing: false, started: [], childHeld: false, answered: {}, off: [], to: 'task', composer: freshDraft(), rail: true }),
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
