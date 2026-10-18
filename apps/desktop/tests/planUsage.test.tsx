import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type PlanUsage } from '@althar/contracts'
import { Room } from '@althar/ui'

import type { Host } from '../src/renderer/data/services'
import { useBoard } from '../src/renderer/features/board/useBoard'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useProject } from '../src/renderer/features/project/useProject'
import { TabsFrame } from '../src/renderer/features/tabs/TabsFrame'
import { UsageView } from '../src/renderer/features/usage/UsageView'
import { groupsOf, sourceWords, UsageOpenContext, windowName, windowWords } from '../src/renderer/features/usage/useUsage'
import { coordinatorSnapshot, fakeClient, fakeHost, items, planUsage, project, usageAccount, usageWarning } from './fixtures'
import { useSettingsOf, withServices } from './render'

/*
 * Plan usage in the window: the view over it (every account, its faults, read
 * again), Ctrl or ⌘ U and the bar's button with the count of warnings not yet
 * seen, and the notices in the Talk room of the project that shows.
 */

const NOW = new Date('2026-10-15T10:05:00.000Z')

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
const claudeSignedOut = usageAccount({
  agentId: 'claude-code',
  agentName: 'Claude Code',
  accountId: 'acc_claude_old',
  accountName: 'old',
  source: 'acp',
  observedAt: '2026-10-15T07:05:00.000Z',
  fault: { kind: 'sign_in_again', message: 'Claude Code needs you to sign in again.' },
})
const codexNoData = usageAccount({
  accountId: 'acc_codex_new',
  accountName: 'new',
  source: null,
  observedAt: null,
  plan: null,
  windows: [],
  fault: { kind: 'no_data_yet', message: 'Codex has not reported usage for this account.' },
})

describe('what a window says of a plan', () => {
  it('names a window by its kind, or by its own name beside the kind', () => {
    const at = { resetsAt: null, usedPercent: 1 }
    expect(windowName({ kind: 'five_hour', label: null, ...at })).toBe('5 hours')
    expect(windowName({ kind: 'weekly', label: null, ...at })).toBe('Week')
    expect(windowName({ kind: 'weekly', label: 'Opus', ...at })).toBe('Week · Opus')
    expect(windowName({ kind: 'monthly', label: null, ...at })).toBe('Month')
    expect(windowName({ kind: 'other', label: 'Spend limit', ...at })).toBe('Spend limit')
    expect(windowName({ kind: 'other', label: null, ...at })).toBe('Other')
    expect(windowWords({ kind: 'five_hour', label: null })).toBe('5-hour window')
    expect(windowWords({ kind: 'weekly', label: 'Opus' })).toBe('weekly Opus window')
    expect(windowWords({ kind: 'other', label: 'Spend limit' })).toBe('Spend limit window')
  })

  it('says where the numbers came from, and how old they are', () => {
    expect(sourceWords(usageAccount({ source: 'agent' }), NOW)).toBe('Reported by Codex · 5m ago')
    expect(sourceWords(usageAccount({ source: 'acp_extension', agentName: 'Claude Code' }), NOW)).toBe(
      'From Claude Code’s last report · 5m ago',
    )
    expect(sourceWords(usageAccount({ source: 'endpoint' }), NOW)).toBe('From the provider · 5m ago')
    expect(sourceWords(usageAccount({ source: 'endpoint', observedAt: null }), NOW)).toBe('From the provider')
    expect(sourceWords(claudeKey, NOW)).toBeNull()
  })

  it('groups accounts under their agent, in the runtime’s order, with the share left', () => {
    const groups = groupsOf(planUsage([claudeKey, usageAccount(), claudeSignedOut]), NOW)
    expect(groups.map((group) => [group.name, group.accounts.map((account) => account.name)])).toEqual([
      ['Claude Code', ['gateway', 'old']],
      ['Codex', ['work']],
    ])
    const [meter] = groups[1]?.accounts[0]?.meters ?? []
    expect(meter).toMatchObject({ id: 'five_hour', label: '5 hours', left: 40 })
    expect(groups[1]?.accounts[0]?.plan).toBe('Pro')
  })
})

