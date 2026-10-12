/**
 * Which action on a task's outputs is on its way to the runtime: one at a
 * time, as Changes serialises them per task. Its pull requests' actions are
 * told apart by the address, so only the button pressed shows as busy.
 */
export type Doing = string

export const doing = {
  push: (url: string): Doing => `push:${url}`,
  markReady: (url: string): Doing => `ready:${url}`,
  openChange: 'open',
  accept: 'accept',
  mergeHere: 'merge-here',
  pushHere: 'push-here',
  pushBranch: 'push-branch',
} as const
