import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { AccountUse, ThreadSnapshot } from '@althar/contracts'

import { Outputs } from '../src/renderer/features/task/Outputs'
import { contextMeter } from '../src/renderer/shared/ContextMeter'
import { accountWords } from '../src/renderer/shared/usage'
import { fakeClient, snapshot } from './fixtures'
import { withServices } from './render'

/*
 * What a task used of each account its agents ran on, as Outputs' Usage card
 * says it (ADR-084): closed until the person opens it, then open on every task
 * until they close it.
 */

const accountUse = (overrides: Partial<AccountUse>): AccountUse => ({
  accountId: 'claude-max',
  agentId: 'claude-code',
  agentName: 'Claude Code',
  accountName: 'Personal',
  several: false,
  paidBy: 'plan',
  plan: 'max',
  took: 8,
  spent: null,
  models: ['claude-opus-4-1'],
  tokens: 2_400_000,
  ...overrides,
})

const USAGE: ReadonlyArray<AccountUse> = [
  accountUse({}),
  accountUse({
    accountId: 'opencode-zen',
    agentId: 'opencode',
    agentName: 'OpenCode',
    paidBy: 'key',
    plan: null,
    took: null,
    spent: 1.24,
    models: ['deepseek-v3'],
    tokens: 380_000,
  }),
]

const task = (rest: Partial<ThreadSnapshot> = {}) => snapshot({ session: null, ...rest, task: { ...snapshot().task, phase: 'ready' } })

const show = (snap: ThreadSnapshot) =>
  withServices(
    <Outputs
      snapshot={snap}
      pending={false}
      error={null}
      onAccept={vi.fn()}
      onMergeHere={vi.fn()}
      onOpenChange={vi.fn()}
      onPush={vi.fn()}
      onMarkReady={vi.fn()}
      onOpenFile={vi.fn()}
      onPushBranch={vi.fn()}
      onConnect={vi.fn()}
      onReplace={vi.fn()}
      onBringIn={vi.fn()}
    />,
    fakeClient().client,
  )

describe('what a task used of each account', () => {
  it('shows each figure on one closed row, and the lines once opened', async () => {
    show(task({ usage: USAGE }))
    const toggle = screen.getByRole('button', { name: /Usage/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(within(toggle).getByText('8%')).toBeTruthy()
    expect(within(toggle).getByText('$1.24')).toBeTruthy()
    await userEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Claude Code Max')).toBeTruthy()
    expect(screen.getByText('8% of week')).toBeTruthy()
    expect(screen.getByText('OpenCode')).toBeTruthy()
  })

  it('keeps it open for the next task once opened, and closed once closed', async () => {
    show(task({ usage: USAGE }))
    await userEvent.click(screen.getByRole('button', { name: /Usage/ }))
    cleanup()
    show(task({ threadId: 'another', usage: USAGE }))
    const toggle = screen.getByRole('button', { name: /Usage/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    await userEvent.click(toggle)
    cleanup()
    show(task({ threadId: 'a third', usage: USAGE }))
    expect(screen.getByRole('button', { name: /Usage/ }).getAttribute('aria-expanded')).toBe('false')
  })

  it('shows no card where nothing was used', () => {
    show(task({ usage: [] }))
    expect(screen.queryByRole('button', { name: /Usage/ })).toBeNull()
  })

  it('names an account by its plan, and by its own name where the agent has several', () => {
    expect(accountWords(accountUse({}))).toBe('Claude Code Max')
    expect(accountWords(accountUse({ several: true, accountName: 'Work' }))).toBe('Claude Code Max · Work')
    expect(accountWords(accountUse({ paidBy: 'key', plan: null }))).toBe('Claude Code')
  })

  it('says it under the context in the composer’s ring, headed by whose it is', async () => {
    const session = { ...snapshot().session!, context: { used: 120_000, size: 200_000 } }
    render(
      <>
        {contextMeter(
          session,
          (_, model) => ({ id: model ?? '', name: model ?? '', short: model ?? '', runtime: 'Claude Code', efforts: [] }),
          undefined,
          { usage: USAGE, heading: 'This task so far' },
        )}
      </>,
    )
    await userEvent.click(screen.getByRole('button', { name: /60%/ }))
    expect(screen.getByText('This task so far')).toBeTruthy()
    expect(screen.getByText('8% of week')).toBeTruthy()
    expect(screen.getByText('$1.24')).toBeTruthy()
  })
})
