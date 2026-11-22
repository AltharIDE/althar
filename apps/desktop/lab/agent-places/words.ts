import { percent } from '../../../../packages/ui/src/chrome/LoadMeter/load'
import { isLowered, type Places, type Why, type Worker } from './data'

/*
 * What the takes say, as little as each needs. On screen an agent place is an
 * agent, as the slider already counts them ("Agents at once"); a computer the
 * home runs work on is a worker, as the person calls it and the plan card's
 * Run on already says ("Linux worker").
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Until when the number stays lowered: it comes back by itself. */
const UNTIL: Record<Why, string> = { memory: 'until memory frees up', cpu: 'until the CPU frees up' }

export const words = {
  agents: 'Agents',
  workers: 'Workers',
  otherWorkers: 'Other workers',
  runningHere: 'Running on This Mac',
  atOnce: 'Agents at once',
  offline: 'Offline',

  /** How many work, of the number. */
  of: (places: Places) => `${places.agents.length} of ${places.configured}`,

  /** The number lowered for now, and until when; null while it isn't. */
  lowered: (places: Places) => (isLowered(places) && places.why !== null ? `${places.atOnce} at a time ${UNTIL[places.why]}` : null),

  /** What waits for an agent, on any worker. */
  waiting: (n: number) => `${plural(n, 'task')} waiting`,

  /** A worker out of reach, and what waits for it. */
  away: (worker: Worker) => (worker.offline === null ? '' : `Offline for ${worker.offline.for}`),
  holding: (worker: Worker) =>
    worker.offline === null ? '' : `${plural(worker.offline.holding, 'task')} ${worker.offline.holding === 1 ? 'waits' : 'wait'} for it`,

  /** How hard it works, in a line. */
  load: (worker: Worker) => `CPU ${percent(worker.cpu)}% · Memory ${percent(worker.memory)}%`,

  /** A worker's line, problems first: out of reach, lowered for now, or how many of its agents work. */
  line: (worker: Worker) => {
    if (worker.offline !== null) return `${words.away(worker)} · ${words.holding(worker)}`
    return words.lowered(worker) ?? (worker.agents.length === 0 ? 'No agents at work' : `${words.of(worker)} agents at work`)
  },

  /** The default's mark on a worker's slider, by its name. */
  mark: (worker: Worker) => `${worker.machine.count} · default`,
}
