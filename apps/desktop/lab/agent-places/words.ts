import { percent } from '../../../../packages/ui/src/chrome/LoadMeter/load'
import { isLowered, type Places, type Runners, type Why, type Worker } from './data'

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
  otherComputers: 'Other computers',
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
  add: 'Add a computer',
  addTitle: (home: string) => `Add a computer to ${home}`,
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

  /* ---- what each is, and where ---- */

  /** The groups of Computers, where the take heads them. */
  yours: 'Your computers',
  cloud: 'Althar Cloud',

  /* ---- a home hosted in Althar Cloud ---- */

  alwaysOn: 'Always on',
  storage: 'Storage',
  storageFigure: (used: number, room: number) => `${used} GB of ${room} GB`,
  projects: (n: number) => plural(n, 'project'),
  region: 'Region',
  /** Agents at work across the home's runners and computers, and what waits or how many more could start. */
  atWork: (n: number) => `${n} at work`,
  room: (n: number) => `Room for ${n} more`,

  /* ---- cloud runners ---- */

  runners: 'Cloud runners',
  runnersAtOnce: 'Runners at once',
  /** The runners' count, beside the big figure. */
  runnersOf: (runners: Runners) => `of ${runners.atOnce} runners`,
  runnersFigure: (runners: Runners) => `${runners.running.length} of ${runners.atOnce}`,
  runnersNow: (runners: Runners) => (runners.running.length === 0 ? 'None running' : `${runners.running.length} running`),
  autoTitle: 'Start one when a task would wait',
  autoNote: 'Off, a runner starts only from a task’s Run in cloud.',
  /** How a runner starts, at a glance. */
  starts: (runners: Runners) => (runners.auto ? 'Starts when a task would wait' : 'Starts from Run in cloud'),
  thisMonth: 'This month',
  spend: (runners: Runners) => (runners.limit === null ? dollars(runners.spent) : `${dollars(runners.spent)} of ${dollars(runners.limit)}`),
  resets: 'Resets on 1 December',
  limitTitle: 'Monthly limit',
  limitNote: 'At the limit no runner starts; those at work finish.',
  noLimit: 'No limit',
  dollars,
  each: 'Each runner',
  signedIn: 'With the home’s sign-ins',
  more: (n: number) => `and ${n} more`,
  running: 'Running',
  stopRunners: 'Stop using cloud runners',
  /** A runner's line: its project and how long it has run. */
  run: (project: string, time: string) => `${project} · ${time}`,
}
