import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ModelRoom, PlanUsage } from '@althar/contracts'

import { PlanGauge } from '@althar/ui'

import type { Host } from '../src/renderer/data/services'
import { TabsFrame } from '../src/renderer/features/tabs/TabsFrame'
import { limitWords, planOf, roomOf, windowName } from '../src/renderer/features/usage/plan'
import { waitsWords } from '../src/renderer/shared/agents'
import { ModelChoice } from '../src/renderer/shared/ModelChoice'
import { clock } from '../src/renderer/shared/time'
import { agents, changed, fakeClient, fakeHost, planUsage, project, usageAccount } from './fixtures'
import { withServices } from './render'

/*
 * Plan usage in the window: the gauge after CPU and memory, and its peek, opened by a
 * click or Ctrl or ⌘ U; each model's room in the pickers; and what a step
 * held before its agent ran out says it waits for.
 */

const NOW = new Date('2026-10-15T10:05:00.000Z')
const RESET = '2026-10-15T15:00:00.000Z'

const codexWork = usageAccount()
const codexSide = usageAccount({
  accountId: 'acc_codex_side',
  accountName: 'side',
  windows: [
    { kind: 'five_hour', label: null, usedPercent: 21, resetsAt: RESET },
    { kind: 'weekly', label: null, usedPercent: 50, resetsAt: '2026-10-19T09:00:00.000Z' },
  ],
})
const claude = usageAccount({
  agentId: 'claude-code',
  agentName: 'Claude Code',
  accountId: 'acc_claude',
  accountName: 'personal',
  source: 'endpoint',
  windows: [
    { kind: 'five_hour', label: null, usedPercent: 97, resetsAt: RESET },
    { kind: 'weekly', label: 'Opus', usedPercent: 99, resetsAt: '2026-10-19T09:00:00.000Z' },
  ],
})
const copilot = usageAccount({
  agentId: 'copilot',
  agentName: 'GitHub Copilot',
  accountId: 'acc_copilot',
  accountName: 'me',
  source: null,
  observedAt: null,
  plan: null,
  windows: [],
  noReading: 'Copilot shares no plan usage with other apps.',
})
const claudeKey = usageAccount({
  agentId: 'claude-code',
  agentName: 'Claude Code',
  accountId: 'acc_claude_key',
  accountName: 'gateway',
  paidBy: 'key',
  source: null,
  observedAt: null,
  plan: null,
  windows: [],
})