describe('the usage view', () => {
  const opened = (usage: PlanUsage = planUsage([usageAccount(), claudeKey, claudeSignedOut, codexNoData])) => {
    const fake = fakeClient({ getPlanUsage: vi.fn(async () => usage) })
    const onClose = vi.fn()
    withServices(<UsageView onClose={onClose} />, fake.client)
    return { ...fake, onClose }
  }

  it('shows every account under its agent, with its meters, source and faults', async () => {
    opened()
    const dialog = await screen.findByRole('dialog', { name: 'Plan usage' })
    await within(dialog).findByRole('heading', { name: 'Claude Code' })
    const codex = within(dialog).getByRole('list', { name: 'Codex accounts' })
    const meter = within(codex).getByRole('meter', { name: 'Codex work, 5 hours' })
    expect(meter.getAttribute('value')).toBe('40')
    expect(meter.getAttribute('aria-valuetext')).toMatch(/^40% left, Resets /)
    expect(within(codex).getByText(/^Reported by Codex/)).toBeTruthy()
    // No data is a fault, with its message; not a calm empty row.
    expect(within(codex).getByText('No usage data yet')).toBeTruthy()
    expect(within(codex).getByText('Codex has not reported usage for this account.')).toBeTruthy()
    // Sign in again says so, and keeps the last windows, dated.
    const claude = within(dialog).getByRole('list', { name: 'Claude Code accounts' })
    expect(within(claude).getByText('Sign in again')).toBeTruthy()
    expect(within(claude).getByText('Claude Code needs you to sign in again.')).toBeTruthy()
    // An API key has no plan window, and is calm about it.
    expect(within(claude).getByText('API key – no plan window')).toBeTruthy()
  })

  it('says nothing is read yet, then that there are no accounts', async () => {
    opened(planUsage([]))
    const dialog = await screen.findByRole('dialog', { name: 'Plan usage' })
    await within(dialog).findByText('No agent accounts yet.')
  })

  it('reads every account again on Read again, and shows what comes back', async () => {
    const { client } = opened(planUsage([usageAccount()]))
    const dialog = await screen.findByRole('dialog', { name: 'Plan usage' })
    await within(dialog).findByRole('meter')
    expect(client.getPlanUsage).toHaveBeenLastCalledWith()
    vi.mocked(client.getPlanUsage).mockResolvedValueOnce(
      planUsage([usageAccount({ windows: [{ kind: 'five_hour', label: null, usedPercent: 95, resetsAt: null }] })]),
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Read again' }))
    expect(client.getPlanUsage).toHaveBeenLastCalledWith({ refresh: true })
    await waitFor(() => expect(within(dialog).getByRole('meter').getAttribute('value')).toBe('5'))
    expect(within(dialog).getByText('Reset time not given')).toBeTruthy()
  })

  it('says why a read again failed, and keeps what it had', async () => {
    const { client } = opened(planUsage([usageAccount()]))
    const dialog = await screen.findByRole('dialog', { name: 'Plan usage' })
    await within(dialog).findByRole('meter')
    vi.mocked(client.getPlanUsage).mockRejectedValueOnce(new ApiError({ reason: 'UsageFailed', message: 'Codex is not installed.' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Read again' }))
    expect((await within(dialog).findByRole('alert')).textContent).toBe('Codex is not installed.')
    expect(within(dialog).getByRole('meter')).toBeTruthy()
  })

  it('shows a change the feed brings, whole', async () => {
    const { emit } = opened(planUsage([usageAccount()]))
    const dialog = await screen.findByRole('dialog', { name: 'Plan usage' })
    await within(dialog).findByRole('meter')
    act(() => emit({ _tag: 'PlanUsage', usage: planUsage([usageAccount({ accountName: 'night' })]) }))
    await within(dialog).findByText('night')
  })

  it('closes on Escape', async () => {
    const { onClose } = opened()
    const dialog = await screen.findByRole('dialog', { name: 'Plan usage' })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
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

const usageDialog = () => screen.queryByRole('dialog', { name: 'Plan usage' })

describe('opening plan usage', () => {
  it('opens on Control-U off a Mac, and closes on the same key', async () => {
    windowAt('/projects/p1', planUsage(), fakeHost({ platform: 'linux' }))
    await screen.findByRole('navigation', { name: 'Projects' })
    // ⌘ is not the key there, and neither is Control with Shift.
    fireEvent.keyDown(window, { key: 'u', metaKey: true })
    fireEvent.keyDown(window, { key: 'u', ctrlKey: true, shiftKey: true })
    expect(usageDialog()).toBeNull()
    fireEvent.keyDown(window, { key: 'u', ctrlKey: true })
    await screen.findByRole('dialog', { name: 'Plan usage' })
    fireEvent.keyDown(window, { key: 'U', ctrlKey: true })
    await waitFor(() => expect(usageDialog()).toBeNull())
  })

  it('opens on ⌘U on a Mac, and not on Control-U', async () => {
    windowAt('/', planUsage(), fakeHost({ platform: 'darwin' }))
    await screen.findByRole('navigation', { name: 'Projects' })
    fireEvent.keyDown(window, { key: 'u', ctrlKey: true })
    expect(usageDialog()).toBeNull()
    fireEvent.keyDown(window, { key: 'u', metaKey: true })
    await screen.findByRole('dialog', { name: 'Plan usage' })
  })

  it('opens from a field being typed in, as the finder does', async () => {
    windowAt('/projects/p1', planUsage())
    const message = await screen.findByRole('textbox', { name: 'Message the lead' })
    message.focus()
    fireEvent.keyDown(message, { key: 'u', metaKey: true })
    await screen.findByRole('dialog', { name: 'Plan usage' })
  })

  it('opens from the bar’s button, which says how many warnings wait, from the feed too', async () => {
    const { emit } = windowAt('/', planUsage([usageAccount()], [usageWarning(), usageWarning({ windowKey: 'weekly', kind: 'weekly' })]))
    const button = await screen.findByRole('button', { name: 'Usage, 2 warnings not seen' })
    expect(button.textContent).toContain('2')
    act(() => emit({ _tag: 'PlanUsage', usage: planUsage([usageAccount()], [usageWarning()]) }))
    await screen.findByRole('button', { name: 'Usage, 1 warning not seen' })
    act(() => emit({ _tag: 'PlanUsage', usage: planUsage() }))
    const quiet = await screen.findByRole('button', { name: 'Usage' })
    expect(quiet.textContent).not.toMatch(/\d/)
    await userEvent.click(quiet)
    await screen.findByRole('dialog', { name: 'Plan usage' })
    expect(quiet.getAttribute('aria-expanded')).toBe('true')
  })
})

describe('the notices in the Talk room', () => {
  const warnings = [
    usageWarning(),
    usageWarning({
      accountId: 'acc_claude',
      accountName: 'personal',
      agentId: 'claude-code',
      agentName: 'Claude Code',
      windowKey: 'weekly:Opus',
      kind: 'weekly',
      label: 'Opus',
      remainingPercent: 10,
      resetsAt: null,
    }),
  ]

  function Project({ room = Room.Talk, open = vi.fn() }: { room?: Room; open?: () => void }) {
    return (
      <UsageOpenContext.Provider value={open}>
        <ProjectView
          model={useProject('p1')}
          board={useBoard('p1')}
          connections={useConnections()}
          onTask={vi.fn()}
          settings={useSettingsOf('p1')}
          room={room}
        />
      </UsageOpenContext.Provider>
    )
  }
  const shown = (room = Room.Talk, open = vi.fn()) => {
    const fake = fakeClient({
      listProjects: vi.fn(async () => ({ cursor: 3, projects: [project] })),
      getCoordinator: vi.fn(async () => coordinatorSnapshot({ items: [items.says('Hello')] })),
      getPlanUsage: vi.fn(async () => planUsage([usageAccount()], warnings)),
    })
    withServices(<Project room={room} open={open} />, fake.client)
    return { ...fake, open }
  }

  it('shows each warning not yet seen at the foot of the conversation, in words', async () => {
    shown()
    await screen.findByText('Hello')
    const notices = await screen.findAllByRole('region', { name: 'Plan usage' })
    expect(notices.map((notice) => within(notice).getByRole('status').textContent)).toEqual([
      expect.stringMatching(/^Codex · work: 25% of the 5-hour window is left, until /),
      'Claude Code · personal: 10% of the weekly Opus window is left.',
    ])
  })

  it('shows none in the board, which is not the conversation', async () => {
    const { client } = shown(Room.Board)
    await waitFor(() => expect(client.getBoard).toHaveBeenCalled())
    expect(client.getPlanUsage).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'Plan usage' })).toBeNull()
  })

  it('says to the runtime that one is seen, and it goes at once, here and everywhere', async () => {
    const { client, emit } = shown()
    const notices = await screen.findAllByRole('region', { name: 'Plan usage' })
    await userEvent.click(within(notices[0] as HTMLElement).getByRole('button', { name: 'Seen' }))
    expect(client.acknowledgeUsageWarnings).toHaveBeenCalledWith([{ accountId: 'acc_codex_work', windowKey: 'five_hour' }])
    await waitFor(() => expect(screen.getAllByRole('region', { name: 'Plan usage' })).toHaveLength(1))
    // The runtime's word, whole, takes the other away too.
    act(() => emit({ _tag: 'PlanUsage', usage: planUsage() }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Plan usage' })).toBeNull())
  })

  it('comes back, read again, if the runtime could not take it', async () => {
    const { client } = shown()
    vi.mocked(client.acknowledgeUsageWarnings).mockRejectedValueOnce(new Error('no'))
    const notices = await screen.findAllByRole('region', { name: 'Plan usage' })
    await userEvent.click(within(notices[0] as HTMLElement).getByRole('button', { name: 'Seen' }))
    await waitFor(() => expect(screen.getAllByRole('region', { name: 'Plan usage' })).toHaveLength(2))
  })

  it('opens the usage view', async () => {
    const { open } = shown()
    const notices = await screen.findAllByRole('region', { name: 'Plan usage' })
    await userEvent.click(within(notices[1] as HTMLElement).getByRole('button', { name: 'Open usage' }))
    expect(open).toHaveBeenCalledOnce()
  })

  it('is not a turn or an item: the thread holds what it held', async () => {
    const { client } = shown()
    await screen.findAllByRole('region', { name: 'Plan usage' })
    expect(client.send).not.toHaveBeenCalled()
    expect(screen.getAllByText('Hello')).toHaveLength(1)
  })
})
