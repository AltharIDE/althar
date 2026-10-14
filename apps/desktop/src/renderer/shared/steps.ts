import type { PlanStep } from '@althar/contracts'
import { type TrackItem, trackOf } from '@althar/ui'

/*
 * A task's steps as its card and its header show them: the plan's steps,
 * less any it skips, and the one it is on.
 */

export const stepText = {
  label: { implement: 'Implement', review: 'Review' } satisfies Record<PlanStep['key'], string>,
  /** A round of work after its plan, in place of Implement (ADR-034), and what it does there. */
  followUp: 'Follow-up',
  followingUp: 'Following up',
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

/** The names of the steps it takes: on a round of work after its plan (ADR-034), its lead's follow-up in place of Implement. */
export const stepNames = (steps: ReadonlyArray<PlanStep>, followUp = false): ReadonlyArray<string> =>
  steps.filter((step) => !step.skipped).map((step) => (followUp && step.key === 'implement' ? stepText.followUp : stepText.label[step.key]))

/** Which of those it is on, from the step's key: settling a review's findings, and what follows, are part of the review; a conflict round's is the last. */
export const stepIndex = (names: ReadonlyArray<string>, step: string | null): number =>
  step === null || step === 'implement'
    ? 0
    : afterSteps(step)
      ? Math.max(0, names.length - 1)
      : Math.max(0, names.indexOf(stepText.label.review))

/** Its track: every step done once it is, else done up to the one it is on. */
export const trackFor = (steps: ReadonlyArray<PlanStep>, step: string | null, done: boolean, followUp = false): TrackItem[] => {
  const names = stepNames(steps, followUp)
  const at = stepIndex(names, step)
  return trackOf(names, at, at, done)
}
