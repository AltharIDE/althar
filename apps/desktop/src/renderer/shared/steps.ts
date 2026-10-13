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
    // A conflict round's lead, once the task's steps are done: the conflict with its default branch, or the checks on the merge.
    conflict: 'Resolving a conflict',
    checks: 'Fixing the checks',
  } as Readonly<Record<string, string>>,
}

/** Whether a step is a conflict round's, after the plan's steps. */
export const afterSteps = (step: string | null) => step === 'conflict' || step === 'checks'

/** The names of the steps it takes. */
export const stepNames = (steps: ReadonlyArray<PlanStep>): ReadonlyArray<string> =>
  steps.filter((step) => !step.skipped).map((step) => stepText.label[step.key])

/** Which of those it is on, from the step's key: settling a review's findings, and what follows, are part of the review. */
export const stepIndex = (names: ReadonlyArray<string>, step: string | null): number =>
  step === null
    ? 0
    : afterSteps(step)
      ? Math.max(0, names.length - 1)
      : Math.max(0, names.indexOf(stepText.label[step === 'implement' ? 'implement' : 'review']))

/** Its track: every step done once it is, else done up to the one it is on. */
export const trackFor = (steps: ReadonlyArray<PlanStep>, step: string | null, done: boolean): TrackItem[] => {
  const names = stepNames(steps)
  const at = stepIndex(names, step)
  return trackOf(names, at, at, done)
}
