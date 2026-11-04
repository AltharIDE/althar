import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type BoardSnapshot, type BoardTask } from '@althar/contracts'

import { BoardView } from '../src/renderer/features/board/BoardView'
import { lanesOf } from '../src/renderer/features/board/lanes'
import { ChangeTeam, teamChangeOf } from '../src/renderer/features/team/Team'
import { agents, card, fakeClient } from './fixtures'
import { withServices } from './render'

const NOW = '2026-10-01T10:00:00.000Z'

const task = (overrides: Partial<BoardTask> = {}): BoardTask => ({
  ...card(),
  state: 'open',
  createdAt: '2026-10-01T09:00:00.000Z',
  settledAt: null,
  changed: null,
  here: [],
  ...overrides,
})

const held = task({
  taskId: 'h',
  threadId: 'thh',
  title: 'Bring a branch up to date',
  phase: 'held',
  plan: { ...card().plan!, id: 'plh', startsAt: null },
})
/** Started, its first step waiting for a free agent, nothing of it begun. */
const queued = task({
  taskId: 'q',
  threadId: 'thq',
  title: 'Follow every open PR',
  phase: 'running',
  inLine: true,
  planWaits: true,
  queued: { busy: 4, atOnce: 4 },
  plan: { ...card().plan!, id: 'plq', startsAt: null },
})
const running = task({ taskId: 'r', threadId: 'thr', title: 'At work', phase: 'running', step: 'implement' })

const board = (tasks: ReadonlyArray<BoardTask>): BoardSnapshot => ({ cursor: 1, tasks: [...tasks], calls: [], settledTotal: 0 })
const rowOf = (title: string) => within(screen.getByRole('button', { name: title }).closest('article') as HTMLElement)

describe('changing a plan’s team before it begins', () => {
  it('can, held or on its countdown and started but waiting with nothing begun; not once it is under way', () => {
    expect(teamChangeOf(held)).toBe('starts')
    expect(teamChangeOf(task({ phase: 'planned' }))).toBe('starts')
    expect(teamChangeOf(queued)).toBe('waits')
    expect(teamChangeOf({ ...queued, planWaits: false })).toBeNull()
    expect(teamChangeOf(running)).toBeNull()
    expect(teamChangeOf({ ...held, plan: null })).toBeNull()
  })

  it('starts a held plan from its row, and opens its team from the row’s menu', async () => {
    const team = { start: vi.fn(), change: vi.fn() }
    withServices(
      <BoardView lanes={lanesOf(board([held, queued]))} agents={agents} now={NOW} onOpen={vi.fn()} team={team} />,
      fakeClient().client,
    )
    await userEvent.click(rowOf(held.title).getByRole('button', { name: 'Start' }))
    expect(team.start).toHaveBeenCalledWith('plh')

    await userEvent.click(rowOf(held.title).getByRole('button', { name: 'More for this task' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Start' })).toBeTruthy()
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Change the team…' }))
    expect(team.change).toHaveBeenCalledWith('h')
  })

  it('offers no Start on a plan that starts by itself once an agent is free, only its team', async () => {
    const team = { start: vi.fn(), change: vi.fn() }
    withServices(
      <BoardView lanes={lanesOf(board([held, queued]))} agents={agents} now={NOW} onOpen={vi.fn()} team={team} />,
      fakeClient().client,
    )
    expect(rowOf(queued.title).queryByRole('button', { name: 'Start' })).toBeNull()
    await userEvent.click(rowOf(queued.title).getByRole('button', { name: 'More for this task' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).queryByRole('menuitem', { name: 'Start' })).toBeNull()
    expect(within(menu).getByRole('menuitem', { name: 'Change the team…' })).toBeTruthy()
  })

  it('leaves a row alone without the board’s team actions', () => {
    withServices(<BoardView lanes={lanesOf(board([held]))} agents={agents} now={NOW} onOpen={vi.fn()} />, fakeClient().client)
    expect(rowOf(held.title).queryByRole('button', { name: 'Start' })).toBeNull()
    expect(rowOf(held.title).queryByRole('button', { name: 'More for this task' })).toBeNull()
  })

  it('changes the plan and starts it, from the dialog, with what the person changed', async () => {
    const { client } = fakeClient()
    const onClose = vi.fn()
    withServices(<ChangeTeam projectId="p1" task={held} agents={agents} onClose={onClose} />, client)
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText('It knows the code.')).toBeTruthy()
    // Taking the review off is kept until the person presses.
    await userEvent.click(dialog.getByRole('button', { name: /^Review:/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Remove from this step' }))
    expect(client.changePlan).not.toHaveBeenCalled()
    expect(dialog.getByText('No review')).toBeTruthy()

    await userEvent.click(dialog.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(client.startPlan).toHaveBeenCalledWith('plh'))
    expect(client.changePlan).toHaveBeenCalledWith(
      'plh',
      [
        { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
        { key: 'review', agentId: 'codex', model: null, skipped: true },
      ],
      null,
    )
    expect(vi.mocked(client.changePlan).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(client.startPlan).mock.invocationCallOrder[0]!)
    expect(onClose).toHaveBeenCalled()
  })

  it('only saves a plan that starts by itself, and says why a save failed', async () => {
    const { client } = fakeClient({
      changePlan: vi.fn(async () => Promise.reject(new ApiError({ reason: 'Busy', message: 'The plan has begun.' }))),
    })
    const onClose = vi.fn()
    withServices(<ChangeTeam projectId="p1" task={queued} agents={agents} onClose={onClose} />, client)
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.queryByRole('button', { name: 'Start' })).toBeNull()
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }))
    expect(await dialog.findByRole('alert')).toHaveProperty('textContent', 'The plan has begun.')
    expect(client.startPlan).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
