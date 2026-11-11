import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { BoardCall, BoardSnapshot, BoardTask } from '@althar/contracts'
import { TaskStatus } from '@althar/ui'

import { servicesFor, withServices } from './render'
import { ServicesProvider } from '../src/renderer/data/services'
import { BoardView } from '../src/renderer/features/board/BoardView'
import { lanesOf } from '../src/renderer/features/board/lanes'
import { standsOf } from '../src/renderer/features/board/started'
import { partsOf, type PartsActions } from '../src/renderer/features/task/parts'
import { StartedOf, type StartedReading, startedBy, startedIn } from '../src/renderer/features/task/Started'
import { TaskThread } from '../src/renderer/features/task/TaskThread'
import { PartsDrill } from '@althar/ui'
import { TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { agents, card, change, fakeClient, items, snapshot } from './fixtures'

/*
 * A task a lead started shows live in its parent's thread (ADR-097): one chip
 * where it was started, which follows the board; the same in the parent's
 * parts; and on the board, its card names the parent and opens it.
 */

const NOW = '2026-10-01T10:00:00.000Z'
const name = (id: string | null) => id ?? ''

const child = (overrides: Partial<BoardTask> = {}): BoardTask => ({
  ...card(),
  taskId: 'c1',
  threadId: 'thc1',
  title: 'Review after merge: major only, or skipped, as a setting',
  slug: 'review-after-merge',
  state: 'open',
  createdAt: '2026-10-01T09:00:00.000Z',
  settledAt: null,
  changed: null,
  here: [],
  lead: 'claude-code',
  leadModel: 'claude-opus-5-5',
  startedBy: { taskId: 'p1', slug: 'prototype', title: 'Prototype: the small change card', threadId: 'thp1' },
  ...overrides,
})

const passing = change({
  draft: false,
  checks: { outcome: 'passed', passed: 2, failed: 0, running: 0, total: 2, failing: [], list: [] },
})
const permission: BoardCall = {
  id: 'a1',
  kind: 'permission',
  title: 'Run make deploy',
  reason: '',
  command: 'make deploy',
  stuck: null,
  createdAt: '2026-10-01T09:10:00.000Z',
  taskId: 'c1',
  threadId: 'thc1',
  taskTitle: 'x',
  taskSlug: 'x',
}

describe('where a started task stands, in the board’s words', () => {
  it('counts down while its plan waits to start, and says it is held when it does not', () => {
    const startsAt = new Date(Date.parse(NOW) + 18_000).toISOString()
    const planned = child({ phase: 'planned', plan: { ...card().plan!, startsAt } })
    expect(standsOf(planned, undefined, NOW, name)).toEqual({ tone: TaskStatus.Queued, word: 'Planned', detail: 'Starts in 18s' })
    expect(standsOf(child({ phase: 'held', plan: { ...card().plan!, startsAt: null } }), undefined, NOW, name)).toMatchObject({
      word: 'Held',
    })
  })

  it('says working while it runs, and its pull request with its checks once it has one', () => {
    expect(standsOf(child({ phase: 'running', kind: 'plain' }), undefined, NOW, name)).toEqual({
      tone: TaskStatus.Running,
      word: 'Working',
    })
    const open = standsOf(child({ phase: 'running', change: passing }), undefined, NOW, name)
    expect(open.tone).toBe(TaskStatus.Running)
    expect(open.detail).toMatch(/^#12 · /)
  })

  it('says it needs you, and why', () => {
    expect(standsOf(child({ phase: 'waiting' }), permission, NOW, name)).toEqual({
      tone: TaskStatus.Yours,
      word: 'Needs you',
      detail: 'Permission',
    })
  })

  it('says it is ready to accept with its pull request open and its checks', () => {
    const ready = standsOf(child({ phase: 'ready', change: passing }), undefined, NOW, name)
    expect(ready).toMatchObject({ tone: TaskStatus.Yours, word: 'Ready to accept' })
    expect(ready.detail).toMatch(/^#12 · /)
  })

  it('says it merged, was done, or was abandoned', () => {
    const merged = child({ phase: 'settled', state: 'done', change: { ...passing, state: 'merged' } })
    expect(standsOf(merged, undefined, NOW, name)).toEqual({ tone: 'merged', word: 'Merged', detail: '#12' })
    expect(standsOf(child({ phase: 'settled', state: 'done', kind: 'plain' }), undefined, NOW, name)).toEqual({
      tone: TaskStatus.Done,
      word: 'Done',
    })
    expect(standsOf(child({ phase: 'settled', state: 'abandoned' }), undefined, NOW, name)).toEqual({
      tone: 'abandoned',
      word: 'Abandoned',
    })
  })
})

const reading = (tasks: ReadonlyArray<BoardTask>, calls: ReadonlyArray<BoardCall> = [], onOpen = vi.fn()): StartedReading => ({
  board: { cursor: 1, tasks, calls, settledTotal: 0 } satisfies BoardSnapshot,
  now: NOW,
  agents,
  onOpen,
})

const inServices = (node: React.ReactNode) => <ServicesProvider value={servicesFor(fakeClient().client)}>{node}</ServicesProvider>

describe('the chip in the parent’s thread', () => {
  const started = { kind: 'althar', id: 'n1', text: 'Started', tone: 'info', task: { threadId: 'thc1', title: child().title } } as const

  it('replaces the line with one chip that opens the task, and names its lead’s model', async () => {
    const open = vi.fn()
    const read = reading([child({ phase: 'running', kind: 'plain' })], [], open)
    render(
      inServices(
        <TaskThread
          threadId="thp1"
          versionOf={() => ''}
          rounds={[started]}
          started={(task) => <StartedOf threadId={task.threadId} title={task.title} reading={read} />}
        />,
      ),
    )
    expect(screen.queryByText(/^Started/)).toBeNull()
    const chip = screen.getByRole('button', { name: /Review after merge/ })
    expect(within(chip).getByText('Working')).toBeTruthy()
    expect(within(chip).getByText(/Opus/)).toBeTruthy()
    await userEvent.click(chip)
    expect(open).toHaveBeenCalledWith('thc1')
  })

  it('stays one chip as the task moves: the end shows on it, with no new line', () => {
    const run = (tasks: ReadonlyArray<BoardTask>) => {
      const read = reading(tasks)
      return inServices(
        <TaskThread
          threadId="thp1"
          versionOf={() => ''}
          rounds={[started]}
          started={(task) => <StartedOf threadId={task.threadId} title={task.title} reading={read} />}
        />,
      )
    }
    const { rerender } = render(run([child({ phase: 'running', kind: 'plain' })]))
    const chip = screen.getByRole('button', { name: /Review after merge/ })
    expect(within(chip).getByText('Working')).toBeTruthy()
    rerender(run([child({ phase: 'settled', state: 'done', change: { ...passing, state: 'merged' } })]))
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Review after merge/ })).toBe(chip)
    expect(within(chip).getByText('Merged')).toBeTruthy()
    expect(within(chip).queryByText('Working')).toBeNull()
  })

  it('says only that it settled where the board no longer holds the task', () => {
    render(inServices(<StartedOf threadId="thc9" title="An old one" reading={reading([])} />))
    expect(within(screen.getByRole('button', { name: /An old one/ })).getByText('Settled')).toBeTruthy()
  })

  it('keeps its line where nothing can read the board', () => {
    render(inServices(<TaskThread threadId="thp1" versionOf={() => ''} onOpenTask={vi.fn()} rounds={[started]} />))
    expect(screen.getByText(/^Started/)).toBeTruthy()
  })
})

