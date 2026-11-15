import { shipsToOpen, type ThreadSnapshot } from '@althar/contracts'

/** Committed work for the first or next pull request, sent through the task's review and ending by Ship. */
export const commitsToShip = (task: Pick<ThreadSnapshot['task'], 'end' | 'changes' | 'commits' | 'unshipped'>): number => {
  // unshipped counts only workspaces without an open pull request; a sibling's open pull request does not publish these.
  const commits = task.changes.length === 0 ? task.commits : (task.unshipped?.commits ?? 0)
  return shipsToOpen({ end: task.end, open: false, commits }) ? commits : 0
}
