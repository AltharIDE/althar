import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type BoardSnapshot, type BoardTask } from '@althar/contracts'
import { Room } from '@althar/ui'

import { BoardView } from '../src/renderer/features/board/BoardView'
import { lanesOf } from '../src/renderer/features/board/lanes'
import { canHold, ChangeTeam, TeamMenu, TeamOf, teamChangeOf, useTeamed } from '../src/renderer/features/team/Team'
import { agents, card, change, changed, coordinatorSnapshot, fakeClient, items } from './fixtures'
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

describe('the current team in its menu', () => {
  it('keeps account quota out of the team menu', async () => {
    const fake = fakeClient()
    const current = task({
      plan: { ...held.plan!, steps: [{ key: 'implement', agentId: 'codex', model: 'gpt-5.2-codex', effort: 'high', skipped: false }] },
    })
    withServices(<TeamMenu projectId="p1" task={current} onChange={vi.fn()} />, fake.client)
    await userEvent.click(screen.getByRole('button', { name: 'The team' }))
    const menu = await screen.findByRole('menu')
    expect(menu.textContent).not.toMatch(/%|left|Out|until/)
    expect(fake.client.getModelRooms).not.toHaveBeenCalled()
  })

  it.each(['none', 'skipped', 'review only'] as const)('describes a %s review without restoring an old team member', async (review) => {
    const implement = { key: 'implement', agentId: 'claude-code', model: null, skipped: false } as const
    const reviewer = { key: 'review', agentId: 'codex', model: null, skipped: review === 'skipped' } as const
    const steps = review === 'none' ? [implement] : review === 'review only' ? [reviewer] : [implement, reviewer]
    withServices(<TeamMenu projectId="p1" task={task({ plan: { ...held.plan!, steps } })} onChange={vi.fn()} />, fakeClient().client)
    await userEvent.click(screen.getByRole('button', { name: 'The team' }))
    const menu = await screen.findByRole('menu')
    if (review === 'skipped') expect(menu.textContent).toContain('no review')
    else expect(menu.textContent).not.toMatch(/no review|reviews/)
    expect(within(menu).getByRole('menuitem', { name: 'Change the team…' })).toBeTruthy()
  })
})