describe('the parent’s parts list the tasks it started', () => {
  const act = (read: StartedReading, tasks: ReadonlyArray<BoardTask>): PartsActions =>
    ({
      started: { tasks: tasks.map((work) => ({ threadId: work.threadId, title: work.title, work })), reading: read },
    }) as unknown as PartsActions

  it('lists each with the same status, and is violet while one needs the person', async () => {
    const open = vi.fn()
    const tasks = [
      child({ phase: 'waiting' }),
      child({ taskId: 'c2', threadId: 'thc2', title: 'Settings for it', phase: 'settled', state: 'done', kind: 'plain' }),
    ]
    const read = reading(tasks, [permission], open)
    const parts = partsOf(snapshot(), act(read, tasks))
    const part = parts.find((one) => one.id === 'started')
    expect(part).toMatchObject({ name: 'Tasks it started', detail: 'Needs you, Done', tone: 'you' })
    render(inServices(<PartsDrill parts={parts} kinds={[]} />))
    await userEvent.click(screen.getByRole('button', { name: /Tasks it started/ }))
    await userEvent.click(await screen.findByRole('button', { name: /Settings for it/ }))
    expect(open).toHaveBeenCalledWith('thc2')
  })

  it('lists none where the task started none', () => {
    expect(partsOf(snapshot(), {} as unknown as PartsActions).some((one) => one.id === 'started')).toBe(false)
  })

  it('finds the tasks a lead started on the board, oldest first, and no others', () => {
    const board: BoardSnapshot = {
      cursor: 1,
      calls: [],
      settledTotal: 0,
      tasks: [
        child({ taskId: 'b', createdAt: '2026-10-01T09:30:00.000Z' }),
        child({ taskId: 'a', createdAt: '2026-10-01T09:10:00.000Z' }),
        child({ taskId: 'x', startedBy: undefined }),
        child({ taskId: 'y', startedBy: { taskId: 'other', slug: 'o', title: 'Other', threadId: 'tho' } }),
      ],
    }
    expect(startedBy(board, 'p1').map((one) => one.taskId)).toEqual(['a', 'b'])
    expect(startedBy(null, 'p1')).toEqual([])
  })
})

