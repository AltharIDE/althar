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
  step: { implement: 'Implement', review: 'Review', settle: 'Settle' } satisfies Record<StuckStep['step'], string>,
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
    }
  },
  reminded: { what: 'Reminded it to report', result: 'its turn ended again without a report' },
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
  return (
    <Stuck
      step={text.step[stuck.step]}
      what={text.what(stuck, agent)}
      tried={tried}
      agents={others.map((candidate) => ({ model: modelInfo({ id: candidate.id, name: candidate.name }, null) }))}
      {...(review ? {} : { onTell: (note: string) => onAnswer(request.id, { kind: 'tell', note }) })}
      onRetry={(model) => onAnswer(request.id, { kind: 'retry', agentId: model.runtime })}
      onAbandon={() => onAnswer(request.id, { kind: 'abandon' })}
      {...(review
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
