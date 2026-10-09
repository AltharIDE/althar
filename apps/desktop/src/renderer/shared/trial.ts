/*
 * TEMPORARY, while the person picks a task header (October 2026): which one
 * the window draws, from this window's storage. `now` is the header as it was.
 * Goes with the two not picked.
 */

export type HeaderTrial = 'now' | 'line' | 'bar' | 'opening'

const TRIALS: ReadonlyArray<HeaderTrial> = ['now', 'line', 'bar', 'opening']

export const headerTrial = (): HeaderTrial => {
  try {
    const kept = window.localStorage.getItem('althar.trial.header')
    return TRIALS.find((trial) => trial === kept) ?? 'now'
  } catch {
    return 'now'
  }
}

/** TEMPORARY, likewise: where the window offers to connect a project's code host. `now` is the line above the composer. */
export type GithubTrial = 'now' | 'end' | 'once' | 'bar'

const GITHUB: ReadonlyArray<GithubTrial> = ['now', 'end', 'once', 'bar']

export const githubTrial = (): GithubTrial => {
  try {
    const kept = window.localStorage.getItem('althar.trial.github')
    return GITHUB.find((trial) => trial === kept) ?? 'now'
  } catch {
    return 'now'
  }
}
