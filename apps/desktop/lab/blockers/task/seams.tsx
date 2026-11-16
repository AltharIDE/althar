import { TaskStatus } from '@althar/ui'

import { ChainLine, waitWords, WaitsLine } from '../pieces'
import { direction, option, useStore, useWorld, worldNow } from '../state'
import { openBlockers, TASKS } from '../world'

export { LabBehind } from './composer'
export { LabThreadEnd } from './end'
export { labBesideOf, labStateOf } from './header'

/*
 * What a task's page takes from the lab (patches.ts): its header says what it
 * waits for, as the board's row does; then each way the bar picks (A on the
 * composer, B in the thread, C its plan in the thread, D from the header)
 * puts its part where it goes. Under the header, the board's other
 * directions (`?d=A`, `?d=B`) still show their lines.
 */

const taskOf = (slug: string | undefined) => {
  const key = TASKS.find((one) => one.slug === slug)?.key
  return key === undefined ? undefined : worldNow().byKey.get(key)
}

/** What its header says while it waits for other tasks: as its row does; once one of them is abandoned, that it needs you. */
export const labHeaderOf = (slug: string): { status: TaskStatus; state: string; why?: string } | null => {
  const task = taskOf(slug)
  const words = task === undefined ? null : waitWords(worldNow(), task)
  if (words === null || task === undefined) return null
  if (openBlockers(worldNow(), task).some((one) => one.phase === 'abandoned')) return { status: TaskStatus.Yours, state: 'Needs you' }
  // In C its plan card under the brief says what it waits for: the header doesn't say it again.
  if (option.task.get() === 'c') return { status: TaskStatus.Queued, state: task.held ? 'Held' : 'Waiting' }
  return { status: TaskStatus.Queued, state: words.state, ...(words.why === undefined ? {} : { why: words.why }) }
}

/** A line under the header, in A and B. */
export function LabUnderHeader({ slug }: { slug: string }) {
  useWorld()
  const picked = useStore(direction)
  const task = taskOf(slug)
  if (task === undefined) return null
  if (picked === 'a') return <WaitsLine task={task} />
  if (picked === 'b') return <ChainLine task={task} />
  return null
}
