/**
 * Which action on a task's outputs is on its way to the runtime: one at a
 * time, as Changes serialises them per task. Its pull requests' actions are
 * told apart by the address, so only the button pressed shows as busy.
 */
export type Doing = string

export const doing = {
  push: (url: string): Doing => `push:${url}`,
  replace: (url: string): Doing => `replace:${url}`,
  bringIn: (url: string): Doing => `bring-in:${url}`,
  markReady: (url: string): Doing => `ready:${url}`,
  /** Each of its drafts, in turn. */
  markAllReady: 'ready-all',
  openChange: 'open',
  accept: 'accept',
  mergeHere: 'merge-here',
  pushHere: 'push-here',
  pushBranch: 'push-branch',
  markDone: 'mark-done',
  keep: 'keep',
  ship: 'ship',
  fixAfterMerge: 'fix-after-merge',
  /** Merge, with commits not shipped: Review and merge, or Merge now. */
  leaveAfterMerge: 'leave-after-merge',
} as const

/** Whether the task's merge is something to say of on its issue: it ends in a pull request, or has one open, and isn't over. */
export const issuePartShown = (task: {
  state: string
  end?: 'draft' | 'ready' | 'none' | null
  changes: ReadonlyArray<{ state: 'open' | 'merged' | 'closed' }>
}): boolean =>
  task.state !== 'done' &&
  task.state !== 'abandoned' &&
  (task.end === 'draft' || task.end === 'ready' || task.changes.some((change) => change.state === 'open'))
