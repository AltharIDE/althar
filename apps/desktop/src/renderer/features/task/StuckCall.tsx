import type { AgentStatus, AttentionRequest, StuckStep } from '@althar/contracts'
import { Stuck, type StuckAttempt } from '@althar/ui'
import { useState } from 'react'

import type { StuckAnswer } from '../../data/client'
import { useModelNames } from '../../shared/modelNames'
import { clock } from '../../shared/time'
import { LimitCall, limitText } from './LimitCall'

/*
 * A step of the task's plan that needs the person (docs/architecture/05):
 * what went wrong, what Althar tried, and the ways on. Every one can be
 * tried again on the agent it was on, in the session it was in: first,
 * where the connection or the session failed rather than the work (ADR-060).
 * The lead's steps can also be told what to do, handed to another agent, or
 * abandoned; a review can be run again on another agent, or gone on without.
 */

export const text = {
  step: { implement: 'Implement', review: 'Review', settle: 'Settle', publish: 'Pull request' } satisfies Record<StuckStep['step'], string>,
  what: (stuck: StuckStep, agent: string): string => {
    // A review has no lead to tell or carry on: it runs again, on this agent or another, or is skipped.
    const review = stuck.step === 'review'
    switch (stuck.why) {
      case 'no_report':
        return `${agent} stopped twice without saying whether the step is done, even after Althar reminded it. ${review ? 'Review again, or skip the review.' : 'Tell it what to do next, or hand the step to another agent.'}`
      case 'session_ended':
        return `${agent} closed before finishing the step. This is usually harmless: ${review ? 'try again, or skip the review.' : 'try again, or hand the step to another agent.'}`
      case 'transient':
        return `${stuck.service ?? agent}'s service kept failing${stuck.detail === null ? '.' : `: ${stuck.detail.replace(/\.?$/, '.')}`} ${review ? 'Try again, or review with another agent.' : 'Try again, or hand the step to another agent.'}`
      case 'failed_to_start':
        return `${agent} couldn't start.${stuck.detail === null ? '' : ` ${stuck.detail}`} Check that it's installed and signed in, or ${review ? 'review with another agent.' : 'hand the step to another agent.'}`
      case 'restarted':
        return `Althar restarted twice while this step was running, so it paused the step in case the step caused it. If you restarted Althar yourself, ${review ? 'review again.' : `start ${agent} again.`}`
      case 'round_limit':
        return `The work has been reviewed three times, and the lead's last changes haven't been reviewed yet.${
          stuck.open === 0 ? '' : stuck.open === 1 ? ' One finding is still open.' : ` ${stuck.open} findings are still open.`
        } Review it again, or accept it as it is.`
      case 'not_connected':
        return "Althar isn't connected to this repository's host, so it can't push the branch or open the pull request. Connect it, then press Try again."
      case 'usage_limit':
        return limitText.what(agent, stuck.limit?.resetsAt == null ? null : clock(stuck.limit.resetsAt), stuck.step, stuck.limit?.left)
      case 'stalled':
        return `${agent} has gone quiet: there has been no sign of work on this step for a while. ${review ? 'Review again, or skip the review.' : 'Start it again, or hand the step to another agent.'}`
      case 'looping':
        return `${agent} kept running ${stuck.detail === null ? 'the same thing' : `\`${stuck.detail}\``} and got the same result each time. ${review ? 'Review again, or skip the review.' : 'Tell it to try something else, or hand the step to another agent.'}`
      case 'over_budget':
        return `${agent} has worked on this step for ${stuck.detail ?? 'a long time'} since you last said anything, and isn't done. ${review ? 'Review again, or skip the review.' : 'Let it carry on if it seems to be getting somewhere, or hand the step to another agent.'}`
      case 'refused':
        return `${agent} refused to go on with this step. ${review ? 'Review again with another agent, or skip the review.' : 'Tell it what to do differently, or hand the step to another agent.'}`
      case 'signed_out':
        return `${agent} is signed out. Sign in again, then try again, or ${review ? 'review with another agent.' : 'hand the step to another agent.'}`
    }
  },
  /** What Althar did before it asked. */
  tried: (agent: string): Record<NonNullable<StuckStep['tried']>[number], { what: string; result: string }> => ({
    carried_on: { what: 'Told it to carry on', result: 'it stopped again' },
    restarted: { what: `Started ${agent} again from the start`, result: 'it stopped again' },
    redirected: { what: 'Told it to try another way', result: 'it did the same again' },
  }),
  /** Tried again on the same agent: started again where it went quiet, or let go on where it ran long. */
  again: {
    stalled: { again: (agent: string) => `Start ${agent} again`, tryingAgain: (agent: string) => `Starting ${agent} again` },
    over_budget: { again: (agent: string) => `Let ${agent} carry on`, tryingAgain: (agent: string) => `${agent} carries on` },
    restarted: { again: (agent: string) => `Start ${agent} again`, tryingAgain: (agent: string) => `Starting ${agent} again` },
  },
  /** What puts it right elsewhere: the agent's sign-in, or the repository's host, in Settings. */
  fix: { signIn: 'Sign in again', connect: 'Connect' },
  /** For the pull request, which Althar opens itself: what went wrong. */
  publishing: (stuck: StuckStep): string =>
    stuck.why === 'restarted'
      ? 'Althar restarted twice while opening the pull request, so it paused in case that caused it. If you restarted Althar yourself, try again.'
      : `Althar couldn't open the pull request.${stuck.detail === null ? '' : ` ${stuck.detail}`} Try again, or go on without it.`,
  publish: {
    abandon: 'Go on without it',
    abandoned: 'Went on without it',
    abandonedNote: 'the task is ready on its branch',
  },
  reminded: { what: 'Reminded it to say when the step is done', result: 'it stopped again without saying' },
  /** Its service tried again after growing pauses (ADR-060): one line for all the tries. */
  waited: { what: 'Tried again 3 times, waiting longer each time', result: 'it failed each time', tries: 3 },
  /** An agent out of usage: told nothing, since it would hit the same limit; handed on, or tried again once it is back. */
  out: {
    again: (agent: string) => `Try ${agent} again`,
    tryingAgain: (agent: string) => `Trying ${agent} again`,
  },
  review: {
    /** Its try again: the review again, on the reviewer it had. */
    again: 'Review again',
    tryingAgain: 'Reviewing again',
    retry: 'Review with another agent',
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

interface StuckCallProps {
  request: AttentionRequest
  stuck: StuckStep
  agents: ReadonlyArray<AgentStatus>
  agentName: (id: string | null) => string
  /** Answers it; false where it didn't go through, and the card starts afresh, answerable again. */
  onAnswer: (attentionId: string, answer: StuckAnswer) => void | Promise<boolean>
  /** Report a problem about this step, with its task: Report this. Without it, none. */
  onReport?: (step: string) => void
  /** Opens Settings at an agent's sign-in, for a step whose agent is signed out: Sign in again. */
  onSignIn?: (agentId: string) => void
  /** Opens the code hosts in Settings, for a pull request whose host isn't connected: Connect. */
  onConnect?: () => void
}

/**
 * A stuck step's card, started afresh when an answer doesn't go through: the
 * kit's card shows an answer once given, the runtime only once it took it.
 */
export function StuckCall({ onAnswer, ...props }: StuckCallProps) {
  const [round, setRound] = useState(0)
  const send = (attentionId: string, answer: StuckAnswer) =>
    void Promise.resolve(onAnswer(attentionId, answer)).then((through) => {
      if (through === false) setRound((now) => now + 1)
    })
  return <StuckCard key={round} {...props} onAnswer={send} />
}

function StuckCard({
  request,
  stuck,
  agents,
  agentName,
  onAnswer,
  onReport,
  onSignIn,
  onConnect,
}: Omit<StuckCallProps, 'onAnswer'> & { onAnswer: (attentionId: string, answer: StuckAnswer) => void }) {
  const named = useModelNames()
  const agent = agentName(stuck.agentId) || 'The agent'
  // A usage limit that says who could take over asks with them; one raised before it did asks as any stuck step.
  if (stuck.why === 'usage_limit' && stuck.limit !== undefined)
    return (
      <LimitCall
        request={request}
        step={stuck.step}
        agentId={stuck.agentId}
        limit={stuck.limit}
        agents={agents}
        agentName={agentName}
        onAnswer={onAnswer}
      />
    )
  const tried: ReadonlyArray<StuckAttempt> =
    stuck.why === 'no_report'
      ? [{ id: 'reminded', ...text.reminded }]
      : stuck.why === 'transient'
        ? [{ id: 'waited', what: text.waited.what, result: text.waited.result }]
        : (stuck.tried ?? []).map((each) => ({ id: each, ...text.tried(agent)[each] }))
  const review = stuck.step === 'review'
  // Handed on, a step goes to another agent: trying again is the agent it had.
  const others = agents.filter((candidate) => stuck.agentId === null || candidate.id !== stuck.agentId)
  const lastRound = stuck.why === 'round_limit'
  const out = stuck.why === 'usage_limit'
  // Signed out, its lead can't be told anything until it is signed in again.
  const signedOut = stuck.why === 'signed_out'
  // Gone quiet, long at it, or stopped by restarts, a lead's agent starts again, or carries on, in its own words; any other tries again.
  const again =
    !review && (stuck.why === 'stalled' || stuck.why === 'over_budget' || stuck.why === 'restarted') ? text.again[stuck.why] : undefined
  // Where the connection or the session failed rather than the work, trying again is the way on.
  const againFirst = stuck.why === 'transient' || stuck.why === 'session_ended'
  // Opening the pull request is Althar's own step: tried again as it was, or gone on without.
  if (stuck.step === 'publish')
    return (
      <Stuck
        step={text.step.publish}
        what={stuck.why === 'not_connected' ? text.what(stuck, agent) : text.publishing(stuck)}
        tried={[]}
        onAgain={() => onAnswer(request.id, { kind: 'retry', agentId: 'althar' })}
        {...(stuck.why === 'not_connected' && onConnect !== undefined ? { fix: { label: text.fix.connect, onFix: onConnect } } : {})}
        onAbandon={() => onAnswer(request.id, { kind: 'abandon' })}
        {...(onReport === undefined ? {} : { onReport: () => onReport(text.step.publish) })}
        text={text.publish}
      />
    )
  return (
    <Stuck
      step={text.step[stuck.step]}
      what={text.what(stuck, agent)}
      tried={tried}
      {...(stuck.why === 'transient' ? { tries: text.waited.tries } : {})}
      agents={others.filter((candidate) => !out || candidate.id !== stuck.agentId).map((candidate) => ({ model: named(candidate.id) }))}
      {...(review || out || signedOut ? {} : { onTell: (note: string) => onAnswer(request.id, { kind: 'tell', note }) })}
      {...(stuck.agentId !== null ? { onAgain: () => onAnswer(request.id, { kind: 'retry', agentId: stuck.agentId ?? '' }) } : {})}
      againFirst={againFirst}
      {...(stuck.why === 'signed_out' && stuck.agentId !== null && onSignIn !== undefined
        ? { fix: { label: text.fix.signIn, onFix: () => onSignIn(stuck.agentId ?? '') } }
        : {})}
      onRetry={(model) => onAnswer(request.id, { kind: 'retry', agentId: model.runtime })}
      onAbandon={() => onAnswer(request.id, { kind: 'abandon' })}
      {...(onReport === undefined ? {} : { onReport: () => onReport(text.step[stuck.step]) })}
      {...(out
        ? { text: { again: text.out.again(agent), tryingAgain: text.out.tryingAgain(agent) } }
        : again !== undefined
          ? { text: { again: again.again(agent), tryingAgain: again.tryingAgain(agent) } }
          : review
            ? {
                text: {
                  again: text.review.again,
                  tryingAgain: text.review.tryingAgain,
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
