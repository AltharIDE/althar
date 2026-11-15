import { TaskStatus } from '@althar/ui'

import { ChainLine, waitWords, WaitsLine } from '../pieces'
import { direction, useStore, useWorld, worldNow } from '../state'
import { TASKS } from '../world'

/*
 * What a task's page takes from the lab (patches.ts): its header says what it
 * waits for, as each direction words it; under the header, A shows what it
 * waits for, to change, and B what it comes after and what comes after it.
 * C adds nothing: it's set by telling the coordinator.
 */

const taskOf = (slug: string | undefined) => {
  const key = TASKS.find((one) => one.slug === slug)?.key
  return key === undefined ? undefined : worldNow().byKey.get(key)
}

/** What its header says while it waits for other tasks. */
export const labHeaderOf = (slug: string): { status: TaskStatus; state: string; why?: string } | null => {
  const task = taskOf(slug)
  const words = task === undefined ? null : waitWords(worldNow(), task)
  if (words === null) return null
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