describe('what the window says of a plan', () => {
  it('names a window as a row does and as a sentence does', () => {
    expect(windowName({ kind: 'five_hour', label: null })).toBe('5 hours')
    expect(windowName({ kind: 'weekly', label: 'Opus' })).toBe('Opus week')
    expect(windowName({ kind: 'other', label: 'Extra usage' })).toBe('Extra usage')
    expect(limitWords({ kind: 'weekly', label: 'Opus' })).toBe('weekly Opus limit')
    expect(limitWords({ kind: 'five_hour', label: null })).toBe('five-hour limit')
  })

  it('gives an agent the room of its account with the most, least room first', () => {
    const { agents: read } = planOf(planUsage([codexWork, codexSide, claude, copilot]), NOW)
    expect(read.map((agent) => [agent.name, agent.left, agent.account])).toEqual([
      ['Claude Code', 3, null],
      // Work has 40% of its five hours, Side 50% of its week: work goes to Side.
      ['Codex', 50, 'side'],
    ])
    expect(read[1]?.limit).toBe('weekly limit')
    // Opened, the tightest account first, each named where there are several.
    expect(read[1]?.accounts.map((account) => account.name)).toEqual(['work', 'side'])
    // A model's own window is in the detail, not the agent's figure.
    expect(read[0]?.accounts[0]?.windows.map((window) => [window.label, window.left])).toEqual([
      ['5 hours', 3],
      ['Opus week', 1],
    ])
  })

  it('gives an agent the room of an account that can run, keeping one signed out with its last numbers in the detail', () => {
    const signedOut = usageAccount({
      accountId: 'acc_codex_side',
      accountName: 'side',
      windows: [{ kind: 'five_hour', label: null, usedPercent: 20, resetsAt: RESET }],
      fault: { kind: 'sign_in_again', message: 'Sign in to Codex to see its usage.' },
    })
    const work = usageAccount({ windows: [{ kind: 'five_hour', label: null, usedPercent: 97, resetsAt: RESET }] })
    const [codex] = planOf(planUsage([work, signedOut]), NOW).agents
    // Side's saved 80% runs nothing: new work starts on Work, at 3%.
    expect([codex?.left, codex?.account]).toEqual([3, 'work'])
    expect(codex?.accounts.map((account) => account.name)).toEqual(['work', 'side'])
    // With every account signed out, it has no room: it says why in place of a figure, after every agent that can run,
    // its last numbers kept in the detail.
    const claude = usageAccount({
      agentId: 'claude-code',
      agentName: 'Claude Code',
      accountId: 'acc_claude',
      windows: [{ kind: 'five_hour', label: null, usedPercent: 99, resetsAt: RESET }],
    })
    const {
      agents: [first, out],
    } = planOf(planUsage([signedOut, claude]), NOW)
    expect([first?.name, first?.left, first?.stopped]).toEqual(['Claude Code', 1, undefined])
    expect([out?.name, out?.stopped]).toEqual(['Codex', 'Signed out'])
    expect(out?.accounts[0]?.windows[0]?.left).toBe(80)
    expect(out?.accounts[0]?.fault).toBe('Sign in to Codex to see its usage.')
    // Nor does a picker give its own default model the saved 80%.
    expect(roomOf({ id: 'codex:' }, [], planUsage([signedOut]), NOW)).toBeUndefined()
  })

  it('shows no room in the bar for an agent whose only account is signed out', async () => {
    const signedOut = usageAccount({
      windows: [{ kind: 'five_hour', label: null, usedPercent: 20, resetsAt: RESET }],
      fault: { kind: 'sign_in_again', message: 'Sign in to Codex to see its usage.' },
    })
    const plan = planOf(planUsage([signedOut]), NOW)
    render(<PlanGauge agents={plan.agents} defaultOpen />)
    expect(screen.getByRole('button', { name: 'Plan usage: Codex can’t start work' })).toBeTruthy()
    expect(screen.getByText('Codex can’t start work')).toBeTruthy()
    expect(screen.queryByText('Plenty left')).toBeNull()
    expect(screen.queryByText('80% left')).toBeNull()
  })

  it('says how old numbers are only once they are old, and why a read failed that the person can act on', () => {
    const old = usageAccount({ observedAt: '2026-10-15T08:00:00.000Z', fault: { kind: 'expired', message: 'Its sign-in has expired.' } })
    const [account] = planOf(planUsage([old]), NOW).agents[0]?.accounts ?? []
    expect(account?.age).toBe('read 2h ago')
    expect(account?.fault).toBe('Its sign-in has expired.')
    expect(planOf(planUsage([codexWork]), new Date('2026-10-15T10:10:00.000Z')).agents[0]?.accounts[0]?.age).toBeNull()
  })

  it('shows no message for a read that must wait, only how old the saved numbers are', () => {
    const waiting = usageAccount({
      observedAt: '2026-10-15T09:50:00.000Z',
      fault: { kind: 'unreachable', message: 'The provider asked Althar to wait before reading again.' },
    })
    const [account] = planOf(planUsage([waiting]), new Date('2026-10-15T10:00:00.000Z')).agents[0]?.accounts ?? []
    expect(account?.fault).toBeNull()
    expect(account?.age).toBe('read 10m ago')
    expect(account?.windows.length).toBeGreaterThan(0)
  })

  it('leaves out an account that is waiting with no numbers yet', () => {
    const none = usageAccount({
      observedAt: null,
      windows: [],
      fault: { kind: 'unreachable', message: 'The provider asked Althar to wait before reading again.' },
    })
    expect(planOf(planUsage([none]), NOW).agents).toEqual([])
  })

  it('gives a model the runtime’s room, an agent’s own default the agent’s, and says when its plan isn’t read', () => {
    const rooms: ReadonlyArray<ModelRoom> = [
      {
        agentId: 'claude-code',
        model: 'opus',
        accountId: 'acc_claude',
        accountName: 'personal',
        several: false,
        leftPercent: 1,
        resetsAt: '2026-10-19T09:00:00.000Z',
        kind: 'weekly',
        label: 'Opus',
      },
      {
        agentId: 'codex',
        model: 'gpt-5.2',
        accountId: 'acc_codex_side',
        accountName: 'side',
        several: true,
        leftPercent: 50,
        resetsAt: RESET,
        kind: 'weekly',
        label: null,
      },
    ]
    const usage = planUsage([codexWork, codexSide, claude, copilot, claudeKey])
    expect(roomOf({ id: 'claude-code:opus' }, rooms, usage, NOW)).toEqual({
      left: 1,
      until: clock('2026-10-19T09:00:00.000Z', NOW),
      account: null,
    })
    expect(roomOf({ id: 'codex:gpt-5.2' }, rooms, usage, NOW)).toEqual({ left: 50, until: clock(RESET, NOW), account: 'side' })
    expect(roomOf({ id: 'claude-code:' }, rooms, usage, NOW)).toEqual({ left: 3, until: clock(RESET, NOW), account: null })
    expect(roomOf({ id: 'copilot:gpt-5' }, rooms, usage, NOW)).toBeNull()
    // Nothing to say of an agent with no plan here.
    expect(roomOf({ id: 'gemini-cli:gemini-3-pro' }, rooms, usage, NOW)).toBeUndefined()
  })
})

