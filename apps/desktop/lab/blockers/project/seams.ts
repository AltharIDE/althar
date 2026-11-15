import { waitWords } from '../pieces'
import { worldNow } from '../state'

/* What the coordinator's card of a waiting task says where its countdown was, as each direction words it (patches.ts). */

export const labQueuedOf = (taskId: string): { queued?: string } => {
  const task = taskId.startsWith('t_') ? worldNow().byKey.get(taskId.slice(2)) : undefined
  const words = task === undefined ? null : waitWords(worldNow(), task)
  return words === null ? {} : { queued: words.row }
}
