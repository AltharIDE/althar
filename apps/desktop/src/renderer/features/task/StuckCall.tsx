import type { AgentStatus, AttentionRequest, StuckStep } from '@althar/contracts'
import { type ModelInfo, Stuck, type StuckAttempt, type StuckWay } from '@althar/ui'
import { useMemo, useState } from 'react'

import type { StuckAnswer } from '../../data/client'
import { useModels } from '../../data/models'
import { canPick } from '../../shared/agents'
import { ModelsBrowser } from '../../shared/ModelChoice'
import { catalogOf, defaultPins, handOnChoice, handOnModels, infoOf, useModelPrefs, withoutModel } from '../../shared/models'
import { useModelNames, useProviderNames } from '../../shared/modelNames'
import { clock } from '../../shared/time'
import { LimitCall, limitText } from './LimitCall'

/*
 * A step of the task's plan that needs the person (docs/architecture/05):
 * what went wrong, what Althar tried, and only the ways on that fit it
 * (`waysOn`). The lead is told what to do only where its own work went
 * wrong; where Althar, the agent's service or its session failed, the step
 * starts again on its agent, first (ADR-060). Every step can be handed to
 * another model or abandoned; a review is run again, on its reviewer or
 * another model, or gone on without, and never told; the pull request, which
 * Althar opens itself, is tried again or gone on without. Any model of any
 * agent could take a step over, picked in a menu of the person's pins, or
 * among all of them: only the one whose failure it was is left out.
 */

type Why = StuckStep['why']

/** What a card offers, the way to take first, and what puts it right elsewhere, where something does. */
interface Ways {
  readonly ways: ReadonlyArray<StuckWay>
  readonly primary: StuckWay
  readonly fix?: 'signIn' | 'connect'
}

/** The lead's work went wrong: told what to do instead, first. */
const tellFirst: Ways = { ways: ['tell', 'retry', 'abandon'], primary: 'tell' }
/** Althar, the service or the session failed, not the work: started again, first. */
const againFirst: Ways = { ways: ['again', 'retry', 'abandon'], primary: 'again' }
/** The reviewer's own trouble: another reviewer, first. */
const anotherFirst: Ways = { ways: ['retry', 'again', 'abandon'], primary: 'retry' }

/**
 * Each reason's ways on, for the lead's steps (Implement, Settle) and for a
 * review; the pull request has its own (`publishWays`). The one place that
 * decides them: the pull request's table says why each.
 */
export const waysOn: Record<Why, { readonly lead: Ways; readonly review: Ways }> = {
  no_report: { lead: tellFirst, review: anotherFirst },
  session_ended: { lead: againFirst, review: againFirst },
  transient: { lead: againFirst, review: againFirst },
  failed_to_start: { lead: againFirst, review: againFirst },
  restarted: { lead: againFirst, review: againFirst },
  // Out of rounds with changes no review has seen: reviewed again, or accepted as it is.
  round_limit: { lead: tellFirst, review: againFirst },
  not_connected: { lead: againFirst, review: againFirst },
  // Telling it anything would hit the same limit: handed on, or tried once it is back.
  usage_limit: { lead: anotherFirst, review: anotherFirst },
  stalled: { lead: tellFirst, review: anotherFirst },
  looping: { lead: tellFirst, review: anotherFirst },
  // Long at it, it may simply carry on; or be told, handed on, or stopped.
  over_budget: { lead: { ways: ['again', 'tell', 'retry', 'abandon'], primary: 'again' }, review: anotherFirst },
  refused: { lead: tellFirst, review: anotherFirst },
  // Signed in again in Settings first, then tried again.
  signed_out: { lead: { ...againFirst, fix: 'signIn' }, review: { ...againFirst, fix: 'signIn' } },
}

/** The pull request, which Althar opens itself: tried again as it was, or gone on without; its host connected first, where it isn't. */
export const publishWays = (why: Why): Ways =>
  why === 'not_connected'
    ? { ways: ['again', 'abandon'], primary: 'again', fix: 'connect' }
    : { ways: ['again', 'abandon'], primary: 'again' }

/** The ways on a stuck step's card offers. */
export const waysFor = (stuck: StuckStep): Ways =>
  stuck.step === 'publish' ? publishWays(stuck.why) : waysOn[stuck.why][stuck.step === 'review' ? 'review' : 'lead']