/* The app's places under the tabs, as the finder's tests have them. */
const rootRoute = createRootRoute({
  component: () => (
    <TabsFrame>
      <Outlet />
    </TabsFrame>
  ),
})
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => <p>Home screen</p> })
const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$projectId',
  component: () => <textarea aria-label="Message the lead" />,
})

const windowAt = (path: string, usage: PlanUsage, host: Host = fakeHost()) => {
  const router = createRouter({
    routeTree: rootRoute.addChildren([homeRoute, projectRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const fake = fakeClient({
    listProjects: vi.fn(async () => ({ cursor: 3, projects: [project] })),
    getPlanUsage: vi.fn(async () => usage),
  })
  withServices(<RouterProvider router={router} />, fake.client, host)
  return fake
}

const peek = () => screen.queryByRole('dialog', { name: 'Plan usage' })
const gauge = () => screen.findByRole('button', { name: /^Plan usage: / })

describe('the plan gauge in the bar', () => {
  it('shows the agent with least room in its label, from the feed too', async () => {
    const { emit } = windowAt('/', planUsage([codexWork]))
    expect((await gauge()).getAttribute('aria-label')).toBe(`Plan usage: Codex has 40% left, until ${clock(RESET)}`)
    expect(screen.queryByText(/Codex 40%/)).toBeNull()
    act(() => emit({ _tag: 'PlanUsage', usage: planUsage([codexWork, claude]) }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Plan usage: / }).getAttribute('aria-label')).toBe(
        `Plan usage: Claude Code has 3% left, until ${clock(RESET)}`,
      ),
    )
  })

  it('isn’t there while nothing is read, nor for agents that share nothing', async () => {
    windowAt('/', planUsage([copilot, claudeKey]))
    await screen.findByRole('navigation', { name: 'Projects' })
    fireEvent.keyDown(window, { key: 'u', metaKey: true })
    expect(screen.queryByRole('button', { name: /^Plan usage/ })).toBeNull()
    expect(peek()).toBeNull()
  })

  it('opens on Control-U off a Mac, and closes on the same key', async () => {
    windowAt('/projects/p1', planUsage(), fakeHost({ platform: 'linux' }))
    await gauge()
    // ⌘ is not the key there, and neither is Control with Shift.
    fireEvent.keyDown(window, { key: 'u', metaKey: true })
    fireEvent.keyDown(window, { key: 'u', ctrlKey: true, shiftKey: true })
    expect(peek()).toBeNull()
    fireEvent.keyDown(window, { key: 'u', ctrlKey: true })
    await screen.findByRole('dialog', { name: 'Plan usage' })
    fireEvent.keyDown(window, { key: 'U', ctrlKey: true })
    await waitFor(() => expect(peek()).toBeNull())
  })

  it('opens on ⌘U on a Mac, from a field being typed in too', async () => {
    windowAt('/projects/p1', planUsage(), fakeHost({ platform: 'darwin' }))
    await gauge()
    const message = await screen.findByRole('textbox', { name: 'Message the lead' })
    message.focus()
    fireEvent.keyDown(message, { key: 'u', ctrlKey: true })
    expect(peek()).toBeNull()
    fireEvent.keyDown(message, { key: 'u', metaKey: true })
    await screen.findByRole('dialog', { name: 'Plan usage' })
  })

  it('reads every account again as it opens, a row per agent opening in place', async () => {
    const { client } = windowAt('/', planUsage([codexWork, codexSide, claude, copilot]))
    await userEvent.click(await gauge())
    const opened = await screen.findByRole('dialog', { name: 'Plan usage' })
    expect(client.getPlanUsage).toHaveBeenCalledWith({ refresh: true })
    expect(within(opened).getByText('Claude Code is nearly out')).toBeTruthy()
    const [first, second] = within(opened).getAllByRole('button', { expanded: false })
    expect(first?.textContent).toContain('Claude Code')
    expect(second?.textContent).toContain(`side · Weekly limit · until ${clock('2026-10-19T09:00:00.000Z')}`)
    await userEvent.click(second!)
    expect(within(opened).getByText('work')).toBeTruthy()
    expect(within(opened).queryByText(/No reading for/)).toBeNull()
  })
})

describe('each model’s room in the pickers', () => {
  it('reads the rooms for the project, and shows them on each model and beside the chip once nearly out', async () => {
    const fake = fakeClient({
      getPlanUsage: vi.fn(async () => planUsage([codexWork, claude])),
      getModelRooms: vi.fn(async () => [
        {
          agentId: 'codex',
          model: 'gpt-5.2-codex',
          accountId: 'acc_codex_work',
          accountName: 'work',
          several: false,
          leftPercent: 3,
          resetsAt: RESET,
          kind: 'five_hour' as const,
          label: null,
        },
      ]),
    })
    withServices(
      <ModelChoice
        owner="Lead"
        agents={agents.filter((agent) => agent.signIn !== 'signed_out')}
        projectId="p1"
        value={{ agentId: 'codex', model: 'gpt-5.2-codex', effort: null }}
        onChange={vi.fn()}
      />,
      fake.client,
    )
    await screen.findByText('3% left')
    expect(fake.client.getModelRooms).toHaveBeenCalledWith('p1')
    await userEvent.click(screen.getByRole('button', { name: /^Lead: / }))
    expect((await screen.findByRole('radio', { name: /gpt-5\.2-codex/ })).textContent).toContain(`3% · until ${clock(RESET)}`)
  })

  it('reads a shown picker’s rooms again as its project’s rules or an agent’s accounts change', async () => {
    const room = (accountName: string, leftPercent: number) => ({
      agentId: 'codex',
      model: 'gpt-5.2-codex',
      accountId: `acc_codex_${accountName}`,
      accountName,
      several: true,
      leftPercent,
      resetsAt: RESET,
      kind: 'five_hour' as const,
      label: null,
    })
    const getModelRooms = vi.fn(async () => [room('side', 80)])
    const fake = fakeClient({ getPlanUsage: vi.fn(async () => planUsage([codexWork, codexSide])), getModelRooms })
    withServices(
      <ModelChoice
        owner="Lead"
        agents={agents.filter((agent) => agent.signIn !== 'signed_out')}
        projectId="p1"
        value={{ agentId: 'codex', model: 'gpt-5.2-codex', effort: null }}
        onChange={vi.fn()}
      />,
      fake.client,
    )
    await userEvent.click(screen.getByRole('button', { name: /^Lead: / }))
    await waitFor(() => expect(screen.getByRole('radio', { name: /gpt-5\.2-codex/ }).textContent).toContain('80%'))
    // The project stops moving work through Codex's accounts: new work starts on Work, at 3%.
    getModelRooms.mockImplementation(async () => [room('work', 3)])
    act(() => fake.emit(changed('policy', 'p1', null, 'p1')))
    await waitFor(() => expect(screen.getByRole('radio', { name: /gpt-5\.2-codex/ }).textContent).toContain('3%'))
    // Another project's rules leave it be; Work held for a limit reads it again.
    const reads = getModelRooms.mock.calls.length
    act(() => fake.emit(changed('policy', 'p2', null, 'p2')))
    getModelRooms.mockImplementation(async () => [room('side', 80)])
    act(() => fake.emit(changed('account_status', 'acc_codex_work', null, null)))
    await waitFor(() => expect(screen.getByRole('radio', { name: /gpt-5\.2-codex/ }).textContent).toContain('80%'))
    expect(getModelRooms.mock.calls.length).toBe(reads + 1)
  })
})

describe('a step held before its agent ran out', () => {
  it('says it waits for the agent, which isn’t out yet', () => {
    expect(waitsWords('Codex', '14:00', 'review', 3)).toBe('The review waits for Codex until 14:00')
    expect(waitsWords('Codex', '14:00', undefined, 3)).toBe('Waiting for Codex until 14:00')
    expect(waitsWords('Codex', '14:00', 'review', 0)).toBe('The review waits: Codex is out of usage until 14:00')
    expect(waitsWords('Codex', '14:00')).toBe('Codex is out of usage until 14:00')
  })
})
