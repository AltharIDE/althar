import type { AgentStatus, AttentionRequest, StuckStep } from '@althar/contracts'
import { Stuck, type StuckAttempt } from '@althar/ui'

import type { StuckAnswer } from '../../data/client'
import { useModelNames } from '../../shared/modelNames'

/*
 * A step of the task's plan that needs the person (docs/architecture/05):
 * what went wrong, what Althar tried, and the ways on. The lead's steps
 * can be told what to do, handed to another agent, or abandoned; a review
 * can be run again, on the same agent or another, or gone on without.
 */

export const text = {
  step: { implement: 'Implement', review: 'Review', settle: 'Settle', publish: 'Pull request' } satisfies Record<StuckStep['step'], string>,
  what: (stuck: StuckStep, agent: string): string => {
    switch (stuck.why) {
      case 'no_report':
        return `${agent} ended its turn twice without saying the step is done.`
      case 'session_ended':
        return `${agent} stopped before the step was done.`
      case 'failed_to_start':
        return `${agent} couldn't start.${stuck.detail === null ? '' : ` ${stuck.detail}`}`
      case 'restarted':
        return 'Althar restarted while this step was running.'
      case 'round_limit':
        return `Three rounds of review are done, and the lead's last changes haven't been reviewed.${
          stuck.open === 0 ? '' : stuck.open === 1 ? ' One finding is still open.' : ` ${stuck.open} findings are still open.`
        }`
      case 'not_connected':
        return "Althar isn't connected to this repository's host, so it can't push the branch or open the pull request. Connect it, then try again."
      case 'usage_limit':
        return `${agent} reached its usage limit and didn't say when it resets.`
      case 'stalled':
        return `${agent} stopped showing any sign of work on this step.`
      case 'looping':
        return `${agent} kept running ${stuck.detail === null ? 'the same thing' : `\`${stuck.detail}\``} to the same end.`
      case 'over_budget':
        return `${agent} has worked on this step for ${stuck.detail ?? 'a long time'} since you last said anything, and isn't done.`
      case 'refused':
        return `${agent} declined to go on with this step.`
    }
  },
  /** What Althar did before it asked. */
  tried: (agent: string): Record<NonNullable<StuckStep['tried']>[number], { what: string; result: string }> => ({
    carried_on: { what: 'Stopped its turn and told it to carry on', result: 'it went quiet again' },
    restarted: { what: `Started ${agent} afresh`, result: 'it went quiet again' },
    redirected: { what: 'Told it to try another way', result: 'it went back to the same' },
  }),
  /** Tried again on the same agent: started again where it went quiet, or let go on where it ran long. */
  again: {
    stalled: { again: (agent: string) => `Start ${agent} again`, tryingAgain: (agent: string) => `Starting ${agent} again` },
    over_budget: { again: (agent: string) => `Let ${agent} carry on`, tryingAgain: (agent: string) => `${agent} carries on` },
  },
  /** For the pull request, which Althar opens itself: what went wrong. */
  publishing: (stuck: StuckStep): string =>
    stuck.why === 'restarted'
      ? 'Althar restarted while it was opening the pull request.'
      : `Althar couldn't open the pull request.${stuck.detail === null ? '' : ` ${stuck.detail}`}`,
  publish: {
    abandon: 'Go on without it',
    abandoned: 'Went on without it',
    abandonedNote: 'the task is ready on its branch',
  },
  reminded: { what: 'Reminded it to report', result: 'its turn ended again without a report' },
  /** An agent out of usage: told nothing, since it would hit the same limit; handed on, or tried again once it is back. */
  out: {
    again: (agent: string) => `Try ${agent} again`,
    tryingAgain: (agent: string) => `Trying ${agent} again`,
  },
  review: {
    retry: 'Review again',
    retryLabel: 'Review with',
    retried: (agent: string) => `Reviewing with ${agent}`,
    retriedNote: 'a new round starts',
    skip: 'Skip the review',
    skipped: 'Skipped the review',
    skippedNote: 'the task is ready without one',
    accept: 'Accept it as it is',
    accepted: 'Accepted as it is',
    acceptedNote: 'the task is ready without another review',
  },
}

export function StuckCall({
  request,
  stuck,
  agents,
  agentName,
  onAnswer,
}: {
  request: AttentionRequest
  stuck: StuckStep
  agents: ReadonlyArray<AgentStatus>
  agentName: (id: string | null) => string
  onAnswer: (attentionId: string, answer: StuckAnswer) => void
}) {
  const named = useModelNames()
  const agent = agentName(stuck.agentId) || 'The agent'
  const tried: ReadonlyArray<StuckAttempt> =
    stuck.why === 'no_report'
      ? [{ id: 'reminded', ...text.reminded }]
      : (stuck.tried ?? []).map((each) => ({ id: each, ...text.tried(agent)[each] }))
  const review = stuck.step === 'review'
  // A review can run again on the agent it had; a lead's step goes to another.
  const others = agents.filter((candidate) => review || candidate.id !== stuck.agentId)
  const lastRound = stuck.why === 'round_limit'
  const out = stuck.why === 'usage_limit'
  // Gone quiet, or long at it, a lead's agent can start again, or carry on; a review runs again by its own button.
  const again = stuck.why === 'stalled' || stuck.why === 'over_budget' ? text.again[stuck.why] : undefined
  // Opening the pull request is Althar's own step: tried again as it was, or gone on without.
  if (stuck.step === 'publish')
    return (
      <Stuck
        step={text.step.publish}
        what={stuck.why === 'not_connected' ? text.what(stuck, agent) : text.publishing(stuck)}
        tried={[]}
        onAgain={() => onAnswer(request.id, { kind: 'retry', agentId: 'althar' })}
        onAbandon={() => onAnswer(request.id, { kind: 'abandon' })}
        text={text.publish}
      />
    )
  return (
    <Stuck
      step={text.step[stuck.step]}
      what={text.what(stuck, agent)}
      tried={tried}
      agents={others.filter((candidate) => !out || candidate.id !== stuck.agentId).map((candidate) => ({ model: named(candidate.id) }))}
      {...(review || out ? {} : { onTell: (note: string) => onAnswer(request.id, { kind: 'tell', note }) })}
      {...((out || (again !== undefined && !review)) && stuck.agentId !== null
        ? { onAgain: () => onAnswer(request.id, { kind: 'retry', agentId: stuck.agentId ?? '' }) }
        : {})}
      onRetry={(model) => onAnswer(request.id, { kind: 'retry', agentId: model.runtime })}
      onAbandon={() => onAnswer(request.id, { kind: 'abandon' })}
      {...(out
        ? { text: { again: text.out.again(agent), tryingAgain: text.out.tryingAgain(agent) } }
        : again !== undefined && !review
          ? { text: { again: again.again(agent), tryingAgain: again.tryingAgain(agent) } }
          : review
            ? {
                text: {
                  retry: text.review.retry,
                  retryLabel: text.review.retryLabel,
                  retried: text.review.retried,
                  retriedNote: text.review.retriedNote,
                  abandon: lastRound ? text.review.accept : text.review.skip,
                  abandoned: lastRound ? text.review.accepted : text.review.skipped,
                  abandonedNote: lastRound ? text.review.acceptedNote : text.review.skippedNote,
                },
              }
            : {})}
    />
  )
}
