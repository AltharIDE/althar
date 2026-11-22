import { percent } from '../../../../packages/ui/src/chrome/LoadMeter/load'
import { isLowered, paceOf, type Places, RATE, type Runners, reachedOf, type Why, type Worker } from './data'

/*
 * What the lab says, as little as each place needs. An agent place is an
 * agent, as the slider already counts them ("Agents at once"). The home and
 * the computers it runs work on are computers: This Mac, studio, build-box.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const dollars = (n: number) => `$${n % 1 === 0 ? n : n.toFixed(2)}`

/** Until when the number stays lowered: it comes back by itself. */
const UNTIL: Record<Why, string> = { memory: 'until memory frees up', cpu: 'until the CPU frees up' }

export const words = {
  agents: 'Agents',
  computers: 'Computers',
  runningOn: (name: string) => `Running on ${name}`,
  atOnce: 'Agents at once',
  home: 'Home',

  /** How many work, of the number. */
  of: (places: Places) => `${places.agents.length} of ${places.configured}`,

  /** The number lowered for now, and until when; null while it isn't. */
  lowered: (places: Places) => (isLowered(places) && places.why !== null ? `${places.atOnce} at a time ${UNTIL[places.why]}` : null),

  /** What waits for an agent, on any computer. */
  waiting: (n: number) => `${plural(n, 'task')} waiting`,

  /** A computer out of reach, and what waits for it. */
  away: (worker: Worker) => (worker.offline === null ? '' : `Offline for ${worker.offline.for}`),
  holding: (worker: Worker) =>
    worker.offline === null ? '' : `${plural(worker.offline.holding, 'task')} ${worker.offline.holding === 1 ? 'waits' : 'wait'} for it`,

  /** How hard it works, in a line. */
  load: (worker: Worker) => `CPU ${percent(worker.cpu)}% · Memory ${percent(worker.memory)}%`,

  /** Where a computer stands, in a few words, problems first: for a tile, a module, a row. */
  state: (worker: Worker, taking: boolean) => {
    if (worker.offline !== null) return `Offline · ${worker.offline.for}`
    if (!taking) return worker.agents.length === 0 ? 'Paused' : `Paused · finishing ${worker.agents.length}`
    if (isLowered(worker)) return `${worker.atOnce} at a time for now`
    return worker.agents.length === 0 ? 'Idle' : `${words.of(worker)} agents`
  },

  /** The default's mark on a computer's slider. */
  mark: (worker: Worker) => `${worker.machine.count} · default`,

  /* ---- Settings ---- */

  /** What the computer is. */
  computer: (worker: Worker) => `${worker.system} · ${worker.machine.cores} cores · ${worker.machine.memory} GB`,
  takeTitle: 'Take new tasks',
  takeNote: 'Off, what runs there finishes and nothing new starts.',
  add: 'Add a worker',
  addTitle: (home: string) => `Add a worker to ${home}`,
  addNote: 'Run this on the computer you’re adding.',
  addWaiting: 'Waiting for it to join…',
  remove: (name: string) => `Remove ${name}`,
  /** This Mac lent to a home it isn't. */
  lend: (home: string) => `Run ${home}’s tasks on This Mac`,
  lendNote: 'Its agents at once are shared with your own projects.',
  update: (version: string) => `Update to ${version}`,
  facts: {
    computer: 'Computer',
    address: 'Address',
    agents: 'Signed in',
    version: 'Althar',
    devices: 'Opened from',
  },
  /** The devices a home on a server is opened from. */
  devices: 'This Mac, and an iPhone 2 days ago',

  /* ---- Computers' groups ---- */

  workers: 'Workers',
  cloudGroup: 'Cloud',
  cloud: 'Althar Cloud',

  /* ---- a home hosted in Althar Cloud ---- */

  alwaysOn: 'Always on',
  /** Agents at work across the home's workers and the cloud. */
  atWork: (n: number) => `${n} at work`,

  /* ---- Althar Cloud: what runs there, its use this month, its limit ---- */

  /** How it takes tasks, at a glance. */
  takes: (runners: Runners) => (runners.auto ? 'Runs tasks that would wait' : 'Runs tasks from Run in cloud'),
  runningNow: 'Running now',
  runningCount: (runners: Runners) => (runners.running.length === 0 ? 'Nothing running' : `${runners.running.length} running`),
  thisMonth: 'This month',
  spent: 'Spent',
  spend: (runners: Runners) => (runners.limit === null ? dollars(runners.spent) : `${dollars(runners.spent)} of ${dollars(runners.limit)}`),
  /** Under the spend: the limit reached, else where the month ends at this pace. */
  outlook: (runners: Runners) =>
    reachedOf(runners)
      ? 'At the limit: tasks wait for a worker'
      : runners.limit !== null && paceOf(runners) > runners.limit
        ? `At this pace, the limit by ${Math.max(23, Math.floor((runners.limit / runners.spent) * 22))} November`
        : `On pace for ${dollars(Math.round(paceOf(runners)))}`,
  resets: 'Resets on 1 December',
  hours: 'Hours',
  hoursFigure: (runners: Runners) => `${runners.hours} h`,
  tasksRun: 'Tasks',
  rate: 'Rate',
  rateFigure: `${dollars(RATE)} an hour a task`,
  daily: 'Each day',
  autoTitle: 'Run tasks here when they would wait',
  autoNote: 'Off, a task runs here only from its Run in cloud.',
  limitTitle: 'Monthly limit',
  limitNote: 'At the limit nothing new starts here; what runs finishes.',
  noLimit: 'No limit',
  dollars,
  more: (n: number) => `and ${n} more`,
  stopCloud: 'Stop using Althar Cloud',
  /** A task's line there: its project and how long it has run. */
  run: (project: string, time: string) => `${project} · ${time}`,
}
