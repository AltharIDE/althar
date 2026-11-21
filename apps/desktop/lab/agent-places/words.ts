import { device } from '@althar/ui/device'

import type { Held, Places, Role, Why, Worker } from './data'

/*
 * The words the takes share: how many places are in use, a worker's number
 * lowered for a while and why, a worker out of reach, a cloud's month, and
 * who holds a place.
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
const tasks = (n: number) => (n === 1 ? '1 task waits for it' : `${n} tasks wait for it`)

export const words = {
  title: 'Agents at once',
  machine: device.This,
  atWork: (busy: number, of: number) => `${busy} of ${of} at work`,
  /** A worker's count: its places in use, or as last seen while out of reach. */
  countOf: (one: Worker) =>
    one.away !== null
      ? `${one.places.held.length} at work when last seen`
      : `${one.places.held.length} of ${one.places.configured} at work`,
  /** The count, as short as a row's end has room for. */
  shortCount: (one: Worker) => (one.away !== null ? '—' : `${one.places.held.length} of ${one.places.configured}`),
  lowered: (places: Places) =>
    places.why === null ? null : places.why === 'cap' ? 'Closed for the month' : `Lowered to ${places.atOnce} ${until[places.why]}`,
  /** What is off with a worker, as a line of its own: out of reach, fewer for a while, a cloud's month spent; null where nothing is. */
  stateOf: (one: Worker) => {
    const waits = one.pinned.length > 0 ? ` · ${tasks(one.pinned.length)}` : ''
    if (one.away !== null) return `Out of reach since ${one.away.since}${waits}`
    const { why, atOnce } = one.places
    if (why === 'cap' && one.spend !== null)
      return `${dollars(one.spend.spent)} of ${dollars(one.spend.cap)} spent · closed until ${one.spend.resets}`
    if (why === 'memory' || why === 'cpu') return `Lowered to ${atOnce} ${until[why]}${waits}`
    return null
  },
  /** The same, in a few words, for a row's end or a menu's hint; a cloud's month where nothing is off. */
  stateShort: (one: Worker) => {
    if (one.away !== null) return 'Out of reach'
    const { why, atOnce } = one.places
    if (why === 'cap' && one.spend !== null) return `Closed until ${one.spend.resets}`
    if (why === 'memory' || why === 'cpu') return `${atOnce} at a time for now`
    return null
  },
  /** A cloud's month, while it has some left. */
  spend: (one: Worker) =>
    one.spend === null || one.places.why === 'cap' ? null : `${dollars(one.spend.spent)} of ${dollars(one.spend.cap)} this month`,
  spendShort: (one: Worker) => (one.spend === null ? null : `${dollars(one.spend.spent)} of ${dollars(one.spend.cap)}`),
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
  lastSeen: 'Last seen',
  places: (n: number) => (n === 1 ? '1 place' : `${n} places`),
  workers: (n: number) => (n === 1 ? '1 worker' : `${n} workers`),
  /** Every place that can be counted, across the workers. */
  pool: (busy: number, of: number, workers: number) => `${busy} of ${of} at work${workers > 1 ? ` on ${workers} workers` : ''}`,
  waitsFor: (name: string) => `Waits for ${name}`,
  change: 'Change',
  raiseCap: 'Raise the cap',
  inUse: 'At work now',
  waiting: 'Waiting for a worker',
  workersTitle: 'Workers',
  addWorker: 'Add a worker…',
  nothing: 'No agent is at work.',
}

/** Each task holding places, in the order its first place was taken, with every agent of it. */
export const tasksOf = (held: readonly Held[]) => {
  const tasks = new Map<string, Held[]>()
  for (const one of held) tasks.set(one.taskId, [...(tasks.get(one.taskId) ?? []), one])
  return [...tasks.values()]
}
