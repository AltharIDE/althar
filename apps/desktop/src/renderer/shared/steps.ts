import type { PlanStep } from '@althar/contracts'
import { type TrackItem, trackOf } from '@althar/ui'

/*
 * A task's steps as its card and its header show them: the plan's steps,
 * less any it skips, and the one it is on.
 */

export const stepText = {
  label: { implement: 'Implement', review: 'Review' } satisfies Record<PlanStep['key'], string>,
  /** What it does while on a step, by the step's key. */
  now: {
    implement: 'Implementing',
    review: 'Reviewing',
    settle: 'Settling the review',
    publish: 'Opening the pull request',
  } as Readonly<Record<string, string>>,
}

/** The names of the steps it takes. */
export const stepNames = (steps: ReadonlyArray<PlanStep>): ReadonlyArray<string> =>
  steps.filter((step) => !step.skipped).map((step) => stepText.label[step.key])

/** Which of those it is on, from the step's key: settling a review's findings, and what follows, are part of the review. */
export const stepIndex = (names: ReadonlyArray<string>, step: string | null): number =>
  step === null ? 0 : Math.max(0, names.indexOf(stepText.label[step === 'implement' ? 'implement' : 'review']))

/** Its track: every step done once it is, else done up to the one it is on. */
export const trackFor = (steps: ReadonlyArray<PlanStep>, step: string | null, done: boolean): TrackItem[] => {
  const names = stepNames(steps)
  const at = stepIndex(names, step)
  return trackOf(names, at, at, done)
}
