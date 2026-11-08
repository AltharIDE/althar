import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
const WEEK = '2026-10-19T09:00:00.000Z'

// The window reads its windows at NOW, as the plan's own tests do: a window past its reset is no longer shown.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})
afterEach(() => {
  vi.useRealTimers()
})

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
/** Claude Code with its five hours nearly out until RESET, and 60% of its week left. */
const claudeBoth = usageAccount({
  agentId: 'claude-code',
  agentName: 'Claude Code',
  accountId: 'acc_claude',
  accountName: 'personal',
  source: 'acp_extension',
  windows: [
    { kind: 'five_hour', label: null, usedPercent: 97, resetsAt: RESET },
    { kind: 'weekly', label: null, usedPercent: 40, resetsAt: WEEK },
  ],
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

  it('shows OpenCode Go as its plan: read like any other, connected where nothing reads it, and signed in again from its row', () => {
    const goWindows = [
      { kind: 'five_hour' as const, label: null, usedPercent: 9, resetsAt: RESET },
      { kind: 'weekly' as const, label: null, usedPercent: 42, resetsAt: WEEK },
    ]
    const go = usageAccount({
      agentId: 'opencode',
      agentName: 'OpenCode',
      accountId: 'acc_opencode',
      plan: 'OpenCode Go',
      source: 'agent',
      windows: goWindows,
    })
    const [read] = planOf(planUsage([go]), NOW).agents
    expect([read?.name, read?.left, read?.limit]).toEqual(['OpenCode Go', 58, 'weekly limit'])
    const why = 'OpenCode reads Go’s usage only through an OpenCode Console sign-in, and this account has none.'
    const connected = { ...go, source: null, observedAt: null, windows: [], noReading: why }
    const [unread] = planOf(planUsage([connected, claudeBoth]), NOW).agents.toReversed()
    expect([unread?.name, unread?.connected, unread?.stopped, unread?.accounts[0]?.fault]).toEqual([
      'OpenCode Go',
      'Connected',
      undefined,
      why,
    ])
    // Connected but unread, after the agents with a figure, and never the one that counts.
    expect(planOf(planUsage([connected, claudeBoth]), NOW).agents[0]?.name).toBe('Claude Code')
    const refused = { ...connected, fault: { kind: 'sign_in_again' as const, message: 'OpenCode Go needs signing in again.' } }
    expect(planOf(planUsage([refused]), NOW).agents[0]).toMatchObject({ name: 'OpenCode Go', stopped: 'Signed out', signIn: true })
    // Refused with numbers read: kept in the detail, its row signed in again the same way.
    expect(planOf(planUsage([{ ...go, fault: refused.fault }]), NOW).agents[0]).toMatchObject({ stopped: 'Signed out', signIn: true })
    // A plan that reports nothing and names no plan of its agent's own (Copilot) still has no row.
    expect(planOf(planUsage([copilot]), NOW).agents).toEqual([])
  })

  it('shows OpenCode Go connected where an old account’s key was refused and a new account’s works, and where its first read failed', () => {
    const goWindows = [{ kind: 'weekly' as const, label: null, usedPercent: 42, resetsAt: WEEK }]
    const again = { kind: 'sign_in_again' as const, message: 'OpenCode Go needs signing in again.' }
    // Personal: Go read through its Console sign-in, its expired key refused. Account 2: a fresh Go key, nothing reads it.
    const personal = usageAccount({
      agentId: 'opencode',
      agentName: 'OpenCode',
      accountId: 'acc_personal',
      accountName: 'Personal',
      plan: 'OpenCode Go',
      source: 'agent',
      windows: goWindows,
      fault: again,
    })
    const why = 'OpenCode reads Go’s usage only through an OpenCode Console sign-in, and this account has none.'
    const fresh = usageAccount({
      agentId: 'opencode',
      agentName: 'OpenCode',
      accountId: 'acc_fresh',
      accountName: 'Account 2',
      plan: 'OpenCode Go',
      source: null,
      observedAt: null,
      windows: [],
      noReading: why,
    })
    const [both] = planOf(planUsage([personal, fresh]), NOW).agents
    expect(both).toMatchObject({ name: 'OpenCode Go', connected: 'Connected' })
    expect(both?.stopped).toBeUndefined()
    expect(both?.signIn).toBeUndefined()
    // Each account says how it stands in the detail.
    expect(both?.accounts.map((account) => [account.name, account.fault])).toEqual([
      ['Personal', 'OpenCode Go needs signing in again.'],
      ['Account 2', why],
    ])
    // Account 2 refused too: nothing runs, so the row signs Go in again.
    expect(planOf(planUsage([personal, { ...fresh, fault: again }]), NOW).agents[0]).toMatchObject({ stopped: 'Signed out', signIn: true })
    // A first read that failed, with Go's key there: connected, and why it has no numbers.
    const timedOut = 'OpenCode couldn’t read Go’s usage: timed out.'
    const failed = { ...fresh, fault: { kind: 'unreachable' as const, message: timedOut }, noReading: timedOut }
    expect(planOf(planUsage([failed]), NOW).agents[0]).toMatchObject({
      name: 'OpenCode Go',
      connected: 'Connected',
      accounts: [{ fault: timedOut }],
    })
  })

  it('gives OpenCode Go’s models Go’s room in the pickers, and says nothing for OpenCode’s per-use ones', () => {
    const connected = usageAccount({
      agentId: 'opencode',
      agentName: 'OpenCode',
      accountId: 'acc_opencode',
      plan: 'OpenCode Go',
      source: null,
      observedAt: null,
      windows: [],
      noReading: 'OpenCode reads Go’s usage only through an OpenCode Console sign-in, and this account has none.',
    })
    expect(roomOf({ id: 'opencode:opencode-go/glm-5.3' }, [], planUsage([connected]), NOW)).toBeNull()
    expect(roomOf({ id: 'opencode:opencode/deepseek-v4.1-flash' }, [], planUsage([connected]), NOW)).toBeUndefined()
    // OpenCode's own default may be Zen's as well as Go's: nothing said of it, though Go is read.
    const read = {
      ...connected,
      source: 'agent' as const,
      observedAt: NOW.toISOString(),
      noReading: null,
      windows: [{ kind: 'weekly' as const, label: null, usedPercent: 42, resetsAt: WEEK }],
    }
    expect(roomOf({ id: 'opencode:' }, [], planUsage([read]), NOW)).toBeUndefined()
  })

  it('signs OpenCode Go in again from its row, in Settings, with its sign-in started', async () => {
    const refused = usageAccount({
      agentId: 'opencode',
      agentName: 'OpenCode',
      accountId: 'acc_opencode',
      plan: 'OpenCode Go',
      source: null,
      observedAt: null,
      windows: [],
      noReading: 'OpenCode reads Go’s usage only through an OpenCode Console sign-in, and this account has none.',
      fault: { kind: 'sign_in_again', message: 'OpenCode Go needs signing in again.' },
    })
    const signIn = vi.fn()
    render(<PlanGauge agents={planOf(planUsage([refused]), NOW).agents} defaultOpen onSignIn={signIn} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }))
    expect(signIn).toHaveBeenCalledWith('opencode')
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

  it('ends every window’s row with the time left, the exact time on hover, that one reset is not read since, and that no time was given', () => {
    const account = usageAccount({
      windows: [
        { kind: 'five_hour', label: null, usedPercent: 21, resetsAt: RESET },
        { kind: 'weekly', label: null, usedPercent: 50, resetsAt: WEEK },
        { kind: 'weekly', label: 'Opus', usedPercent: 40, resetsAt: null },
      ],
    })
    const windows = (at: Date) => planOf(planUsage([account]), at).agents[0]?.accounts[0]?.windows
    expect(windows(NOW)?.map((window) => [window.resets, window.resetsTitle])).toEqual([
      ['in 4h 55m', `Resets ${clock(RESET, NOW)} · in 4h 55m`],
      ['in 3d 22h', `Resets ${clock(WEEK, NOW)} · in 3d 22h`],
      ['no reset time', 'The provider gave no reset time for this window.'],
    ])
    // The time left moves with the clock, though nothing is read again.
    const later = new Date('2026-10-15T12:35:00.000Z')
    expect(windows(later)?.[0]?.resets).toBe('in 2h 25m')
    // Reset since it was read: said so, with no figure that could read as an empty limit.
    const after = new Date('2026-10-15T15:01:00.000Z')
    expect(windows(after)?.[0]).toMatchObject({
      resets: `reset ${clock(RESET, after)}`,
      resetsTitle: `Reset at ${clock(RESET, after)} · not read since`,
      note: 'not read since',
      unread: true,
    })
    expect(windows(after)?.[1]).not.toHaveProperty('unread')
  })

  it('shows the windows the runtime sends apart as reset, beside those still read, as not read since', () => {
    // The runtime's clock has passed the five hours: it sends them in `resetWindows`, the week in `windows`.
    const [fiveHours, week] = claudeBoth.windows
    const sent = planUsage([
      { ...claudeBoth, windows: week === undefined ? [] : [week], resetWindows: fiveHours === undefined ? [] : [fiveHours] },
    ])
    const rows = (at: Date) => planOf(sent, at).agents[0]?.accounts[0]?.windows.map((window) => [window.label, window.unread === true])
    expect(rows(NOW)).toEqual([
      ['Week', false],
      ['5 hours', true],
    ])
    // The figure is still the week's alone.
    expect(planOf(sent, NOW).agents[0]).toMatchObject({ left: 60, limit: 'weekly limit' })
  })

  it('shows every window as not read since where the runtime sends all of them apart', () => {
    const after = new Date('2026-10-20T00:00:00.000Z')
    const sent = planUsage([{ ...claudeBoth, windows: [], resetWindows: claudeBoth.windows, resetSince: true }])
    const [agent] = planOf(sent, after).agents
    expect(agent).toMatchObject({ unread: 'Not read since reset' })
    expect(agent?.accounts[0]?.windows.map((window) => [window.label, window.unread, window.resets])).toEqual(
      claudeBoth.windows.map((window) => [windowName(window), true, `reset ${clock(window.resetsAt ?? '', after)}`]),
    )
  })

  it('leaves out a window whose reset has passed, as unknown, and a model’s room with it', () => {
    const rooms: ReadonlyArray<ModelRoom> = [
      {
        agentId: 'claude-code',
        model: 'sonnet',
        accountId: 'acc_claude',
        accountName: 'personal',
        several: false,
        leftPercent: 3,
        resetsAt: RESET,
        kind: 'five_hour',
        label: null,
      },
    ]
    const usage = planUsage([claudeBoth])
    const after = new Date('2026-10-15T15:01:00.000Z')
    expect(planOf(usage, NOW).agents.map((agent) => [agent.left, agent.limit])).toEqual([[3, 'five-hour limit']])
    expect(roomOf({ id: 'claude-code:sonnet' }, rooms, usage, NOW)).toMatchObject({ left: 3 })
    // Its five hours have started again, and how much of them is used no one has said yet: the week says, alone.
    const [agent] = planOf(usage, after).agents
    expect([agent?.left, agent?.limit, agent?.accounts[0]?.windows.map((window) => window.label)]).toEqual([
      60,
      'weekly limit',
      ['5 hours', 'Week'],
    ])
    expect(roomOf({ id: 'claude-code:sonnet' }, rooms, usage, after)).toBeUndefined()
    expect(roomOf({ id: 'claude-code:' }, rooms, usage, after)).toEqual({ left: 60, until: clock(WEEK, after), account: null })
    // With none of its windows still known, it has no figure, and a model's room is no reading, never all of its plan.
    const fiveHours = planUsage([{ ...claudeBoth, windows: claudeBoth.windows.slice(0, 1) }])
    expect(planOf(fiveHours, after).agents).toMatchObject([
      { id: 'claude-code', unread: 'Not read since reset', accounts: [{ windows: [{ unread: true }] }] },
    ])
    expect(roomOf({ id: 'claude-code:sonnet' }, rooms, fiveHours, after)).toBeNull()
    expect(roomOf({ id: 'claude-code:' }, rooms, fiveHours, after)).toBeNull()
  })

  it('keeps an agent whose windows have all reset in the peek, with why it wasn’t read again, after every one with a figure', () => {
    const after = new Date('2026-10-20T00:00:00.000Z')
    const codex = usageAccount({ windows: [{ kind: 'weekly', label: null, usedPercent: 30, resetsAt: '2026-10-25T00:00:00.000Z' }] })
    for (const [fault, message] of [
      [{ kind: 'expired', message: 'Its sign-in has expired.' }, 'Its sign-in has expired.'],
      // Even one that passes on its own: with no numbers to keep to, it's all there is to say.
      [{ kind: 'unreachable', message: 'The provider could not be reached.' }, 'The provider could not be reached.'],
    ] as const) {
      const { agents } = planOf(planUsage([{ ...claudeBoth, fault }, codex]), after)
      expect(agents.map((agent) => [agent.name, agent.unread, agent.accounts.map((account) => account.fault)])).toEqual([
        [codex.agentName, undefined, [null]],
        ['Claude Code', 'Not read since reset', [message]],
      ])
    }
    // As the runtime sends it once every window has reset by its own clock: none of them, and that they reset.
    const sent = planUsage([
      { ...claudeBoth, windows: [], resetSince: true, fault: { kind: 'expired', message: 'Its sign-in has expired.' } },
    ])
    expect(
      planOf(sent, after).agents.map((agent) => [agent.unread, agent.accounts.map((account) => [account.age, account.fault])]),
    ).toEqual([['Not read since reset', [[expect.stringMatching(/^read /), 'Its sign-in has expired.']]]])
    // Signed out as well, it can't run: said as it is, not as unread.
    const [out] = planOf(planUsage([{ ...claudeBoth, fault: { kind: 'sign_in_again', message: 'Sign in.' } }]), after).agents
    expect([out?.stopped, out?.unread]).toEqual(['Signed out', undefined])
    // One never read with windows has nothing to say there yet, as before.
    expect(planOf(planUsage([{ ...claudeBoth, windows: [] }]), after).agents).toEqual([])
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

  it('leaves out a window as its reset passes while it shows, though nothing is read again', async () => {
    vi.useRealTimers()
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: new Date('2026-10-15T14:59:30.000Z') })
    windowAt('/', planUsage([claudeBoth]))
    expect((await gauge()).getAttribute('aria-label')).toBe(`Plan usage: Claude Code has 3% left, until ${clock(RESET)}`)
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByRole('button', { name: /^Plan usage: / }).getAttribute('aria-label')).toBe(
      `Plan usage: Claude Code has 60% left, until ${clock(WEEK)}`,
    )
  })

  it('isn’t there while nothing is read, nor for agents that share nothing', async () => {
    windowAt('/', planUsage([copilot, claudeKey]))
    await screen.findByRole('navigation', { name: 'Projects' })
    fireEvent.keyDown(window, { key: 'u', metaKey: true })
    expect(screen.queryByRole('button', { name: /^Plan usage/ })).toBeNull()
    expect(peek()).toBeNull()
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
    await screen.findByText(`3% left · until ${clock(RESET)}`)
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