describe('changing the team of a task that has begun', () => {
  const atWork = (overrides: Partial<BoardTask> = {}) => ({ ...running, reviewerChange: 'now' as const, ...overrides })
  const opened = (overrides: Partial<BoardTask> = {}, client = fakeClient().client) => {
    withServices(<ChangeTeam projectId="p1" task={atWork(overrides)} agents={agents} onClose={vi.fn()} />, client)
    return within(screen.getByRole('dialog'))
  }

  it.each([null, { ...running, plan: null }])('does not open a stale form before its plan is available (%s)', (current) => {
    const { client } = fakeClient()
    withServices(<ChangeTeam projectId="p1" task={current} agents={agents} onClose={vi.fn()} />, client)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(client.changeTeam).not.toHaveBeenCalled()
  })

  it('can add a reviewer when only the current lead’s agent is available', async () => {
    const { client } = fakeClient()
    const noReview = atWork({ plan: { ...running.plan!, steps: running.plan!.steps.filter((step) => step.key === 'implement') } })
    withServices(
      <ChangeTeam projectId="p1" task={noReview} agents={agents.filter((agent) => agent.id === 'claude-code')} onClose={vi.fn()} />,
      client,
    )
    const dialog = within(screen.getByRole('dialog'))
    await userEvent.click(dialog.getByRole('button', { name: 'Add a review' }))
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(client.changeTeam).toHaveBeenCalledWith('r', [{ key: 'review', agentId: 'claude-code', model: null, skipped: false }]),
    )
  })

  it('saves only the edited step through the task, with no Start and no ending to pick, and says when the lead changes', async () => {
    const { client } = fakeClient()
    const dialog = opened({}, client)
    expect(dialog.queryByRole('button', { name: 'Start' })).toBeNull()
    expect(dialog.queryByText('When the work is done')).toBeNull()
    expect(dialog.getByText('From its next turn.')).toBeTruthy()
    await userEvent.click(dialog.getByRole('button', { name: /^Review:/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Remove from this step' }))
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(client.changeTeam).toHaveBeenCalledWith('r', [{ key: 'review', agentId: 'codex', model: null, skipped: true }]),
    )
    expect(client.changePlan).not.toHaveBeenCalled()
  })

  it('says a reviewer change in a round under way starts from the next round', () => {
    const dialog = opened({ reviewerChange: 'next_round' })
    expect(dialog.getByText('From the next round.')).toBeTruthy()
    expect(dialog.getByRole('button', { name: /^Review:/ })).toBeTruthy()
  })

  it('changes the reviewer once the review is done too, for what ships next, and says so', () => {
    const dialog = opened({ reviewerChange: 'next_ship', phase: 'ready' })
    expect(dialog.getByRole('button', { name: /^Review:/ })).toBeTruthy()
    expect(dialog.getByText('It reads what ships next.')).toBeTruthy()
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
      expect(client.changeTeam).toHaveBeenCalledWith('r', [{ key: 'review', agentId: 'codex', model: null, skipped: false }]),
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
      expect(client.changeTeam).toHaveBeenCalledWith('r', [{ key: 'review', agentId: 'codex', model: null, skipped: false }]),
    )
    cleanup()
    // A plain task has no review to add; a change whose review is done takes one for what ships next.
    const plain = opened(none('plain'))
    expect(plain.queryByRole('button', { name: 'Add a review' })).toBeNull()
    cleanup()
    const done = opened({ ...none('change'), reviewerChange: 'next_ship' })
    expect(done.getByRole('button', { name: 'Add a review' })).toBeTruthy()
  })

  it('changes a merged task’s team too, for what it ships next', () => {
    const dialog = opened({ phase: 'ready', change: change({ state: 'merged' }) })
    expect(dialog.queryByRole('alert')).toBeNull()
    expect(dialog.getByText('It reads what ships next.')).toBeTruthy()
    expect(dialog.getByRole('button', { name: 'Save' })).toBeTruthy()
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
    expect(dialog.getByRole('status').textContent).toBe('It’s settled, so its team stays.')
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

  it('follows live team updates in an open modal, keeping a dirty review and saving only that choice', async () => {
    let current = atWork({
      plan: {
        ...running.plan!,
        steps: running.plan!.steps.map((step) =>
          step.key === 'implement' ? { ...step, agentId: 'codex', model: 'gpt-5.2-codex', effort: 'extra-high' } : step,
        ),
      },
    })
    const { client, emit } = fakeClient({ getBoard: vi.fn(async () => board([current])) })
    function LiveTeam() {
      const teamed = useTeamed('p1', 'r')
      return teamed === null ? null : <ChangeTeam projectId="p1" task={teamed} agents={agents} onClose={vi.fn()} />
    }
    withServices(<LiveTeam />, client)
    const dialog = within(await screen.findByRole('dialog', { name: 'Team' }))
    expect(await dialog.findByRole('button', { name: /Implement:.*gpt-5\.2-codex.*Extra high/ })).toBeTruthy()
    await userEvent.click(dialog.getByRole('button', { name: /^Review:/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Remove from this step' }))
    current = {
      ...current,
      plan: {
        ...current.plan!,
        steps: current.plan!.steps.map((step) =>
          step.key === 'implement' ? { ...step, model: 'gpt-5.2', effort: 'low' } : { ...step, agentId: 'claude-code', model: 'opus' },
        ),
      },
    }
    act(() => emit(changed('card', 'r', 'thr')))
    expect(await dialog.findByRole('button', { name: /Implement:.*gpt-5\.2 Low/ })).toBeTruthy()
    expect(dialog.getByText('No review')).toBeTruthy()
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(client.changeTeam).toHaveBeenCalledWith('r', [{ key: 'review', agentId: 'claude-code', model: 'opus', skipped: true }]),
    )
  })

  it('keeps a deliberately changed lead when another view changes the team meanwhile', async () => {
    const { client } = fakeClient()
    const services = servicesFor(client)
    const view = withServices(<ChangeTeam projectId="p1" task={atWork()} agents={agents} onClose={vi.fn()} />, client)
    const dialog = within(screen.getByRole('dialog', { name: 'Team' }))
    await userEvent.click(dialog.getByRole('button', { name: /^Implement:/ }))
    await userEvent.click(await screen.findByRole('radio', { name: /gpt-5\.2-codex/ }))
    view.rerender(
      <ServicesProvider value={services}>
        <ChangeTeam
          projectId="p1"
          task={atWork({
            plan: {
              ...running.plan!,
              steps: running.plan!.steps.map((step) => (step.key === 'implement' ? { ...step, model: 'opus' } : step)),
            },
          })}
          agents={agents}
          onClose={vi.fn()}
        />
      </ServicesProvider>,
    )
    expect(await dialog.findByRole('button', { name: /Implement:.*gpt-5\.2-codex/ })).toBeTruthy()
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(client.changeTeam).toHaveBeenCalledWith('r', [
        { key: 'implement', agentId: 'codex', model: 'gpt-5.2-codex', effort: null, skipped: false },
      ]),
    )
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

  it('shows progress only on Start and does not report its own start as an error', async () => {
    let finishChange = () => {}
    const { client } = fakeClient({
      changePlan: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishChange = resolve
          }),
      ),
    })
    const onClose = vi.fn()
    const services = servicesFor(client, fakeHost())
    const view = withServices(<ChangeTeam projectId="p1" task={held} agents={agents} onClose={onClose} />, client)
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(screen.getByRole('button', { name: 'Start' }).getAttribute('aria-busy')).toBe('true')
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-busy')).toBeNull()
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true)
    view.rerender(
      <ServicesProvider value={services}>
        <ChangeTeam projectId="p1" task={null} agents={agents} onClose={onClose} />
      </ServicesProvider>,
    )
    expect(screen.queryByRole('alert')).toBeNull()
    act(() => finishChange())
    await waitFor(() => expect(client.startPlan).toHaveBeenCalledOnce())
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('waits for the countdown hold before saving and starting the edited team', async () => {
    let finishHold = () => {}
    const { client } = fakeClient({
      holdPlan: vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            finishHold = () => resolve(true)
          }),
      ),
    })
    withServices(<ChangeTeam projectId="p1" task={{ ...held, phase: 'planned' }} agents={agents} onClose={vi.fn()} />, client)
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(client.changePlan).not.toHaveBeenCalled()
    expect(client.startPlan).not.toHaveBeenCalled()
    act(() => finishHold())
    await waitFor(() => expect(client.startPlan).toHaveBeenCalledOnce())
    expect(client.changePlan).toHaveBeenCalledOnce()
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

  it('saves through the running task where its hold found it begun already, with no Start left', async () => {
    const { client } = fakeClient({ holdPlan: vi.fn(async () => false) })
    // The board still says planned: the small change started between its reading and the hold.
    const startedMeanwhile = task({
      taskId: 'sm',
      phase: 'planned',
      plan: { ...card().plan!, id: 'pls', startsAt: null, preset: 'Small change' },
    })
    withServices(<ChangeTeam projectId="p1" task={startedMeanwhile} agents={agents} onClose={vi.fn()} />, client)
    const dialog = within(screen.getByRole('dialog'))
    await waitFor(() => expect(dialog.queryByRole('button', { name: 'Start' })).toBeNull())
    expect(dialog.getByText('From its next turn.')).toBeTruthy()
    await userEvent.click(dialog.getByRole('button', { name: /^Review:/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Remove from this step' }))
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(client.changeTeam).toHaveBeenCalledWith('sm', [expect.objectContaining({ key: 'review', skipped: true })]))
    expect(client.changePlan).not.toHaveBeenCalled()
  })

  it('saves through the running task even if the person presses Save before the hold answers', async () => {
    let answer: (held: boolean) => void = () => {}
    const { client } = fakeClient({ holdPlan: vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve))) })
    const startedMeanwhile = task({
      taskId: 'sm',
      phase: 'planned',
      plan: { ...card().plan!, id: 'pls', startsAt: null, preset: 'Small change' },
    })
    withServices(<ChangeTeam projectId="p1" task={startedMeanwhile} agents={agents} onClose={vi.fn()} />, client)
    const dialog = within(screen.getByRole('dialog'))
    await userEvent.click(dialog.getByRole('button', { name: /^Review:/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Remove from this step' }))
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }))
    act(() => answer(false))
    await waitFor(() => expect(client.changeTeam).toHaveBeenCalled())
    expect(client.changePlan).not.toHaveBeenCalled()
  })

  it('holds a small change started with its first step waiting for a place, and offers Start, until the board reads it held', async () => {
    const { client } = fakeClient()
    const waiting = { ...queued, plan: { ...queued.plan!, preset: 'Small change' } }
    withServices(<ChangeTeam projectId="p1" task={waiting} agents={agents} onClose={vi.fn()} />, client)
    await waitFor(() => expect(client.holdPlan).toHaveBeenCalledWith('plq'))
    const dialog = within(screen.getByRole('dialog'))
    await waitFor(() => expect(dialog.getByRole('button', { name: 'Start' })).toBeTruthy())
    await userEvent.click(dialog.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(client.startPlan).toHaveBeenCalledWith('plq'))
  })

  it.each([
    ['waits for its checkout', true],
    ['waits for a free agent', false],
  ] as const)(
    'starts a held small change that %s, through its plan: a checkout wait reads as begun, with nothing queued',
    async (_, checkout) => {
      const { client } = fakeClient()
      const waiting = { ...queued, ...(checkout ? { queued: null } : {}), plan: { ...queued.plan!, preset: 'Small change' } }
      expect(teamChangeOf(waiting)).toBe(checkout ? 'begun' : 'waits')
      withServices(<ChangeTeam projectId="p1" task={waiting} agents={agents} onClose={vi.fn()} />, client)
      const dialog = within(screen.getByRole('dialog'))
      await waitFor(() => expect(client.holdPlan).toHaveBeenCalledWith('plq'))
      await userEvent.click(await dialog.findByRole('button', { name: /^Review:/ }))
      await userEvent.click(await screen.findByRole('button', { name: 'Remove from this step' }))
      await userEvent.click(dialog.getByRole('button', { name: 'Start' }))
      await waitFor(() => expect(client.startPlan).toHaveBeenCalledWith('plq'))
      expect(client.changePlan).toHaveBeenCalledWith(
        'plq',
        expect.arrayContaining([expect.objectContaining({ key: 'review', skipped: true })]),
        null,
      )
      expect(client.changeTeam).not.toHaveBeenCalled()
    },
  )

  it('saves a held checkout wait as a plan too, and offers Start before the hold has answered', async () => {
    let answer: (held: boolean) => void = () => {}
    const { client } = fakeClient({ holdPlan: vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve))) })
    const waiting = { ...queued, queued: null, plan: { ...queued.plan!, preset: 'Small change' } }
    withServices(<ChangeTeam projectId="p1" task={waiting} agents={agents} onClose={vi.fn()} />, client)
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByRole('button', { name: 'Start' })).toBeTruthy()
    await userEvent.click(dialog.getByRole('button', { name: /^Review:/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Remove from this step' }))
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }))
    act(() => answer(true))
    await waitFor(() => expect(client.changePlan).toHaveBeenCalled())
    expect(client.changeTeam).not.toHaveBeenCalled()
    expect(client.startPlan).not.toHaveBeenCalled()
  })

  it('leaves another task waiting for a place as it was: changed, not held', async () => {
    const { client } = fakeClient()
    withServices(<ChangeTeam projectId="p1" task={queued} agents={agents} onClose={vi.fn()} />, client)
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Start' })).toBeNull()
    expect(client.holdPlan).not.toHaveBeenCalled()
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
    expect(dialog.getByRole('status').textContent).toBe('This task is no longer available to change.')
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

function Project({ room }: { room?: Room }) {
  return (
    <ProjectView
      model={useProject('p1')}
      board={useBoard('p1')}
      connections={useConnections()}
      settings={useSettingsOf('p1')}
      onTask={vi.fn()}
      {...(room === undefined ? {} : { room })}
    />
  )
}

describe("a small change's card in the coordinator's thread", () => {
  const small = (over: Partial<NonNullable<BoardTask['plan']>> = {}) =>
    task({
      phase: 'running',
      plan: { ...card().plan!, startsAt: null, preset: 'Small change', ...over },
    })
  const talking = (current: BoardTask, getBoard = vi.fn(async () => board([current]))) => {
    const fake = fakeClient({
      getBoard,
      getCoordinator: vi.fn(async () =>
        coordinatorSnapshot({ items: [items.card(card({ phase: 'running', plan: current.plan, step: 'implement' }), 'c0')] }),
      ),
    })
    withServices(<Project room={Room.Talk} />, fake.client)
    return fake
  }

  it('opens its team with only the conversation on show, with no board beside it', async () => {
    talking(small())
    await userEvent.click(await screen.findByRole('button', { name: 'Change the team…' }))
    expect(await screen.findByRole('dialog', { name: 'Team' })).toBeTruthy()
  })

  it('opens its team once the board has read, if it was pressed before', async () => {
    let read: (snapshot: BoardSnapshot) => void = () => {}
    const current = small()
    const pending = new Promise<BoardSnapshot>((resolve) => {
      read = resolve
    })
    talking(
      current,
      vi.fn(() => pending),
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Change the team…' }))
    // At once, it says it reads; the team is there once the board has.
    expect(within(screen.getByRole('dialog', { name: 'Team' })).getByText('Reading its team…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Implement:/ })).toBeNull()
    act(() => read(board([current])))
    expect(await screen.findByRole('dialog', { name: 'Team' })).toBeTruthy()
  })

  it('changes only the lead of one whose review reads after its merge, with no review to add', async () => {
    talking(
      small({
        reviewAfterMerge: true,
        steps: [
          { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
          { key: 'review', agentId: 'codex', model: null, skipped: true },
        ],
      }),
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Change the team…' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Team' }))
    expect(dialog.getByRole('button', { name: /^Implement:/ })).toBeTruthy()
    expect(dialog.queryByRole('button', { name: /^Review:/ })).toBeNull()
    expect(dialog.queryByRole('button', { name: 'Add a review' })).toBeNull()
  })
})

describe('a team opened before the board has read', () => {
  const open = (client: ReturnType<typeof fakeClient>['client'], onClose = vi.fn()) =>
    withServices(<TeamOf projectId="p1" taskId={held.taskId} agents={agents} onClose={onClose} />, client)

  it('shows at once that it reads, and becomes the team once the task is read', async () => {
    let read: (snapshot: BoardSnapshot) => void = () => {}
    const pending = new Promise<BoardSnapshot>((resolve) => (read = resolve))
    const { client } = fakeClient({ getBoard: vi.fn(() => pending) })
    open(client)
    const dialog = within(screen.getByRole('dialog', { name: 'Team' }))
    expect(dialog.getByText('Reading its team…')).toBeTruthy()
    expect(dialog.getByRole('button', { name: 'Close' })).toBeTruthy()
    act(() => read(board([held])))
    expect(await screen.findByRole('button', { name: /^Implement:/ })).toBeTruthy()
  })

  it('says why where the board can’t be read, and reads it again on Try again', async () => {
    let attempts = 0
    const { client } = fakeClient({
      getBoard: vi.fn(async () => {
        attempts += 1
        if (attempts === 1) throw new ApiError({ reason: 'Busy', message: 'The board is out of reach.' })
        return board([held])
      }),
    })
    open(client)
    const dialog = within(await screen.findByRole('dialog', { name: 'Team' }))
    expect((await dialog.findByRole('alert')).textContent).toContain('The board is out of reach.')
    await userEvent.click(dialog.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: /^Implement:/ })).toBeTruthy()
  })

  it('says the task is no longer there, with a way out, where it is gone before the first read', async () => {
    const onClose = vi.fn()
    const { client } = fakeClient({ getBoard: vi.fn(async () => board([running])) })
    open(client, onClose)
    const dialog = within(await screen.findByRole('dialog', { name: 'Team' }))
    expect((await dialog.findByRole('status')).textContent).toBe('This task is no longer available to change.')
    await userEvent.click(dialog.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