export const text = {
  step: { implement: 'Implement', review: 'Review', settle: 'Settle', publish: 'Pull request' } satisfies Record<StuckStep['step'], string>,
  what: (stuck: StuckStep, agent: string): string => {
    // What went wrong, in a few words: the buttons under it are the ways on.
    switch (stuck.why) {
      case 'no_report':
        return `${agent} stopped without saying whether the step is done.`
      case 'session_ended':
        return `${agent} closed before finishing the step.`
      case 'transient':
        return `${stuck.service ?? agent}'s service kept failing.`
      case 'failed_to_start':
        return `${agent} couldn't start.${stuck.detail === null ? '' : ` ${stuck.detail}`}`
      case 'restarted':
        return text.crashed
      case 'round_limit':
        return `${text.reviewed(stuck.round)}${stuck.open === 0 ? '' : stuck.open === 1 ? ' 1 finding open.' : ` ${stuck.open} findings open.`}`
      case 'not_connected':
        return "Althar isn't connected to this repository's host."
      case 'usage_limit':
        return limitText.what(agent, stuck.limit?.resetsAt == null ? null : clock(stuck.limit.resetsAt), stuck.limit?.left)
      case 'stalled':
        return `${agent} has gone quiet.`
      case 'looping':
        return `${agent} keeps getting the same result.`
      case 'over_budget':
        return `${agent} has worked on this step for ${stuck.detail ?? 'a long time'}.`
      case 'refused':
        return `${agent} refused to go on.`
      case 'signed_out':
        return `${agent} is signed out.`
    }
  },
  /** How many rounds of review the task ran, not today's setting; its last settle changed code no review has seen. */
  reviewed: (rounds: number): string =>
    `Reviewed ${rounds <= 1 ? 'once' : rounds === 2 ? 'twice' : `${rounds} times`}; the last fixes weren't reviewed.`,
  /** One provider within the agent refused its sign-in, not the agent: which, and for which model. */
  refused: (provider: string, model: string): string => `${provider} refused the sign-in for ${model}.`,
  /** What Althar did before it asked. */
  tried: (agent: string): Record<NonNullable<StuckStep['tried']>[number], { what: string; result: string }> => ({
    carried_on: { what: 'Told it to carry on', result: 'it stopped again' },
    restarted: { what: `Started ${agent} again from the start`, result: 'it stopped again' },
    redirected: { what: 'Told it to try another way', result: 'it did the same again' },
  }),
  /** Althar crashed on the step twice in a row; quitting or restarting it never pauses a step. */
  crashed: 'Althar stopped unexpectedly twice while this step ran.',
  /** Tried again on the same agent: started again where Althar or its session stopped it, or let go on where it ran long. */
  again: {
    session_ended: { again: (agent: string) => `Start ${agent} again`, tryingAgain: (agent: string) => `Starting ${agent} again` },
    over_budget: { again: (agent: string) => `Let ${agent} carry on`, tryingAgain: (agent: string) => `${agent} carries on` },
    restarted: { again: (agent: string) => `Start ${agent} again`, tryingAgain: (agent: string) => `Starting ${agent} again` },
  },
  /** What puts it right elsewhere: the agent's sign-in, or the repository's host, in Settings. */
  fix: { signIn: 'Sign in again', provider: (provider: string) => `Sign in to ${provider}`, connect: 'Connect' },
  /** For the pull request, which Althar opens itself: what went wrong. */
  publishing: (stuck: StuckStep): string =>
    stuck.why === 'restarted' ? text.crashed : `Couldn't open the pull request.${stuck.detail === null ? '' : ` ${stuck.detail}`}`,
  publish: {
    abandon: 'Go on without it',
    abandoned: 'Went on without it',
  },
  reminded: { what: 'Reminded it to report', result: 'it stopped again' },
  /** Its service tried again after growing pauses (ADR-060): one line for all the tries. */
  waited: { what: 'Tried again 3 times', result: 'it failed each time', tries: 3 },
  /** An agent out of usage: told nothing, since it would hit the same limit; handed on, or tried again once it is back. */
  out: {
    again: (agent: string) => `Try ${agent} again`,
    tryingAgain: (agent: string) => `Trying ${agent} again`,
  },
  review: {
    /** Its try again: the review again, on the reviewer it had. */
    again: 'Review again',
    tryingAgain: 'Reviewing again',
    retry: 'Review with another model',
    retryLabel: 'Review with',
    retried: (agent: string) => `Reviewing with ${agent}`,
    skip: 'Skip the review',
    skipped: 'Skipped the review',
    accept: 'Accept it as it is',
    accepted: 'Accepted as it is',
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

/** Failures that are one model's or its provider's: its agent's other models could go on. */
const ofTheModel: ReadonlyArray<StuckStep['why']> = ['signed_out', 'usage_limit', 'transient']

/**
 * Handing a step on to a model: a menu of the best bet, then the person's
 * pins, and every model of every agent that can be picked in the browser.
 * The one that failed is left out where the failure was its own or its
 * provider's (signed out, out of usage, its service failing); where the
 * agent couldn't start, its models stay, last. The best bet is another
 * maker's model. The step keeps its effort where the agent it goes to
 * offers it, else runs on the person's default for the model.
 */
const useHandOn = (
  attentionId: string,
  stuck: StuckStep,
  agents: ReadonlyArray<AgentStatus>,
  onAnswer: (attentionId: string, answer: StuckAnswer) => void,
) => {
  const known = useModels()
  const prefs = useModelPrefs()
  const [browsing, setBrowsing] = useState<((model: ModelInfo) => void) | null>(null)
  const pickable = useMemo(() => agents.filter(canPick), [agents])
  const catalog = useMemo(() => catalogOf(known ?? [], pickable), [known, pickable])
  const failed = stuck.agentId === null ? null : infoOf(catalog, { agentId: stuck.agentId, model: stuck.model ?? null })
  const without = failed !== null && ofTheModel.includes(stuck.why) ? failed.id : null
  if (stuck.step === 'publish') return {}
  const left = withoutModel(catalog, without)
  if (left.models.length === 0) return {}
  const models = handOnModels(left, prefs.pins ?? defaultPins(left), {
    failed,
    avoidAgent: stuck.why === 'failed_to_start' ? stuck.agentId : null,
  })
  const handTo = (info: ModelInfo) => {
    const choice = handOnChoice(left, info.id, { agentId: stuck.agentId, effort: stuck.effort ?? null })
    onAnswer(attentionId, {
      kind: 'retry',
      agentId: choice.agentId,
      ...(choice.model === null ? {} : { model: choice.model }),
      ...(choice.effort === null ? {} : { effort: choice.effort }),
    })
  }
  return {
    handOn: {
      models,
      onHandOn: handTo,
      onBrowse: (take: (model: ModelInfo) => void) => setBrowsing(() => take),
      count: left.models.length,
    },
    browser: browsing !== null && (
      <ModelsBrowser
        agents={pickable}
        without={without}
        value=""
        onPick={(picked) => {
          setBrowsing(null)
          browsing(picked)
        }}
        onClose={() => setBrowsing(null)}
      />
    ),
  }
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
  const providerName = useProviderNames()
  const agent = agentName(stuck.agentId) || 'The agent'
  // A provider within the agent refused it: said by its name and the model's, and signed in to by its name.
  const provider =
    stuck.why === 'signed_out' && stuck.provider !== undefined && stuck.model !== undefined
      ? providerName(stuck.agentId, stuck.model, stuck.provider)
      : undefined
  // The agent's own words under it, where they say more than the headline.
  const said = stuck.why === 'signed_out' && stuck.detail !== null && !/signed out/i.test(stuck.detail) ? stuck.detail : undefined
  const { handOn, browser } = useHandOn(request.id, stuck, agents, onAnswer)
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
  const { ways, primary, fix } = waysFor(stuck)
  const offers = (way: StuckWay) => ways.includes(way)
  const out = stuck.why === 'usage_limit'
  const fixing =
    fix === 'signIn' && stuck.agentId !== null && onSignIn !== undefined
      ? {
          fix: {
            label: provider === undefined ? text.fix.signIn : text.fix.provider(provider),
            onFix: () => onSignIn(stuck.agentId ?? ''),
          },
        }
      : fix === 'connect' && onConnect !== undefined
        ? { fix: { label: text.fix.connect, onFix: onConnect } }
        : {}
  const reporting = (step: string) => (onReport === undefined ? {} : { onReport: () => onReport(step) })
  // Opening the pull request is Althar's own step: tried again as it was, or gone on without.
  if (stuck.step === 'publish')
    return (
      <Stuck
        step={text.step.publish}
        what={stuck.why === 'not_connected' ? text.what(stuck, agent) : text.publishing(stuck)}
        tried={[]}
        onAgain={() => onAnswer(request.id, { kind: 'retry', agentId: 'althar' })}
        primary={primary}
        {...fixing}
        onAbandon={() => onAnswer(request.id, { kind: 'abandon' })}
        {...reporting(text.step.publish)}
        text={text.publish}
      />
    )
  // Started again, let carry on, or tried once back, a lead's agent says so in its own words; any other tries again.
  const again = review ? undefined : out ? text.out : (text.again as Partial<Record<Why, typeof text.out>>)[stuck.why]
  const lastRound = stuck.why === 'round_limit'
  return (
    <>
      <Stuck
        step={text.step[stuck.step]}
        what={
          provider === undefined || stuck.model === undefined
            ? text.what(stuck, agent)
            : text.refused(provider, named(stuck.agentId, stuck.model).name)
        }
        {...(said === undefined ? {} : { said })}
        tried={tried}
        {...(stuck.why === 'transient' ? { tries: text.waited.tries } : {})}
        {...(offers('retry') && handOn !== undefined ? { handOn } : {})}
        {...(offers('tell') ? { onTell: (note: string) => onAnswer(request.id, { kind: 'tell', note }) } : {})}
        {...(offers('again') && stuck.agentId !== null
          ? { onAgain: () => onAnswer(request.id, { kind: 'retry', agentId: stuck.agentId ?? '' }) }
          : {})}
        primary={primary}
        {...fixing}
        {...(offers('abandon') ? { onAbandon: () => onAnswer(request.id, { kind: 'abandon' }) } : {})}
        {...reporting(text.step[stuck.step])}
        {...(again !== undefined
          ? { text: { again: again.again(agent), tryingAgain: again.tryingAgain(agent) } }
          : review
            ? {
                text: {
                  again: text.review.again,
                  tryingAgain: text.review.tryingAgain,
                  retry: text.review.retry,
                  retryLabel: text.review.retryLabel,
                  retried: text.review.retried,
                  abandon: lastRound ? text.review.accept : text.review.skip,
                  abandoned: lastRound ? text.review.accepted : text.review.skipped,
                },
              }
            : {})}
      />
      {browser}
    </>
  )
}
