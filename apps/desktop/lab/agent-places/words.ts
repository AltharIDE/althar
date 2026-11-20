import { device } from '@althar/ui/device'

import type { Held, Places, Role, Why } from './data'

/*
 * The words every direction shares: how many places are in use, the number
 * lowered for a while and why, and who holds a place.
 */

const until: Record<Why, string> = {
  memory: 'until memory frees up',
  cpu: 'until the CPU frees up',
}

/** Why, as a sentence of its own. */
const because: Record<Why, string> = {
  memory: `${device.This} is short of memory.`,
  cpu: `${device.This}’s CPU is fully in use.`,
}

const roleWords: Record<Role, [string, string]> = {
  lead: ['Lead', 'leads'],
  reviewer: ['Reviewer', 'reviewers'],
  helper: ['Helper', 'helpers'],
}

export const words = {
  title: 'Agents at once',
  machine: device.This,
  atWork: (busy: number, of: number) => `${busy} of ${of} at work`,
  /** Short: in a heading or a bar. */
  short: (places: Places) => (places.why === null ? `${places.held.length} of ${places.configured}` : `${places.atOnce} for now`),
  lowered: (places: Places) => (places.why === null ? null : `Lowered to ${places.atOnce} ${until[places.why]}`),
  because: (places: Places) => (places.why === null ? null : because[places.why]),
  /** The rest of Up next, while the number is lowered. */
  startsAs: (places: Places) =>
    places.why === null ? null : `Up next starts as it ${places.why === 'memory' ? 'frees up' : 'calms down'}.`,
  /** The banner's title, while the number is lowered. */
  oneAtATime: (places: Places) => `${places.atOnce === 1 ? 'One agent' : `${places.atOnce} agents`} at a time for now`,
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
  change: 'Change',
  free: (n: number) => (n === 1 ? '1 free' : `${n} free`),
  waiting: (n: number) => (n === 1 ? '1 task waits' : `${n} tasks wait`),
  inUse: 'At work now',
  nothing: 'No agent is at work.',
}

/** Each task holding places, in the order its first place was taken, with every agent of it. */
export const tasksOf = (held: readonly Held[]) => {
  const tasks = new Map<string, Held[]>()
  for (const one of held) tasks.set(one.taskId, [...(tasks.get(one.taskId) ?? []), one])
  return [...tasks.values()]
}
