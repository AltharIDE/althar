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
    // A change the person hasn't seen yet, while its checks run (ADR-040).
    checks_running: 'Checks running',
    // Its pull request, as the person pressed Merge, until its host says it merged (data/merges).
    merging: 'Merging',
    // Its pull request in its branch's merge queue, until its host merges it or the queue takes it out (data/merges).
    merge_queue: 'In the merge queue',
  } as Readonly<Record<string, string>>,
  /** Stopped, no agent on it, as its card and its header say it: by what stopped its lead, where something says. */
  stopped: 'Stopped',
  stoppedBy: {
    declined: 'Stopped when you declined a command',
    interrupted: 'Stopped when you interrupted it',
    althar: 'Stopped by Althar',
  } satisfies Record<'declined' | 'interrupted' | 'althar', string>,
}

/** Whether a step comes after the plan's steps: a conflict round's, the checks of a change Althar sees through, or its merge. */
export const afterSteps = (step: string | null) =>
  step === 'conflict' || step === 'checks' || step === 'checks_running' || step === 'merging' || step === 'merge_queue'

/** Whether a task is being merged, or waits in its merge queue: its merge is no step of its plan's, so its planned steps are all done, none on. */
export const isMergeStep = (step: string | null) => step === 'merging' || step === 'merge_queue'

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
  return trackOf(names, at, at, done || isMergeStep(step))
}