describe('the tasks a task started that the board no longer holds', () => {
  const told = (threadId: string, title: string) =>
    items.notice({ title: `Started “${title}”`, source: 'runtime', task: { taskId: threadId, slug: threadId, title, threadId } }, null)

  it('still lists them from the thread, after those the board holds, once the board only keeps the latest settled', () => {
    const board: BoardSnapshot = {
      cursor: 1,
      calls: [],
      settledTotal: 90,
      tasks: [child({ taskId: 'b', threadId: 'thb', startedBy: { taskId: 'p1', slug: 'p', title: 'P', threadId: 'thp1' } })],
    }
    const list = startedIn(board, 'p1', [told('tho', 'Settled long ago'), told('thb', 'Held by the board')])
    expect(list.map((one) => [one.threadId, one.work === undefined])).toEqual([
      ['tho', true],
      ['thb', false],
    ])
  })

  it('keeps the part, and the way into the task, when it is the only one and the board has dropped it', async () => {
    const open = vi.fn()
    const read = reading([])
    const board = read.board
    const entries = startedIn(board, 'p1', [told('tho', 'Settled long ago')])
    const parts = partsOf(snapshot(), { started: { tasks: entries, reading: { ...read, onOpen: open } } } as unknown as PartsActions)
    expect(parts.find((one) => one.id === 'started')).toMatchObject({ name: 'Tasks it started', detail: 'Settled' })
    render(inServices(<PartsDrill parts={parts} kinds={[]} />))
    await userEvent.click(screen.getByRole('button', { name: /Tasks it started/ }))
    await userEvent.click(await screen.findByRole('button', { name: /Settled long ago/ }))
    expect(open).toHaveBeenCalledWith('tho')
  })
})

describe('the child’s card on the board', () => {
  it('names the task that started it, and opens that task from its title, not the card’s own', async () => {
    const open = vi.fn()
    const lanes = lanesOf({ cursor: 1, calls: [], settledTotal: 0, tasks: [child({ phase: 'running', kind: 'plain' })] })
    render(inServices(<BoardView lanes={lanes} agents={agents} now={NOW} onOpen={open} />))
    const running = within(screen.getByRole('region', { name: 'Running' }))
    await userEvent.click(running.getByRole('button', { name: 'Prototype: the small change card' }))
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('thp1')
  })

  it('names it on the plan up next too, before it has a card', async () => {
    const open = vi.fn()
    const lanes = lanesOf({ cursor: 1, calls: [], settledTotal: 0, tasks: [child({ phase: 'planned' })] })
    render(inServices(<BoardView lanes={lanes} agents={agents} now={NOW} onOpen={open} />))
    const next = within(screen.getByRole('region', { name: 'Up next' }))
    await userEvent.click(next.getByRole('button', { name: 'Prototype: the small change card' }))
    expect(open).toHaveBeenCalledWith('thp1')
  })
})

