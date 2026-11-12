import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type BoardSnapshot, type BoardTask } from '@althar/contracts'

import { BoardView } from '../src/renderer/features/board/BoardView'
import { lanesOf } from '../src/renderer/features/board/lanes'
import { canHold, ChangeTeam, teamChangeOf } from '../src/renderer/features/team/Team'
import { agents, card, change, fakeClient } from './fixtures'
import { servicesFor, withServices } from './render'
import { ServicesProvider } from '../src/renderer/data/services'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useBoard } from '../src/renderer/features/board/useBoard'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { useProject } from '../src/renderer/features/project/useProject'
import { fakeHost } from './fixtures'
import { useSettingsOf } from './render'

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
  holdable: true,
  queued: { busy: 4, atOnce: 4 },
  plan: { ...card().plan!, id: 'plq', startsAt: null },
})
const running = task({ taskId: 'r', threadId: 'thr', title: 'At work', phase: 'running', step: 'implement' })

const board = (tasks: ReadonlyArray<BoardTask>): BoardSnapshot => ({ cursor: 1, tasks: [...tasks], calls: [], settledTotal: 0 })
const rowOf = (title: string) => within(screen.getByRole('button', { name: title }).closest('article') as HTMLElement)

describe('changing the team of a task that has begun', () => {
  const atWork = (overrides: Partial<BoardTask> = {}) => ({ ...running, reviewerChange: 'now' as const, ...overrides })
  const opened = (overrides: Partial<BoardTask> = {}, client = fakeClient().client) => {
    withServices(<ChangeTeam projectId="p1" task={atWork(overrides)} agents={agents} onClose={vi.fn()} />, client)
    return within(screen.getByRole('dialog'))
  }

  it('saves both steps through the task, with no Start and no ending to pick, and says when the lead changes', async () => {
    const { client } = fakeClient()
    const dialog = opened({}, client)
    expect(dialog.queryByRole('button', { name: 'Start' })).toBeNull()
    expect(dialog.queryByText('When the work is done')).toBeNull()
    expect(dialog.getByText('From its next turn.')).toBeTruthy()
    await userEvent.click(dialog.getByRole('button', { name: /^Review:/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Remove from this step' }))
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(client.changeTeam).toHaveBeenCalledWith('r', [
        { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
        { key: 'review', agentId: 'codex', model: null, skipped: true },
      ]),
    )
    expect(client.changePlan).not.toHaveBeenCalled()
  })

  it('says a reviewer change in a round under way starts from the next round', () => {
    const dialog = opened({ reviewerChange: 'next_round' })
    expect(dialog.getByText('From the next round.')).toBeTruthy()
    expect(dialog.getByRole('button', { name: /^Review:/ })).toBeTruthy()
  })

  it('shows the reviewer as it stays once the review is done, and says so', () => {
    const dialog = opened({ reviewerChange: 'never', phase: 'ready' })
    expect(dialog.queryByRole('button', { name: /^Review:/ })).toBeNull()
    expect(dialog.getByText('The review is done, so the reviewer stays.')).toBeTruthy()
    // The lead still changes.
    expect(dialog.getByRole('button', { name: /^Implement:/ })).toBeTruthy()
    expect(dialog.getByRole('button', { name: 'Save' })).toBeTruthy()
  })

  it('offers adding a review to a change that has none, and shows a plain task or a review only what it has', () => {
    const skipped = (kind: BoardTask['kind']) => ({
      kind,
      plan: { ...card().plan!, steps: card().plan!.steps.map((step) => (step.key === 'review' ? { ...step, skipped: true } : step)) },
    })
    opened(skipped('change'))
    expect(screen.getByRole('button', { name: 'Add a review' })).toBeTruthy()
    cleanup()
    const plain = opened(skipped('plain'))
    expect(plain.queryByText('No review')).toBeNull()
    expect(plain.queryByRole('button', { name: 'Add a review' })).toBeNull()
    expect(plain.getByRole('button', { name: /^Implement:/ })).toBeTruthy()
  })

  it('adds a skipped review back to a change whose work is up, and says its review starts now', async () => {
    const skipped = {
      kind: 'change' as const,
      phase: 'ready' as const,
      change: change({ state: 'open' }),
      reviewerChange: 'now' as const,
      plan: { ...card().plan!, steps: card().plan!.steps.map((step) => (step.key === 'review' ? { ...step, skipped: true } : step)) },
    }
    const { client } = fakeClient()
    const dialog = opened(skipped, client)
    expect(dialog.getByText('No review')).toBeTruthy()
    await userEvent.click(dialog.getByRole('button', { name: 'Add a review' }))
    expect(dialog.getByText('Its review starts now, on the change as it stands.')).toBeTruthy()
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(client.changeTeam).toHaveBeenCalledWith('r', [
        { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
        { key: 'review', agentId: 'codex', model: null, skipped: false },
      ]),
    )
  })

  it('offers adding a review to a plan made with no review step at all, and saves it as one', async () => {
    const none = (kind: BoardTask['kind']) => ({
      kind,
      plan: { ...card().plan!, steps: card().plan!.steps.filter((step) => step.key !== 'review') },
    })
    const { client } = fakeClient()
    const dialog = opened(none('change'), client)
    await userEvent.click(dialog.getByRole('button', { name: 'Add a review' }))
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(client.changeTeam).toHaveBeenCalledWith('r', [
        { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
        { key: 'review', agentId: 'codex', model: null, skipped: false },
      ]),
    )
    cleanup()
    // A plain task has no review to add, and a change whose review is done can't take one.
    const plain = opened(none('plain'))
    expect(plain.queryByRole('button', { name: 'Add a review' })).toBeNull()
    cleanup()
    const done = opened({ ...none('change'), reviewerChange: 'never' })
    expect(done.queryByRole('button', { name: 'Add a review' })).toBeNull()
  })

  it('refuses a merged task with a short reason, and cannot be saved', () => {
    const dialog = opened({ phase: 'ready', change: change({ state: 'merged' }) })
    expect(dialog.getByRole('alert').textContent).toBe('It’s merged, so its team stays.')
    expect(dialog.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('says it settled, rather than going with what was picked, once it settles meanwhile', async () => {
    const { client } = fakeClient()
    const services = servicesFor(client, fakeHost())
    const view = withServices(<ChangeTeam projectId="p1" task={atWork()} agents={agents} onClose={vi.fn()} />, client)
    view.rerender(
      <ServicesProvider value={services}>
        <ChangeTeam projectId="p1" task={null} agents={agents} onClose={vi.fn()} />
      </ServicesProvider>,
    )
    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByRole('alert').textContent).toBe('It’s settled, so its team stays.')
    expect(dialog.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('keeps a row on the board without a team menu: it is the task’s own menu that changes the team', () => {
    const team = { projectId: 'p1', start: vi.fn(async () => {}), hold: vi.fn(async () => {}), change: vi.fn() }
    withServices(
      <BoardView lanes={lanesOf(board([running]))} agents={agents} now={NOW} onOpen={vi.fn()} team={team} />,
      fakeClient().client,
    )
    expect(rowOf(running.title).queryByRole('button', { name: 'The team' })).toBeNull()
  })
})

describe('changing a plan’s team before it begins', () => {
  it('starts or only changes while it hasn’t begun, and only changes once its first step waits', () => {
    expect(teamChangeOf(held)).toBe('starts')
    expect(teamChangeOf(task({ phase: 'planned' }))).toBe('starts')
    expect(teamChangeOf(queued)).toBe('waits')
    expect(teamChangeOf({ ...queued, planWaits: false })).toBe('begun')
    expect(teamChangeOf({ ...held, plan: null })).toBeNull()
  })

  it('can, at any time after it begins, until it is settled', () => {
    expect(teamChangeOf(running)).toBe('begun')
    for (const phase of ['waiting', 'ready', 'kept', 'stopped'] as const) expect(teamChangeOf({ ...running, phase })).toBe('begun')
    expect(teamChangeOf({ ...running, phase: 'settled' })).toBeNull()
    expect(teamChangeOf({ ...running, phase: 'drafting' })).toBeNull()
    expect(teamChangeOf({ ...running, plan: null })).toBeNull()
  })

  it('starts a held plan from its row, and opens its team from the row’s menu', async () => {
    const team = { projectId: 'p1', start: vi.fn(async () => {}), hold: vi.fn(async () => {}), change: vi.fn() }
    withServices(
      <BoardView lanes={lanesOf(board([held, queued]))} agents={agents} now={NOW} onOpen={vi.fn()} team={team} />,
      fakeClient().client,
    )
    await userEvent.click(rowOf(held.title).getByRole('button', { name: 'Start' }))
    expect(team.start).toHaveBeenCalledWith('plh')

    await userEvent.click(rowOf(held.title).getByRole('button', { name: 'The team' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Start' })).toBeTruthy()
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Change the team…' }))
    expect(team.change).toHaveBeenCalledWith('h')
  })

  it('offers no Start on a plan that starts by itself once an agent is free, but Hold, and its team', async () => {
    const team = { projectId: 'p1', start: vi.fn(async () => {}), hold: vi.fn(async () => {}), change: vi.fn() }
    withServices(
      <BoardView lanes={lanesOf(board([held, queued]))} agents={agents} now={NOW} onOpen={vi.fn()} team={team} />,
      fakeClient().client,
    )
    expect(rowOf(queued.title).queryByRole('button', { name: 'Start' })).toBeNull()
    await userEvent.click(rowOf(queued.title).getByRole('button', { name: 'The team' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).queryByRole('menuitem', { name: 'Start' })).toBeNull()
    expect(within(menu).getByRole('menuitem', { name: 'Hold' })).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: 'Change the team…' })).toBeTruthy()
  })

  it('holds a task that waits for a free agent, or counts down, from its row, and a held one only starts', async () => {
    const team = { projectId: 'p1', start: vi.fn(async () => {}), hold: vi.fn(async () => {}), change: vi.fn() }
    const counting = task({
      taskId: 'c',
      threadId: 'thc',
      title: 'Counting down',
      phase: 'planned',
      plan: { ...card().plan!, id: 'plc', startsAt: '2026-10-01T10:00:20.000Z' },
    })
    withServices(
      <BoardView lanes={lanesOf(board([held, queued, counting]))} agents={agents} now={NOW} onOpen={vi.fn()} team={team} />,
      fakeClient().client,
    )
    await userEvent.click(rowOf(queued.title).getByRole('button', { name: 'Hold' }))
    expect(team.hold).toHaveBeenCalledWith('plq')
    await userEvent.click(rowOf(counting.title).getByRole('button', { name: 'Hold' }))
    expect(team.hold).toHaveBeenCalledWith('plc')
    // Held already, it only starts: from the line and from the menu.
    expect(rowOf(held.title).queryByRole('button', { name: 'Hold' })).toBeNull()
    await userEvent.click(rowOf(held.title).getByRole('button', { name: 'The team' }))
    expect(within(await screen.findByRole('menu')).queryByRole('menuitem', { name: 'Hold' })).toBeNull()
  })

  it('says which tasks can be held: on their countdown, or started and waiting for an agent or their checkout, nothing begun', () => {
    expect(canHold(task({ phase: 'planned' }))).toBe(true)
    expect(canHold(queued)).toBe(true)
    // Waiting for its Local checkout instead of a place: nothing begun either.
    expect(canHold({ ...queued, queued: null, holdable: true })).toBe(true)
    expect(canHold(held)).toBe(false)
    expect(canHold(running)).toBe(false)
    expect(canHold({ ...queued, holdable: false })).toBe(false)
    expect(canHold({ ...held, phase: 'planned', plan: null })).toBe(false)
  })

  it('leaves a row alone without the board’s team actions', () => {
    withServices(<BoardView lanes={lanesOf(board([held]))} agents={agents} now={NOW} onOpen={vi.fn()} />, fakeClient().client)
    expect(rowOf(held.title).queryByRole('button', { name: 'Start' })).toBeNull()
    expect(rowOf(held.title).queryByRole('button', { name: 'The team' })).toBeNull()
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

  it('holds a plan on its countdown as its team opens, so it doesn’t start with the team it had', async () => {
    const { client } = fakeClient()
    const counting = task({ taskId: 'c', phase: 'planned', plan: { ...card().plan!, id: 'plc' } })
    withServices(<ChangeTeam projectId="p1" task={counting} agents={agents} onClose={vi.fn()} />, client)
    await waitFor(() => expect(client.holdPlan).toHaveBeenCalledWith('plc'))
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start' })).toBeTruthy()
  })

  it('says so, rather than closing or going with what was picked, once it started meanwhile', async () => {
    const { client } = fakeClient()
    const onClose = vi.fn()
    const services = servicesFor(client, fakeHost())
    const view = withServices(<ChangeTeam projectId="p1" task={held} agents={agents} onClose={onClose} />, client)
    view.rerender(
      <ServicesProvider value={services}>
        <ChangeTeam projectId="p1" task={null} agents={agents} onClose={onClose} />
      </ServicesProvider>,
    )
    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByRole('alert').textContent).toBe('It started with the team it had.')
    expect(dialog.queryByRole('button', { name: 'Start' })).toBeNull()
    expect(dialog.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(client.changePlan).not.toHaveBeenCalled()
  })

  it('keeps what someone else changed meanwhile, sending only what the person changed', async () => {
    const { client } = fakeClient()
    const services = servicesFor(client, fakeHost())
    const view = withServices(<ChangeTeam projectId="p1" task={held} agents={agents} onClose={vi.fn()} />, client)
    const dialog = within(screen.getByRole('dialog'))
    await userEvent.click(dialog.getByRole('button', { name: /^Review:/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Remove from this step' }))
    // The coordinator gives the lead to Codex while the dialog is open.
    const moved = {
      ...held,
      plan: { ...held.plan!, steps: held.plan!.steps.map((step) => (step.key === 'implement' ? { ...step, agentId: 'codex' } : step)) },
    }
    view.rerender(
      <ServicesProvider value={services}>
        <ChangeTeam projectId="p1" task={moved} agents={agents} onClose={vi.fn()} />
      </ServicesProvider>,
    )
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(client.changePlan).toHaveBeenCalledWith(
        'plh',
        [
          { key: 'implement', agentId: 'codex', model: null, skipped: false },
          { key: 'review', agentId: 'codex', model: null, skipped: true },
        ],
        null,
      ),
    )
  })

  it('names a review’s one step Review, in its picker too', () => {
    const review = { ...held, reviewing: {} as BoardTask['reviewing'], plan: { ...held.plan!, steps: [held.plan!.steps[0]!] } }
    withServices(<ChangeTeam projectId="p1" task={review} agents={agents} onClose={vi.fn()} />, fakeClient().client)
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByRole('button', { name: /^Review:/ })).toBeTruthy()
    expect(dialog.queryByRole('button', { name: /^Implement:/ })).toBeNull()
  })

  it('starts a plan once from its row, however often Start is pressed while it starts', async () => {
    let started = () => {}
    const team = {
      projectId: 'p1',
      start: vi.fn(() => new Promise<void>((done) => (started = done))),
      hold: vi.fn(async () => {}),
      change: vi.fn(),
    }
    withServices(<BoardView lanes={lanesOf(board([held]))} agents={agents} now={NOW} onOpen={vi.fn()} team={team} />, fakeClient().client)
    await userEvent.click(rowOf(held.title).getByRole('button', { name: 'Start' }))
    expect(rowOf(held.title).queryByRole('button', { name: 'Start' })).toBeNull()
    expect(team.start).toHaveBeenCalledTimes(1)
    act(() => started())
    await waitFor(() => expect(rowOf(held.title).getByRole('button', { name: 'Start' })).toBeTruthy())
  })

  it('opens a row’s team on the project’s board, and saves it there', async () => {
    const { client } = fakeClient({ getBoard: vi.fn(async () => board([held])) })
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'The team' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Change the team…' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Team' }))
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(client.changePlan).toHaveBeenCalledWith('plh', held.plan!.steps, null))
    expect(client.startPlan).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Team' })).toBeNull())
  })
})

function Project() {
  return (
    <ProjectView
      model={useProject('p1')}
      board={useBoard('p1')}
      connections={useConnections()}
      settings={useSettingsOf('p1')}
      onTask={vi.fn()}
    />
  )
}
