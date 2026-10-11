import { useEffect } from 'react'

import type { AgentStatus, AttentionRequest, LimitCall as Limit } from '@althar/contracts'
import { RateLimit, type RateLimitOption } from '@althar/ui'

import type { StuckAnswer } from '../../data/client'
import { keys } from '../../data/reads'
import { useServices } from '../../data/services'
import { type NameModel, useModelNames } from '../../shared/modelNames'
import { viaOf } from '../../shared/models'
import { clock } from '../../shared/time'

/*
 * A step a usage limit stopped, where the project asks or the agent didn't
 * say when it resets (ADR-013): whose limit and until when, the models that
 * could take the step over, and waiting for the reset, or trying the agent
 * again where the reset isn't known. The runtime names every account that
 * could, as they stood; which are free is read here, from the accounts as
 * they stand now, read again as the call shows, since the window otherwise
 * keeps what it first read of them. One out of usage is marked, and one
 * signed out isn't offered.
 */

export const limitText = {
  /** Whose limit, and until when; the same words wherever the call shows. */
  what: (agent: string, resets: string | null) =>
    resets === null
      ? `${agent} reached its usage limit and didn't say when it resets.`
      : `${agent} reached its usage limit, until ${resets}.`,
  out: (at: string) => `out until ${at}`,
  perUse: 'paid per use',
}

/** Whose limit it is: the agent, with the account where it has several, as the thread says it. */
export const limitedOf = (agents: ReadonlyArray<AgentStatus>, agentName: string, accountId: string | null) => {
  const accounts = agents.find((agent) => agent.accounts.some((account) => account.id === accountId))?.accounts ?? []
  const account = accounts.find((each) => each.id === accountId)
  return account === undefined || accounts.length < 2 ? agentName : `${agentName} (${account.name})`
}

/**
 * The accounts that could take the step over, as they stand now: those
 * signed in, each as the model it would run, how it is reached, and what is
 * in the way: out of usage until a time, or paid per use.
 */
export const limitOptionsOf = (
  limit: Limit,
  agents: ReadonlyArray<AgentStatus>,
  named: NameModel,
  now: Date = new Date(),
): ReadonlyArray<RateLimitOption & { readonly choice: Limit['choices'][number]; readonly back?: string }> =>
  limit.choices.flatMap((choice) => {
    const agent = agents.find((each) => each.id === choice.agentId)
    const account = agent?.accounts.find((each) => each.id === choice.accountId)
    if (agent === undefined || account === undefined || account.signIn === 'signed_out') return []
    const several = agent.accounts.length > 1
    const model = named(choice.agentId, choice.model, several ? account.name : null)
    const out = account.outUntil !== null && Date.parse(account.outUntil) > now.getTime() ? account.outUntil : null
    const note = [
      model.via ?? viaOf(agent.name, several ? account.name : null),
      out === null ? (account.paidBy === 'key' ? limitText.perUse : null) : limitText.out(clock(out, now)),
    ]
    return [
      {
        id: `${choice.agentId}:${choice.accountId}`,
        model,
        note: note.filter((part) => part !== null).join(' · '),
        ...(out === null ? {} : { busy: true, back: out }),
        choice,
      },
    ]
  })

export function LimitCall({
  request,
  step,
  agentId,
  limit,
  agents,
  agentName,
  onAnswer,
}: {
  request: AttentionRequest
  /** The step it stopped, as its call names it. */
  step: string
  /** The agent whose account reached the limit. */
  agentId: string | null
  limit: Limit
  agents: ReadonlyArray<AgentStatus>
  agentName: (id: string | null) => string
  onAnswer: (attentionId: string, answer: StuckAnswer) => void
}) {
  const { cache } = useServices()
  // The accounts as they are now: one may have run out since the window read them, the one this call is about included.
  useEffect(() => void cache.invalidateQueries({ queryKey: keys.status }), [cache, request.id])
  const named = useModelNames()
  const options = limitOptionsOf(limit, agents, named)
  // One out of usage is back at its reset: read them again then, a second after, so it can be picked.
  const back = options.reduce<number | null>((soonest, option) => {
    if (option.back === undefined) return soonest
    const at = Date.parse(option.back)
    return soonest === null ? at : Math.min(soonest, at)
  }, null)
  useEffect(() => {
    if (back === null) return
    // A timer can't wait longer than about 24 days; one that would is set again then.
    const timer = setTimeout(
      () => void cache.invalidateQueries({ queryKey: keys.status }),
      Math.min(Math.max(0, back - Date.now()) + 1000, 2 ** 31 - 1),
    )
    return () => clearTimeout(timer)
  }, [cache, back])
  const resets = limit.resetsAt === null ? null : clock(limit.resetsAt)
  return (
    <RateLimit
      runtime={limitedOf(agents, agentName(agentId) || 'The agent', limit.accountId)}
      resets={resets}
      step={step}
      text={{ what: limitText.what }}
      options={options}
      onSwap={(id) => {
        const picked = options.find((option) => option.id === id)?.choice
        if (picked === undefined) return
        onAnswer(request.id, {
          kind: 'retry',
          agentId: picked.agentId,
          accountId: picked.accountId,
          ...(picked.model === null ? {} : { model: picked.model }),
        })
      }}
      {...(resets === null
        ? agentId === null
          ? {}
          : { onAgain: () => onAnswer(request.id, { kind: 'retry', agentId }) }
        : { onWait: () => onAnswer(request.id, { kind: 'wait' }) })}
    />
  )
}
