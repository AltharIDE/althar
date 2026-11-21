import { device } from '@althar/ui/device'

import type { Held, Places, Role, Why } from './data'

/*
 * The words the takes share: how many places are in use, the number
 * lowered for a while and why, and who holds a place.
 */

const until: Record<Why, string> = {
  memory: 'until memory frees up',
  cpu: 'until the CPU frees up',
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
  lowered: (places: Places) => (places.why === null ? null : `Lowered to ${places.atOnce} ${until[places.why]}`),
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
  /** A place in use past a lowered number: it closes once its agent is done. */
  closesAfter: 'Closes when done',
  freePlace: 'Free',
  closedPlace: (places: Places) => (places.why === null ? 'Closed' : `Closed ${until[places.why]}`),
  places: (n: number) => (n === 1 ? '1 place' : `${n} places`),
  change: 'Change',
  inUse: 'At work now',
  nothing: 'No agent is at work.',
}

/** Each task holding places, in the order its first place was taken, with every agent of it. */
export const tasksOf = (held: readonly Held[]) => {
  const tasks = new Map<string, Held[]>()
  for (const one of held) tasks.set(one.taskId, [...(tasks.get(one.taskId) ?? []), one])
  return [...tasks.values()]
}