describe('in the parent’s own window', () => {
  const started = items.notice(
    {
      title: 'Started “Review after merge: major only, or skipped, as a setting”',
      source: 'runtime',
      task: { taskId: 'c1', slug: 'review-after-merge', title: child().title, threadId: 'thc1' },
    },
    null,
  )
  const parent = snapshot({ items: [started] })
  const parentId = parent.task.id
  const own = { startedBy: { taskId: parentId, slug: 'prototype', title: 'Prototype', threadId: parent.threadId } }

  function Task({ onOpenTask }: { onOpenTask: (threadId: string) => void }) {
    return <TaskView model={useTask(parent.threadId)} onBack={vi.fn()} onOpenTask={onOpenTask} />
  }

  it('draws the chip where its lead started the task, in the board’s words, and opens it', async () => {
    const open = vi.fn()
    const { client } = fakeClient({
      getThread: vi.fn(async () => parent),
      getBoard: vi.fn(async () => ({
        cursor: 1,
        calls: [],
        settledTotal: 0,
        tasks: [child({ ...own, phase: 'running', kind: 'plain' })],
      })),
    })
    withServices(<Task onOpenTask={open} />, client)
    // Where the board has been read, the line is a chip.
    const chip = await screen.findByRole('button', { name: /Working.*Review after merge/ })
    // One chip, and no line of its own about the task beside it.
    expect(screen.queryByText(/^Started “/)).toBeNull()
    await userEvent.click(chip)
    expect(open).toHaveBeenCalledWith('thc1')
  })

  it('lists it among the parent’s parts with the same status', async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async () => parent),
      getBoard: vi.fn(async () => ({
        cursor: 1,
        calls: [],
        settledTotal: 0,
        tasks: [child({ ...own, phase: 'settled', state: 'done', change: { ...passing, state: 'merged' } })],
      })),
    })
    withServices(<Task onOpenTask={vi.fn()} />, client)
    await userEvent.click(await screen.findByRole('button', { name: /^Parts, / }))
    const popover = within(await screen.findByRole('dialog', { name: 'This task’s parts' }))
    await userEvent.click(popover.getByRole('button', { name: /^Tasks it started/ }))
    expect(await popover.findByRole('button', { name: /Merged.*Review after merge/ })).toBeTruthy()
  })

  it('keeps one chip as the board moves, from working to merged, where the window reads it again', async () => {
    let tasks = [child({ ...own, phase: 'running', kind: 'plain' })]
    const { client } = fakeClient({
      getThread: vi.fn(async () => parent),
      getBoard: vi.fn(async () => ({ cursor: 1, calls: [], settledTotal: 0, tasks })),
    })
    const services = servicesFor(client)
    render(
      <ServicesProvider value={services}>
        <Task onOpenTask={vi.fn()} />
      </ServicesProvider>,
    )
    const chip = await screen.findByRole('button', { name: /Working.*Review after merge/ })
    tasks = [child({ ...own, phase: 'settled', state: 'done', change: { ...passing, state: 'merged' } })]
    await services.cache.invalidateQueries()
    await waitFor(() => expect(within(chip).getByText('Merged')).toBeTruthy())
    expect(screen.getByRole('button', { name: /Merged.*Review after merge/ })).toBe(chip)
    expect(screen.getAllByRole('button', { name: /Review after merge/ })).toHaveLength(1)
  })

  it('lists the task from the thread in its parts when the board no longer holds it', async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async () => parent),
      getBoard: vi.fn(async () => ({ cursor: 1, calls: [], settledTotal: 90, tasks: [] })),
    })
    withServices(<Task onOpenTask={vi.fn()} />, client)
    await userEvent.click(await screen.findByRole('button', { name: /^Parts, / }))
    const popover = within(await screen.findByRole('dialog', { name: 'This task’s parts' }))
    await userEvent.click(popover.getByRole('button', { name: /^Tasks it started/ }))
    expect(await popover.findByRole('button', { name: /Settled.*Review after merge/ })).toBeTruthy()
  })
})
