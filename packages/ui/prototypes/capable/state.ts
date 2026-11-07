// Scrappy: what the page holds: the surface and direction shown, and what the person did on it (calls answered, a child held).
import { useSyncExternalStore } from 'react'

export type Surface = 'lineage' | 'rules' | 'tools' | 'tune' | 'parts' | 'sketches' | 'situations'
export type Direction = 'A' | 'B' | 'C' | 'Today'

export interface Place {
  readonly label: string
  readonly hash: string
  /** What the page holds there, beyond the address: a week on, for sync. */
  readonly set?: Partial<Proto>
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
const TOOLS = '#/settings/mcp'
const SKILLS = '#/settings/skills'
const MCP = '#/threads/th-design'
const REVIEW = '#/threads/th-review'
const TALK = '#/projects/p1?room=talk'
const GENERAL = '#/projects/p1?room=settings&section=general'
const MANY = '#/threads/th-runs'

/** The surfaces in the strip's order, keys 1 to 7, each with its directions, keys A to C (and T for today). New task without the coordinator is set aside (6 Nov); it was the strip's first surface up to 7274e40. */
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
      { label: 'An ask in a task', hash: ASK },
    ],
    directions: [
      { value: 'A', name: 'In the project', about: 'Chosen: Rules lead with the four kinds that still ask, then your own Never and Ask' },
      { value: 'Today', name: 'Today', about: 'Rules as built: a mode, Allow everything as a switch, six kinds' },
    ],
  },
  {
    value: 'tools',
    name: 'MCP and skills',
    short: 'MCP',
    places: [
      { label: 'MCP servers', hash: TOOLS, set: { week: false } },
      { label: 'A week on', hash: TOOLS, set: { week: true } },
      { label: 'Skills', hash: SKILLS, set: { week: false } },
      { label: 'Calls in a thread', hash: MCP },
    ],
    directions: [
      {
        value: 'A',
        name: 'Before it starts',
        about: 'Chosen: one switch; turning it on shows what it writes to each agent’s file and what it leaves alone, first',
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
      {
        value: 'C',
        name: 'Waits first',
        about:
          'Chosen: the parts’ own icons in the bar; what waits on you first, then what runs, then the rest; each opens in place, and Add',
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
      { label: 'A small change', hash: '#/threads/th-typo' },
      { label: 'A server fails', hash: MCP },
      { label: 'A lead starts 4', hash: PARENT },
    ],
    directions: [
      {
        value: 'A',
        name: 'Sketch',
        about:
          'One state each, not yet choices: a review that runs or reads; an agent’s own push; a small change; a server that fails; a lead that starts several',
      },
    ],
  },
  {
    value: 'situations',
    name: 'Situations',
    places: [
      { label: 'Away', hash: BOARD, set: { coordinatorOff: false } },
      { label: 'No coordinator', hash: TALK, set: { coordinatorOff: true } },
      { label: 'Never rule', hash: '#/threads/th-small' },
      { label: 'Ask waits', hash: MANY },
      { label: 'Child stops', hash: PARENT },
      { label: 'Same files', hash: '#/threads/th-command' },
      { label: 'Lighter model', hash: REVIEW },
    ],
    directions: [
      {
        value: 'A',
        name: 'Sketch',
        about:
          'One state each: while you were away, on the board; the coordinator off; a Never rule met; an ask that waits; a lead-started task that stops; two tasks on the same files; Auto on a lighter model',
      },
    ],
  },
]

export const surfaceOf = (surface: Surface) => SURFACES.find((one) => one.value === surface) ?? SURFACES[0]!

export interface Proto {
  readonly surface: Surface
  readonly direction: Direction
  /** No strip under the window: for screenshots. */
  readonly bare: boolean
  /** The parent's hold on the task its lead started, while held. */
  readonly childHeld: boolean
  /** Calls the person answered on the page, by id. */
  readonly answered: Readonly<Record<string, 'allowed' | 'refused'>>
  /** Servers and skills switched off on the page, by id; and roles taken off. */
  readonly off: ReadonlyArray<string>
  /** MCP: a week after sync was turned on. */
  readonly week: boolean
  /** Situations: the project with its coordinator off. */
  readonly coordinatorOff: boolean
}

let state: Proto = {
  surface: 'lineage',
  direction: 'A',
  bare: false,
  childHeld: false,
  answered: {},
  off: [],
  week: false,
  coordinatorOff: false,
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
  startOver: () => set({ childHeld: false, answered: {}, off: [], week: false, coordinatorOff: false }),
  toggle: (id: string) => set({ off: state.off.includes(id) ? state.off.filter((one) => one !== id) : [...state.off, id] }),
  answer: (id: string, how: 'allowed' | 'refused') => set({ answered: { ...state.answered, [id]: how } }),
}

export const useProto = () => useSyncExternalStore(proto.subscribe, proto.get)
