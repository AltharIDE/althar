import type { AgentStatus, AttentionRequest, StuckStep } from '@charrette/contracts'
import { Stuck, type StuckAttempt } from '@charrette/ui'

import type { StuckAnswer } from '../../data/client'
import { modelInfo } from '../../shared/agents'

/*
 * A step of the task's plan that needs the person (docs/architecture/05):
 * what went wrong, what Charrette tried, and the ways on. The lead's steps
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
        return 'Charrette restarted while this step was running.'
      case 'round_limit':
        return `Three rounds of review are done, and the lead's last changes haven't been reviewed.${
          stuck.open === 0 ? '' : stuck.open === 1 ? ' One finding is still open.' : ` ${stuck.open} findings are still open.`
        }`
      case 'not_connected':
        return "Charrette isn't connected to this repository's host, so it can't push the branch or open the pull request. Connect it, then try again."
      case 'usage_limit':
        return `${agent} reached its usage limit and didn't say when it resets.`
    }
  },
  /** For the pull request, which Charrette opens itself: what went wrong. */
  publishing: (stuck: StuckStep): string =>
    stuck.why === 'restarted'
      ? 'Charrette restarted while it was opening the pull request.'
      : `Charrette couldn't open the pull request.${stuck.detail === null ? '' : ` ${stuck.detail}`}`,
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
  const agent = agentName(stuck.agentId) || 'The agent'
  const tried: ReadonlyArray<StuckAttempt> = stuck.why === 'no_report' ? [{ id: 'reminded', ...text.reminded }] : []
  const review = stuck.step === 'review'
  // A review can run again on the agent it had; a lead's step goes to another.
  const others = agents.filter((candidate) => review || candidate.id !== stuck.agentId)
  const lastRound = stuck.why === 'round_limit'
  const out = stuck.why === 'usage_limit'
  // Opening the pull request is Charrette's own step: tried again as it was, or gone on without.
  if (stuck.step === 'publish')
    return (
      <Stuck
        step={text.step.publish}
        what={stuck.why === 'not_connected' ? text.what(stuck, agent) : text.publishing(stuck)}
        tried={[]}
        onAgain={() => onAnswer(request.id, { kind: 'retry', agentId: 'charrette' })}
        onAbandon={() => onAnswer(request.id, { kind: 'abandon' })}
        text={text.publish}
      />
    )
  return (
    <Stuck
      step={text.step[stuck.step]}
      what={text.what(stuck, agent)}
      tried={tried}
      agents={others
        .filter((candidate) => !out || candidate.id !== stuck.agentId)
        .map((candidate) => ({ model: modelInfo({ id: candidate.id, name: candidate.name }, null) }))}
      {...(review || out ? {} : { onTell: (note: string) => onAnswer(request.id, { kind: 'tell', note }) })}
      {...(out && stuck.agentId !== null ? { onAgain: () => onAnswer(request.id, { kind: 'retry', agentId: stuck.agentId ?? '' }) } : {})}
      onRetry={(model) => onAnswer(request.id, { kind: 'retry', agentId: model.runtime })}
      onAbandon={() => onAnswer(request.id, { kind: 'abandon' })}
      {...(out
        ? { text: { again: text.out.again(agent), tryingAgain: text.out.tryingAgain(agent) } }
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
