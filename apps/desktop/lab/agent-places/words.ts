import { closedOf, type Doing, freeOf, isLowered, type Places, type Role, type Why } from './data'

/*
 * What the takes say. On screen an agent place is an agent, as the slider
 * already counts them ("Agents at once"); the board's "agent places" goes.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const WHY: Record<Why, string> = { memory: 'memory is short', cpu: 'the CPU is busy' }
const ROLE: Record<Role, string> = { lead: 'Lead', reviewer: 'Reviewer', helper: 'Helper' }
const DOING: Record<Doing, string> = { starting: 'Starting', turn: 'In a turn', background: 'Running tests' }

export const words = {
  agents: 'Agents',
  gauge: 'AGENTS',
  thisMac: 'This Mac',
  atOnce: 'Agents at once',

  /** How many work, of the number. */
  atWork: (places: Places) => `${places.agents.length} of ${places.configured} at work`,
  /** The same, said beside the computer's name. */
  ofAgents: (places: Places) => `${places.agents.length} of ${plural(places.configured, 'agent')}`,
  /** How many work, alone. */
  working: (places: Places) => `${places.agents.length} at work`,

  /** The number lowered for now, and why, as a line of its own; null while it isn't. */
  lowered: (places: Places) =>
    isLowered(places) && places.why !== null ? `Lowered to ${places.atOnce} for now: ${WHY[places.why]}` : null,
  /** The same, short, where room is small. */
  forNow: (places: Places) => (isLowered(places) && places.why !== null ? `${places.atOnce} for now: ${WHY[places.why]}` : null),
  /** What happens while it is lowered. */
  loweredNext: (places: Places) => (places.why === 'memory' ? 'More start as memory frees up.' : 'More start as the CPU calms down.'),

  /** What waits for an agent. */
  waiting: (n: number) => `${plural(n, 'task')} waiting`,
  /** The rest of the number, past those at work: free, or closed for now. */
  rest: (places: Places) => {
    const free = freeOf(places)
    const closed = closedOf(places)
    if (closed > 0 && places.why !== null) return `${closed} closed for now · ${WHY[places.why]}`
    if (free > 0) return `${free} free`
    return null
  },

  /** A task's agents: their parts in it, and what they do. */
  roles: (roles: readonly Role[], doing: Doing) => {
    const named = [...new Set(roles)].map((role, i) => (i === 0 ? ROLE[role] : ROLE[role].toLowerCase()))
    return `${named.join(' and ')} · ${DOING[doing]}`
  },

  /** Up next's one line, where it keeps one: lowered, or every agent at work; null with room. */
  upNext: (places: Places) => {
    if (isLowered(places) && places.why !== null) return `${places.atOnce} at a time for now · ${WHY[places.why]}`
    if (freeOf(places) === 0) return `All ${places.configured} agents at work`
    return null
  },

  /** Under the slider, in take C: what works now, then the number's own line. */
  sliderWork: (places: Places, waiting: number) =>
    [`${places.agents.length} at work`, waiting > 0 ? `${waiting} waiting` : null].filter(Boolean).join(', '),

  change: 'Change',
  otherApps: 'Other apps',
  running: 'Running',
  atWorkHead: 'At work',
  waitingHead: 'Waiting',
  nothing: 'No agent at work',
  showMeter: 'Show agents and load in the bar',
}
