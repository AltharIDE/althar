import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { AgentStatus, AttentionRequest, HeldForLimit, LimitCall as Limit } from '@althar/contracts'

import { HeldLimit, LimitCall, limitedOf, limitOptionsOf, limitText } from '../src/renderer/features/task/LimitCall'
import { clock } from '../src/renderer/shared/time'
import { agents, fakeClient, status, usual } from './fixtures'
import { withServices } from './render'

/*
 * A step a usage limit stopped, on its own: whose limit and until when, the
 * models that could take it over, and the ways on, from the call as the
 * runtime asks it and the accounts as they stand now; and a step held for
 * the reset, which offers the same as a way on.
 */

const BACK = '2099-01-01T14:00:00.000Z'

/** Claude Code with a second account, Codex signed in on its plan, OpenCode signed out. */
const now: ReadonlyArray<AgentStatus> = agents.map((agent) =>
  agent.id === 'claude-code'
    ? { ...agent, accounts: [usual('acc_claude', 'signed_in'), { ...usual('acc_work', 'signed_in'), name: 'work' }] }
    : agent.id === 'codex'
      ? { ...agent, accounts: [usual('acc_codex', 'signed_in')] }
      : agent,
)

const request = (limit: Limit, step: 'implement' | 'review' = 'implement'): AttentionRequest => ({
  id: 'st1',
  kind: 'stuck',
  title: 'Implement',
  reason: '',
  command: null,
  createdAt: '2026-09-29T12:00:00.000Z',
  stuck: { step, why: 'usage_limit', detail: null, agentId: 'claude-code', round: 0, open: 0, limit },
})

const named = (id: string | null) => (id === 'claude-code' ? 'Claude Code' : id === 'codex' ? 'Codex' : '')

const showCall = (limit: Limit, options: { step?: 'implement' | 'review'; agentId?: string | null; agentName?: typeof named } = {}) => {
  const { client } = fakeClient({ status: vi.fn(async () => ({ ...status, agents: now })) })
  const onAnswer = vi.fn()
  const step = options.step ?? 'implement'
  withServices(
    <LimitCall
      request={request(limit, step)}
      step={step}
      agentId={options.agentId === undefined ? 'claude-code' : options.agentId}
      limit={limit}
      agents={now}
      agentName={options.agentName ?? named}
      onAnswer={onAnswer}
    />,
    client,
  )
  return { client, onAnswer }
}

describe('a step a usage limit stopped', () => {
  it('lets a review be skipped, beside picking another model and waiting', async () => {
    const limit: Limit = { accountId: 'acc_claude', resetsAt: BACK, choices: [{ agentId: 'codex', accountId: 'acc_codex', model: null }] }
    const { onAnswer } = showCall(limit, { step: 'review' })
    expect(await screen.findByText(`Claude Code (main) is out of usage until ${clock(BACK)}.`)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Skip the review' }))
    expect(onAnswer).toHaveBeenCalledWith('st1', { kind: 'abandon' })
    expect(await screen.findByText('Skipped the review')).toBeTruthy()
  })

  it('hands the step to the account picked on its agent’s own model, where the call names none', async () => {
    const limit: Limit = { accountId: 'acc_claude', resetsAt: BACK, choices: [{ agentId: 'codex', accountId: 'acc_codex', model: null }] }
    const { onAnswer } = showCall(limit)
    await userEvent.click(await screen.findByRole('button', { name: /^Continue with/ }))
    expect(onAnswer).toHaveBeenCalledWith('st1', { kind: 'retry', agentId: 'codex', accountId: 'acc_codex' })
  })

  it('offers nothing but another model where the reset isn’t known and no agent is named to try again', async () => {
    const limit: Limit = { accountId: null, resetsAt: null, choices: [{ agentId: 'codex', accountId: 'acc_codex', model: null }] }
    showCall(limit, { agentId: null, agentName: () => '' })
    // An agent it can't name is the agent.
    expect(await screen.findByText(/^The agent is out of usage\.$/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Continue with/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Try .+ again$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Wait until/ })).toBeNull()
  })

  it('marks every account that is out, and says no other model is free now', async () => {
    const out: ReadonlyArray<AgentStatus> = now.map((agent) =>
      agent.id === 'claude-code'
        ? {
            ...agent,
            accounts: agent.accounts.map((account) =>
              account.id === 'acc_work' ? { ...account, outUntil: '2099-01-02T10:00:00.000Z' } : account,
            ),
          }
        : agent.id === 'codex'
          ? { ...agent, accounts: [{ ...usual('acc_codex', 'signed_in'), outUntil: '2099-01-01T10:00:00.000Z' }] }
          : agent,
    )
    const { client } = fakeClient({ status: vi.fn(async () => ({ ...status, agents: out })) })
    const limit: Limit = {
      accountId: 'acc_claude',
      resetsAt: BACK,
      choices: [
        { agentId: 'claude-code', accountId: 'acc_work', model: null },
        { agentId: 'codex', accountId: 'acc_codex', model: null },
      ],
    }
    withServices(
      <LimitCall
        request={request(limit)}
        step="implement"
        agentId="claude-code"
        limit={limit}
        agents={out}
        agentName={named}
        onAnswer={vi.fn()}
      />,
      client,
    )
    expect(await screen.findByText('No other model is free now.')).toBeTruthy()
    // Nothing to move it to: waiting for the reset is all there is.
    expect(screen.queryByRole('button', { name: /^Continue with/ })).toBeNull()
    expect(screen.getByRole('button', { name: `Wait until ${clock(BACK)}` })).toBeTruthy()
  })
})

