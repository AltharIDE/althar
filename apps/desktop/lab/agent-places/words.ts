import { device } from '@althar/ui/device'

import type { Held, Places, Role, Waiting, Why, Worker } from './data'

/*
 * The words the takes share: how many agents work and how many can, a
 * computer's number lowered for a while and why, one out of reach, the
 * cloud's month, what waits, and who holds a place. On screen a worker is a
 * computer, or Althar Cloud: the glossary keeps "worker" off the screen.
 */

const until: Record<Exclude<Why, 'cap'>, string> = {
  memory: 'until memory frees up',
  cpu: 'until the CPU frees up',
}

const roleWords: Record<Role, [string, string]> = {
  lead: ['Lead', 'leads'],
  reviewer: ['Reviewer', 'reviewers'],
  helper: ['Helper', 'helpers'],
}

const dollars = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`)
const pct = (share: number) => `${Math.round(Math.min(1, Math.max(0, share)) * 100)}%`
const tasks = (n: number) => (n === 1 ? '1 task' : `${n} tasks`)
const waitsForIt = (n: number) => (n === 1 ? '1 task waits for it' : `${n} tasks wait for it`)

export const words = {
  title: 'Agents at once',
  machine: device.This,
  gauge: 'AGENTS',
  agents: 'Agents',
  /** Every place across the computers: at work, and free to start in now, which a lowered number takes from. */
  pool: (busy: number, free: number) => `${busy} at work · ${free === 0 ? 'none' : free} free`,
  /** A computer's count: its places in use, or as last seen while out of reach. */
  countOf: (one: Worker) =>
    one.away !== null ? `${one.places.held.length} when last seen` : `${one.places.held.length} of ${one.places.configured}`,
  /**
   * What is off with a computer, as a line of its own: out of reach, fewer for a while, the cloud's month spent; null
   * where nothing is. With what waits for it alone, where nothing else on screen says so.
   */
  stateOf: (one: Worker, withWaits = false) => {
    const waits = withWaits && one.pinned.length > 0 ? ` · ${waitsForIt(one.pinned.length)}` : ''
    if (one.away !== null) return `Out of reach since ${one.away.since}${waits}`
    const { why, atOnce } = one.places
    if (why === 'cap' && one.spend !== null)
      return `${dollars(one.spend.spent)} of ${dollars(one.spend.cap)} spent · closed until ${one.spend.resets}`
    if (why === 'memory' || why === 'cpu') return `Lowered to ${atOnce} ${until[why]}${waits}`
    return null
  },
  /** The same, in a few words, for a row's end. */
  stateShort: (one: Worker) => {
    if (one.away !== null) return 'Out of reach'
    const { why, atOnce } = one.places
    if (why === 'cap' && one.spend !== null) return `Closed until ${one.spend.resets}`
    if (why === 'memory' || why === 'cpu') return `${atOnce} at a time for now`
    return null
  },
  /** How hard a computer works, where nothing is off with it: its CPU and memory; the cloud's month in its place. */
  quietOf: (one: Worker) => {
    if (one.spend !== null) return `${dollars(one.spend.spent)} of ${dollars(one.spend.cap)} this month`
    if (one.load === null) return null
    return `${one.kind === 'this' ? '' : `${one.what} · `}CPU ${pct(one.load.cpu)} · Memory ${pct(one.load.memory)}`
  },
  lowered: (places: Places) =>
    places.why === null ? null : places.why === 'cap' ? 'Closed for the month' : `Lowered to ${places.atOnce} ${until[places.why]}`,
  roles: (held: readonly Held[]) => {
    const counts = new Map<Role, number>()
    for (const one of held) counts.set(one.role, (counts.get(one.role) ?? 0) + 1)
    return [...counts.entries()]
      .map(([role, n], i) => {
        const [one, many] = roleWords[role]
        const name = n === 1 ? one : `${n} ${many}`
        return i === 0 ? name : name.toLowerCase()
      })
      .join(', ')
  },
  starting: 'Starting',
  places: (n: number) => (n === 1 ? '1 place' : `${n} places`),
  /** What waits, in a line under the count. */
  waitLine: (waiting: readonly Waiting[]) =>
    waiting.length === 0
      ? null
      : `${tasks(waiting.length)} waiting${waiting.length > 1 ? `, the longest ${Math.max(...waiting.map((one) => one.minutes))} min` : ''}`,
  /** Why a task waits, at its row's end, where it is one computer: the rest wait for any place to free up, as the list says. */
  waitsWhy: (one: Waiting) => (one.only === null ? null : `Waits for ${one.only.worker}`),
  waitsFor: (name: string) => `Waits for ${name}`,
  minutes: (n: number) => `${n} min`,
  running: 'Running',
  waiting: 'Waiting',
  otherComputers: 'Other computers',
  addComputer: 'Add a computer…',
  atOnceMenu: 'Agents at once…',
  /** The cloud, offered where work waits and no cloud is linked; or its cap, once spent. */
  offerTitle: 'Run what waits in Althar Cloud…',
  raiseTitle: 'Raise Althar Cloud’s cap…',
  offerNote: (waiting: readonly Waiting[]) => `${tasks(waiting.length)} could start now, within a cap you set`,
  raiseNote: (waiting: readonly Waiting[], resets: string) => `${tasks(waiting.length)} waiting · closed until ${resets}`,
  moreTitle: 'Let Althar Cloud run more at once…',
  moreNote: (waiting: readonly Waiting[], month: string) => `${tasks(waiting.length)} waiting · ${month}`,
  runInCloud: 'Run in cloud',
  nothing: 'No agent is at work.',
  showMeter: 'Show agents and load in the bar',
  cpu: 'CPU',
  memory: 'Memory',
}

/** Each task holding places, in the order its first place was taken, with every agent of it. */
export const tasksOf = (held: readonly Held[]) => {
  const tasks = new Map<string, Held[]>()
  for (const one of held) tasks.set(one.taskId, [...(tasks.get(one.taskId) ?? []), one])
  return [...tasks.values()]
}
