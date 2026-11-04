// Scrappy: each task's snapshot, made once: read again, its items keep their ids, so the thread doesn't take them for new ones.
import type { ThreadSnapshot } from '../../../contracts/src/index'

import { type TaskKey, TASKS } from './data'

const SNAPSHOTS: Record<string, ThreadSnapshot> = Object.fromEntries(
  (Object.keys(TASKS) as TaskKey[]).map((key) => [TASKS[key].threadId, TASKS[key].snapshot()]),
)

export const snapshotOf = (threadId: string): ThreadSnapshot | null => SNAPSHOTS[threadId] ?? null
export const findingsOf = (taskId: string) => Object.values(TASKS).find((one) => one.taskId === taskId)?.findings ?? []
