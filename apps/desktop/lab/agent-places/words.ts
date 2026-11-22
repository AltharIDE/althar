import { percent } from '../../../../packages/ui/src/chrome/LoadMeter/load'
import { isLowered, type Places, type Why, type Worker } from './data'

/*
 * What the lab says, as little as each place needs. On screen an agent place
 * is an agent, as the slider already counts them ("Agents at once"); a
 * computer the home runs work on is a worker, as the person calls it and the
 * plan card's Run on already says ("Linux worker"); the home is where the
 * projects live, as the Homes chip already says.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Until when the number stays lowered: it comes back by itself. */
const UNTIL: Record<Why, string> = { memory: 'until memory frees up', cpu: 'until the CPU frees up' }

export const words = {
  agents: 'Agents',
  workers: 'Workers',
  otherWorkers: 'Other workers',
  runningOn: (name: string) => `Running on ${name}`,
  atOnce: 'Agents at once',
  offline: 'Offline',
  home: 'Home',

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

  /* ---- Settings ---- */

  /** What the computer is. */
  computer: (worker: Worker) => `${worker.system} · ${worker.machine.cores} cores · ${worker.machine.memory} GB`,
  /** Taking no new tasks: what runs there finishes. */
  notTaking: 'Takes no new tasks',
  takeTitle: 'Take new tasks',
  takeNote: 'Off, what runs there finishes and nothing new starts.',
  add: 'Add a worker',
  addTitle: (home: string) => `Add a worker to ${home}`,
  addNote: 'Run this on the computer you’re adding.',
  addWaiting: 'Waiting for it to join…',
  remove: 'Remove this worker',
  /** This Mac lent to a home it isn't: one of its workers too. */
  lend: (home: string) => `Run ${home}’s tasks on This Mac`,
  lendNote: 'This Mac’s agents at once are shared with this computer’s own projects.',
  update: (version: string) => `Update to ${version}`,
  facts: {
    computer: 'Computer',
    address: 'Address',
    agents: 'Signed in',
    version: 'Althar',
    devices: 'Opened from',
  },
  /** The devices a home on a server is opened from. */
  devices: 'This Mac · iPhone, 2 days ago',
  /** The home, in a line: what it keeps. */
  homeNote: (home: Worker) =>
    home.here ? 'Keeps your projects and runs the coordinator' : `Keeps these projects and runs the coordinator`,
}