describe('a step held for a usage limit', () => {
  const showHeld = (waits: HeldForLimit, step: 'implement' | 'review' = 'implement', agentName = named) => {
    const { client } = fakeClient({ status: vi.fn(async () => ({ ...status, agents: now })) })
    const onHandOver = vi.fn()
    const onSkip = vi.fn()
    withServices(<HeldLimit waits={waits} step={step} agents={now} agentName={agentName} onHandOver={onHandOver} onSkip={onSkip} />, client)
    return { onHandOver, onSkip }
  }

  it('says it waits as the person said, and offers every other account where its hold kept none', async () => {
    const { onHandOver } = showHeld({ agentId: 'claude-code', until: BACK, accountId: 'acc_claude', why: 'asked' })
    expect(await screen.findByText(`Claude Code (main) is out of usage until ${clock(BACK)}.`)).toBeTruthy()
    // Every account but the one out: Claude Code’s other one and Codex; OpenCode is signed out.
    await userEvent.click(screen.getByRole('button', { name: 'Choose another model' }))
    const offered = within(await screen.findByRole('menu')).getAllByRole('menuitemradio')
    expect(offered.map((item) => item.textContent)).toEqual([
      expect.stringContaining('via Claude Code · work'),
      expect.stringContaining('via Codex'),
    ])
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: /^Continue with/ }))
    expect(onHandOver).toHaveBeenCalledWith({ agentId: 'claude-code', accountId: 'acc_work' })
  })

  it('leaves out every account of the agent out, where its hold doesn’t say which account, and says only when it is back', async () => {
    showHeld({ agentId: 'claude-code', until: BACK }, 'implement', () => '')
    expect(await screen.findByText(`The agent is out of usage until ${clock(BACK)}.`)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Choose another model' }))
    const offered = within(await screen.findByRole('menu')).getAllByRole('menuitemradio')
    expect(offered.map((item) => item.textContent)).toEqual([expect.stringContaining('via Codex')])
  })
})

describe('a usage limit, in words', () => {
  it('names whose limit it is by the agent alone where the account isn’t one it knows', () => {
    expect(limitedOf(now, 'Claude Code', 'acc_work')).toBe('Claude Code (work)')
    expect(limitedOf(now, 'Codex', 'acc_codex')).toBe('Codex')
    expect(limitedOf(now, 'Claude Code', 'acc_gone')).toBe('Claude Code')
    expect(limitedOf(now, 'Claude Code', null)).toBe('Claude Code')
  })

  it('says how a model is reached where its name doesn’t: its agent, and the account where the agent has several', () => {
    const limit: Limit = {
      accountId: 'acc_claude',
      resetsAt: null,
      choices: [
        { agentId: 'claude-code', accountId: 'acc_work', model: 'opus' },
        { agentId: 'codex', accountId: 'acc_codex', model: null },
      ],
    }
    const bare = (agentId: string | null, model: string | null = null) => ({
      id: `${agentId}:${model}`,
      name: model ?? 'x',
      short: model ?? 'x',
      runtime: agentId ?? 'agent',
      efforts: [],
    })
    expect(limitOptionsOf(limit, now, bare).map((option) => option.note)).toEqual(['via Claude Code · work', 'via Codex'])
  })
})

describe('a new step on an agent nearly out', () => {
  it('says how little it has left, not that it ran out, with the agent itself among the ways on', () => {
    expect(limitText.what('Codex', '14:00', 3.4)).toBe('Codex has 3% of its usage left, until 14:00.')
    expect(limitText.what('Codex', null, 2)).toBe('Codex has 2% of its usage left.')
    expect(limitText.held('Codex', '14:00', 3)).toBe('Codex has 3% of its usage left, until 14:00.')
    // Out, as before.
    expect(limitText.held('Codex', '14:00')).toBe('Codex is out of usage until 14:00.')
  })
})
