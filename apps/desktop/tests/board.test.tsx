import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Activity, useState } from 'react'

import { ApiError, type BoardCall, type BoardSnapshot, type BoardTask } from '@althar/contracts'

import { BoardView, trackOf } from '../src/renderer/features/board/BoardView'
import { DockView } from '../src/renderer/features/board/DockView'
import { pictureUrl } from '../src/main/pictureAddress'
import { clock, running } from '../src/renderer/shared/time'
import { lanesOf, yoursOf } from '../src/renderer/features/board/lanes'
import { firstNeedOf, needsOf } from '../src/renderer/features/board/needs'
import { readHeadsAhead, useBoard } from '../src/renderer/features/board/useBoard'
import { useClosePullRequests } from '../src/renderer/features/board/useClosePullRequests'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { makeQueryClient } from '../src/renderer/data/reads'
import { useMerge } from '../src/renderer/data/merges'
import { useProject } from '../src/renderer/features/project/useProject'
import { agents, card, change, changed, fakeClient, snapshot } from './fixtures'
import { useSettingsOf, withServices } from './render'

function Project({ onTask = vi.fn() }: { onTask?: (threadId: string) => void }) {
  return (
    <ProjectView
      model={useProject('p1')}
      board={useBoard('p1')}
      connections={useConnections()}
      settings={useSettingsOf('p1')}
      onTask={onTask}
    />
  )
}

/** The dock on its own, as the home opens it: the board's tasks and calls, answered or accepted there. */
function Docked({
  target,
  onTask = vi.fn(),
  onChanges = vi.fn(),
}: {
  target: Parameters<typeof DockView>[0]['target']
  onTask?: (threadId: string) => void
  onChanges?: (task: BoardTask, path?: string) => void
}) {
  return (
    <DockView
      target={target}
      model={useBoard('p1')}
      agents={agents}
      project="meridian"
      now="2026-10-01T10:00:00.000Z"
      onClose={vi.fn()}
      onTask={onTask}
      onChanges={onChanges}
    />
  )
}

const task = (overrides: Partial<BoardTask> = {}): BoardTask => ({
  ...card(),
  state: 'open',
  createdAt: '2026-10-01T09:00:00.000Z',
  settledAt: null,
  changed: null,
  here: [],
  ...overrides,
})

const permission: BoardCall = {
  id: 'a1',
  kind: 'permission',
  title: 'Run make deploy',
  reason: 'Deploying or publishing always asks.',
  command: 'make deploy',
  stuck: null,
  createdAt: '2026-10-01T09:10:00.000Z',
  taskId: 't3',
  threadId: 'th3',
  taskTitle: 'Ship it',
  taskSlug: 'ship-it',
}

/** A board with one of everything: a plan up next, work running, a call, work ready with and without a pull request, and work settled. */
const board = (overrides: Partial<BoardSnapshot> = {}): BoardSnapshot => ({
  cursor: 3,
  tasks: [
    task({ taskId: 't1', threadId: 'th1', title: 'Add a retry', slug: 'add-a-retry', phase: 'planned' }),
    task({
      taskId: 't2',
      threadId: 'th2',
      title: 'Fix the limit',
      slug: 'fix-the-limit',
      phase: 'running',
      step: 'review',
      startedAt: '2026-10-01T09:00:00.000Z',
    }),
    task({ taskId: 't3', threadId: 'th3', title: 'Ship it', slug: 'ship-it', phase: 'waiting' }),
    task({
      taskId: 't4',
      threadId: 'th4',
      title: 'Rate-limit refunds',
      slug: 'rate-limit-refunds',
      phase: 'ready',
      change: change({
        draft: false,
        checks: {
          outcome: 'passed',
          passed: 2,
          failed: 0,
          running: 0,
          total: 2,
          failing: [],
          list: [
            { name: 'test', state: 'passed', summary: null },
            { name: 'lint', state: 'passed', summary: null },
          ],
        },
      }),
      summary: 'Retried the call.\nAnd more.',
    }),
    task({
      taskId: 't5',
      threadId: 'th5',
      title: 'Tidy the docs',
      slug: 'tidy-the-docs',
      branch: 'althar/tidy-the-docs',
      phase: 'ready',
      changed: { files: 2, add: 9, del: 4 },
    }),
    task({
      taskId: 't6',
      threadId: 'th6',
      title: 'Old work',
      slug: 'old-work',
      phase: 'settled',
      state: 'done',
      settledAt: '2026-10-01T08:00:00.000Z',
      change: change({ state: 'merged', number: 7 }),
    }),
    task({
      taskId: 't7',
      threadId: 'th7',
      title: 'Given up',
      slug: 'given-up',
      phase: 'settled',
      state: 'abandoned',
      settledAt: '2026-10-01T07:00:00.000Z',
    }),
  ],
  calls: [permission],
  settledTotal: 2,
  ...overrides,
})

describe('the board’s lanes', () => {
  it('puts each task and call where it belongs', () => {
    const lanes = lanesOf(board())
    expect(lanes.next.map((work) => work.taskId)).toEqual(['t1'])
    expect(lanes.running.map((work) => work.taskId)).toEqual(['t2'])
    // A task waiting on a call is in Needs you, once, with its call: the call isn't a card of its own.
    expect(lanes.waiting.map(({ task: work, call }) => [work.taskId, call?.id])).toEqual([['t3', 'a1']])
    expect(lanes.calls).toEqual([])
    expect(lanes.ready.map((work) => work.taskId)).toEqual(['t4', 't5'])
    expect(lanes.settled.map((work) => work.taskId)).toEqual(['t6', 't7'])
    expect(yoursOf(lanes)).toBe(3)
  })

  describe('a task whose lead stopped, with no agent on it', () => {
    const NOW = '2026-10-01T10:00:00.000Z'
    const at = '2026-09-30T14:00:00.000Z'
    const stopped = (taskId: string, by: 'declined' | 'interrupted' | 'althar' | null, overrides: Partial<BoardTask> = {}) =>
      task({
        taskId,
        threadId: `th-${taskId}`,
        title: `Stopped ${taskId}`,
        phase: 'stopped',
        startedAt: '2026-09-30T13:00:00.000Z',
        stopped: { by, at },
        ...overrides,
      })
    const working = task({ taskId: 'w', title: 'At work', phase: 'running', step: 'implement', startedAt: '2026-10-01T09:00:00.000Z' })
    const tasks = [working, stopped('d', 'declined'), stopped('i', 'interrupted'), stopped('n', null)]

    it('is in Needs you, not Running, and Running counts only the work an agent is on', () => {
      const lanes = lanesOf(board({ tasks, calls: [] }))
      expect(lanes.running.map((work) => work.taskId)).toEqual(['w'])
      expect(lanes.atWork).toBe(1)
      expect(lanes.stopped.map((work) => work.taskId).toSorted()).toEqual(['d', 'i', 'n'])
      expect(yoursOf(lanes)).toBe(3)
    })

    it('says what stopped it and when, not a running time, and an automation run still says where it is from', () => {
      const from = { id: 'a1', name: 'Nightly dependency check' } as unknown as NonNullable<BoardTask['automation']>
      const lanes = lanesOf(board({ tasks: [...tasks, stopped('r', 'declined', { automation: from })], calls: [] }))
      withServices(<BoardView lanes={lanes} agents={agents} now={NOW} onOpen={vi.fn()} />, fakeClient().client)
      const yours = within(screen.getByRole('region', { name: 'Needs you' }))
      const card = (title: string) => within(yours.getByRole('button', { name: title }).closest('article') as HTMLElement)
      expect(card('Stopped d').getByText('Stopped when you declined a command')).toBeTruthy()
      expect(card('Stopped i').getByText('Stopped when you interrupted it')).toBeTruthy()
      // Where nothing says what stopped it, the word Stopped says it all.
      expect(card('Stopped n').queryByText('No agent is working on it')).toBeNull()
      expect(card('Stopped n').queryByText(/^Stopped (when|by)/)).toBeNull()
      expect(card('Stopped d').getByText('20h ago')).toBeTruthy()
      expect(card('Stopped d').queryByText('21h')).toBeNull()
      expect(card('Stopped r').getByText('From Nightly dependency check')).toBeTruthy()
      expect(within(screen.getByRole('region', { name: 'Running' })).queryByText(/^Stopped /)).toBeNull()
    })

    it('shows no time where nothing says when it stopped', () => {
      const unknown = stopped('u', null, { stopped: { by: null, at: null } })
      const lanes = lanesOf(board({ tasks: [unknown], calls: [] }))
      withServices(<BoardView lanes={lanes} agents={agents} now={NOW} onOpen={vi.fn()} />, fakeClient().client)
      const article = screen.getByRole('button', { name: 'Stopped u' }).closest('article') as HTMLElement
      expect(within(article).getByText('Stopped')).toBeTruthy()
      expect(article.textContent).not.toMatch(/Invalid Date|NaN|ago/)
    })
  })

  describe('a task started that waits for a free agent, by lane', () => {
    const NOW = '2026-10-01T10:00:00.000Z'
    const queued = { busy: 4, atOnce: 4 }
    const waiting = (taskId: string, place: number, overrides: Partial<BoardTask> = {}) =>
      task({ taskId, threadId: `th-${taskId}`, title: `Waiting ${taskId}`, phase: 'running', queued, inLine: true, place, ...overrides })
    const planned = task({
      taskId: 'p',
      title: 'Add a retry',
      phase: 'planned',
      plan: { ...card().plan!, startsAt: '2026-10-01T10:00:20.000Z' },
    })
    const held = task({ taskId: 'h', title: 'Hold off', phase: 'held', plan: { ...card().plan!, startsAt: null } })

    it('goes up next when no agent has worked on it, in the order its line starts, above planned and held plans', () => {
      const lanes = lanesOf(board({ tasks: [held, planned, waiting('b', 2), waiting('a', 1), waiting('c', 3)], calls: [] }))
      expect(lanes.next.map((work) => work.taskId)).toEqual(['a', 'b', 'c', 'p', 'h'])
      expect(lanes.free).toBe(3)
      expect(lanes.running).toEqual([])
    })

    // Whatever its kind: a change with a plan, a quick task, a review of someone else's pull request, a prototype.
    it.each([
      ['a change with a plan', { kind: 'change', planWaits: true }],
      ['a quick task', { kind: 'plain', planWaits: true }],
      ['a review of a pull request', { kind: 'review', plan: null, step: null }],
      ['a prototype', { kind: 'plain', title: 'Prototype the board', planWaits: true }],
    ] as const)('goes up next when it is %s that no agent has worked on yet', (_, kind) => {
      const lanes = lanesOf(board({ tasks: [waiting('a', 1, kind)], calls: [] }))
      expect(lanes.next.map((work) => work.taskId)).toEqual(['a'])
      expect(lanes.free).toBe(1)
      expect(lanes.running).toEqual([])
    })

    it('stays running when an agent of it is at work and another turn of it waits for a place', () => {
      const midWork = task({ taskId: 'm', phase: 'running', step: 'implement', queued })
      const lanes = lanesOf(board({ tasks: [midWork, waiting('a', 1)], calls: [] }))
      expect(lanes.next.map((work) => work.taskId)).toEqual(['a'])
      expect(lanes.running.map((work) => work.taskId)).toEqual(['m'])
      expect(lanes.atWork).toBe(1)
    })

    describe('under way, none of its agents at work (ADR-065)', () => {
      const continuing = (taskId: string, place: number, overrides: Partial<BoardTask> = {}) =>
        task({
          taskId,
          threadId: `th-${taskId}`,
          title: `Going on ${taskId}`,
          phase: 'running',
          step: 'implement',
          queued,
          continues: true,
          place,
          ...overrides,
        })
      const paused = task({
        taskId: 'z',
        threadId: 'th-z',
        title: 'Offline z',
        phase: 'running',
        step: 'review',
        queued: null,
        continues: true,
        reconnects: { agentId: 'claude-code', service: 'Claude', offline: true, next: null, failure: null },
      })
      const working = task({ taskId: 'w', phase: 'running', step: 'implement', startedAt: '2026-10-01T09:00:00.000Z' })
      const busy = [working, waiting('b', 4), paused, continuing('y', 2), waiting('a', 3), continuing('x', 1), planned]

      it('continues up next ahead of the line, then what is paused, then plans; Running counts only work at it', () => {
        const lanes = lanesOf(board({ tasks: busy, calls: [] }))
        expect(lanes.next.map((work) => work.taskId)).toEqual(['x', 'y', 'a', 'b', 'z', 'p'])
        expect([lanes.continuing, lanes.free, lanes.paused, lanes.upNext]).toEqual([2, 2, 1, 6])
        expect(lanes.running.map((work) => work.taskId)).toEqual(['w'])
        expect(lanes.atWork).toBe(1)
      })

      it('says what continues and why it waits, with no grip, and counts it ahead of the line’s places', () => {
        const line = { move: vi.fn(async () => {}), oldestFirst: vi.fn(), failed: null }
        withServices(
          <BoardView lanes={lanesOf(board({ tasks: busy, calls: [] }))} agents={agents} now={NOW} onOpen={vi.fn()} line={line} />,
          fakeClient().client,
        )
        const next = within(screen.getByRole('region', { name: 'Up next' }))
        expect(next.getAllByText('Continues · Implement')).toHaveLength(2)
        expect(next.getByText('Continues · Review')).toBeTruthy()
        expect(next.getAllByText(/^4 of 4 agents busy on /)).toHaveLength(2)
        expect(next.getByText('Waiting for the connection')).toBeTruthy()
        expect(next.getByText('Paused')).toBeTruthy()
        // The line's places come after what continues; only its rows have grips.
        expect(next.getByText('3rd in line')).toBeTruthy()
        expect(next.getByText('4th in line')).toBeTruthy()
        expect(next.getAllByRole('button', { name: /in the line$/ }).map((grip) => grip.getAttribute('aria-label'))).toEqual([
          'Move Waiting a in the line',
          'Move Waiting b in the line',
        ])
        const running = within(screen.getByRole('region', { name: 'Running' }))
        expect(running.queryByText(/^Going on|^Offline/)).toBeNull()
      })

      it('stays in the lane it was in while the person points at the board, and moves once they look away', async () => {
        const before = lanesOf(board({ tasks: [working, continuing('x', 1)], calls: [] }))
        // Its turn has its place: it is at work.
        const after = lanesOf(
          board({ tasks: [working, continuing('x', 1, { queued: null, continues: undefined, place: undefined })], calls: [] }),
        )
        let change: (lanes: typeof before) => void = () => undefined
        function Changing() {
          const [lanes, setLanes] = useState(before)
          change = setLanes
          return <BoardView lanes={lanes} agents={agents} now={NOW} onOpen={vi.fn()} />
        }
        withServices(<Changing />, fakeClient().client)
        const region = (name: string) => within(screen.getByRole('region', { name }))
        await userEvent.hover(region('Up next').getByText('Going on x'))
        act(() => change(after))
        expect(region('Up next').getByText('Going on x')).toBeTruthy()
        expect(region('Running').queryByText('Going on x')).toBeNull()
        await userEvent.unhover(screen.getByRole('region', { name: 'Up next' }))
        await userEvent.hover(document.body)
        await waitFor(() => expect(region('Running').getByText('Going on x')).toBeTruthy())
        expect(region('Up next').queryByText('Going on x')).toBeNull()
      })
      it('lets go once its screen hides with the pointer on it, as kept (`KeptScreens`), and moves as it shows again', async () => {
        const before = lanesOf(board({ tasks: [working, continuing('x', 1)], calls: [] }))
        const after = lanesOf(
          board({ tasks: [working, continuing('x', 1, { queued: null, continues: undefined, place: undefined })], calls: [] }),
        )
        let change: (lanes: typeof before) => void = () => undefined
        let hide: (hidden: boolean) => void = () => undefined
        function Kept() {
          const [lanes, setLanes] = useState(before)
          const [hidden, setHidden] = useState(false)
          change = setLanes
          hide = setHidden
          return (
            <Activity mode={hidden ? 'hidden' : 'visible'}>
              <BoardView lanes={lanes} agents={agents} now={NOW} onOpen={vi.fn()} />
            </Activity>
          )
        }
        withServices(<Kept />, fakeClient().client)
        const region = (name: string) => within(screen.getByRole('region', { name }))
        // Its card pressed, its task opens: the board hides with the pointer on Up next, and the task starts meanwhile.
        await userEvent.hover(region('Up next').getByText('Going on x'))
        act(() => hide(true))
        act(() => change(after))
        act(() => hide(false))
        await waitFor(() => expect(region('Running').getByText('Going on x')).toBeTruthy())
      })
    })

    it('moves to running by itself once an agent frees and it starts', () => {
      const lanes = lanesOf(board({ tasks: [waiting('a', 1, { inLine: undefined, queued: null, step: 'implement' })], calls: [] }))
      expect(lanes.next).toEqual([])
      expect(lanes.running.map((work) => work.taskId)).toEqual(['a'])
    })

    it('draws a divider over the line, each row saying its place in it; one alone has nothing to reorder', () => {
      const lanes = lanesOf(board({ tasks: [held, planned, waiting('a', 1)], calls: [] }))
      const line = { move: vi.fn(async () => {}), oldestFirst: vi.fn(), failed: null }
      withServices(<BoardView lanes={lanes} agents={agents} now={NOW} onOpen={vi.fn()} line={line} />, fakeClient().client)
      expect(screen.getByText('Starts when an agent is free')).toBeTruthy()
      expect(screen.getByText('Next in line')).toBeTruthy()
      expect(screen.getByText('Planned')).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Back to oldest first' })).toBeNull()
      expect(screen.queryByRole('button', { name: /in the line$/ })).toBeNull()
    })

    describe('in the person’s order', () => {
      const three = [waiting('a', 1), waiting('b', 2), waiting('c', 3), planned, held]
      const drawn = (tasks: ReadonlyArray<BoardTask>) => {
        const line = { move: vi.fn(async () => {}), oldestFirst: vi.fn(), failed: null as string | null }
        withServices(
          <BoardView lanes={lanesOf(board({ tasks, calls: [] }))} agents={agents} now={NOW} onOpen={vi.fn()} line={line} />,
          fakeClient().client,
        )
        return line
      }
      const titles = () =>
        within(screen.getByRole('region', { name: 'Up next' }))
          .getAllByRole('button', { name: /^Waiting / })
          .map((row) => row.textContent)

      it('gives a grip to each row in it, none to the plans under it', () => {
        drawn(three)
        expect(screen.queryByText('Drag to change the order')).toBeNull()
        expect(screen.queryByRole('button', { name: 'Back to oldest first' })).toBeNull()
        expect(screen.getByText('Next in line')).toBeTruthy()
        expect(screen.getByText('2nd in line')).toBeTruthy()
        expect(screen.getByText('3rd in line')).toBeTruthy()
        expect(screen.getAllByRole('button', { name: /in the line$/ }).map((grip) => grip.getAttribute('aria-label'))).toEqual([
          'Move Waiting a in the line',
          'Move Waiting b in the line',
          'Move Waiting c in the line',
        ])
      })

      it('moves a row from its grip’s menu, at once, and asks the runtime to start the line so', async () => {
        const line = drawn(three)
        screen.getByRole('button', { name: 'Move Waiting c in the line' }).focus()
        await userEvent.keyboard('{Enter}')
        const menu = within(await screen.findByRole('menu', { name: 'Move in the line' }))
        expect(menu.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
          'Move to the front of the line',
          'Move up',
          'Move down',
          'Move to the back of the line',
        ])
        await userEvent.click(menu.getByRole('menuitem', { name: 'Move up' }))
        expect(line.move).toHaveBeenCalledWith('c', 1)
        expect(titles()).toEqual(['Waiting a', 'Waiting c', 'Waiting b'])
        // Each row says its new place.
        expect(
          within(screen.getByRole('region', { name: 'Up next' }))
            .getAllByText(/in line$/)
            .map((one) => one.textContent),
        ).toEqual(['Next in line', '2nd in line', '3rd in line'])
      })

      it('offers the oldest first again once the line is in the person’s order', async () => {
        const line = drawn([
          waiting('c', 1, { reordered: true }),
          waiting('a', 2, { reordered: true }),
          waiting('b', 3, { reordered: true }),
        ])
        expect(titles()).toEqual(['Waiting c', 'Waiting a', 'Waiting b'])
        await userEvent.click(screen.getByRole('button', { name: 'Back to oldest first' }))
        expect(line.oldestFirst).toHaveBeenCalledOnce()
      })
    })
  })

  it('keeps a call its own card where no task on the board waits on it, and a waiting task whose call isn’t read yet', () => {
    const question: BoardCall = { ...permission, id: 'q1', kind: 'question', taskId: null, taskTitle: null, threadId: 'thc' }
    const held: BoardCall = { ...permission, id: 'a2', taskId: 't1', threadId: 'th1' }
    const lanes = lanesOf(
      board({
        tasks: [
          task({ taskId: 't1', threadId: 'th1', phase: 'held' }),
          task({ taskId: 't9', threadId: 'th9', title: 'Asks soon', phase: 'waiting' }),
        ],
        calls: [question, held],
      }),
    )
    expect(lanes.calls.map((call) => call.id)).toEqual(['q1', 'a2'])
    expect(lanes.waiting.map(({ task: work, call }) => [work.taskId, call])).toEqual([['t9', null]])
    expect(needsOf(lanes, () => '', vi.fn()).map((need) => [need.kind, need.title])).toEqual([
      ['Waiting on you', 'Asks soon'],
      ['Question', 'Run make deploy'],
      ['Permission', 'Run make deploy'],
    ])
    expect(yoursOf(lanes)).toBe(3)
  })

  it('keeps a plain task that finished in Needs you, counted, until the person keeps it for later, the latest kept first', () => {
    const finished = task({ taskId: 'p1', threadId: 'thp1', title: 'Which partners call v1?', phase: 'ready', kind: 'plain', branch: null })
    const ready = task({ taskId: 't4', threadId: 'th4', title: 'Rate-limit refunds', phase: 'ready', change: change() })
    const lanes = lanesOf(board({ tasks: [finished, ready], calls: [] }))
    expect(lanes.ready.map((work) => work.taskId)).toEqual(['p1', 't4'])
    expect(lanes.kept).toEqual([])
    expect(yoursOf(lanes)).toBe(2)
    expect(needsOf(lanes, () => '', vi.fn()).map((need) => [need.kind, need.title])).toEqual([
      ['Finished', 'Which partners call v1?'],
      ['Ready to accept', 'Rate-limit refunds'],
    ])
    expect(firstNeedOf(lanes)).toBe('thp1')
    // Kept for later, it is out of Needs you, with what else was kept, the latest first.
    const older = task({
      taskId: 'p2',
      threadId: 'thp2',
      title: 'Prototype the tabs',
      phase: 'kept',
      kind: 'plain',
      keptAt: '2026-10-01T09:00:00.000Z',
    })
    const kept = lanesOf(board({ tasks: [older, { ...finished, phase: 'kept', keptAt: '2026-10-02T09:00:00.000Z' }, ready], calls: [] }))
    expect(kept.ready.map((work) => work.taskId)).toEqual(['t4'])
    expect(kept.kept.map((work) => work.taskId)).toEqual(['p1', 'p2'])
    expect(yoursOf(kept)).toBe(1)
    expect(firstNeedOf(kept)).toBe('th4')
  })

  it('offers Done and Keep for later in a finished card’s corner where it isn’t a change, and Kept beside Settled in its head once there is some', async () => {
    const markDone = vi.fn(async () => true)
    const keep = vi.fn(async () => true)
    const actions = {
      push: vi.fn(),
      merge: vi.fn(),
      pushing: new Set<string>(),
      merging: new Set<string>(),
      failed: {},
      markDone,
      keep,
      settling: new Set<string>(),
    }
    const finished = task({ taskId: 'p1', threadId: 'thp1', title: 'Prototype the tabs', phase: 'ready', kind: 'plain', branch: null })
    const kept = task({
      taskId: 'p2',
      threadId: 'thp2',
      title: 'Spike the limits',
      phase: 'kept',
      kind: 'plain',
      branch: null,
      summary: 'Codex says its limits every turn.',
      keptAt: '2026-10-14T11:00:00.000Z',
    })
    const review = task({ taskId: 'r1', threadId: 'thr1', title: 'Review #1199', phase: 'ready', kind: 'review', branch: null })
    // Its review posted, then written to again, and answered: finished, as a quick task is.
    const answered = task({
      taskId: 'r2',
      threadId: 'thr2',
      title: 'Review #1200',
      phase: 'ready',
      kind: 'review',
      branch: null,
      reviewing: {
        product: 'github',
        repository: 'meridian/api',
        number: 1200,
        url: 'https://github.com/meridian/api/pull/1200',
        title: 'Retry webhooks',
        author: 'ninemate',
        outside: false,
        additions: 1,
        deletions: 0,
        findings: 0,
        blocking: 0,
        verdict: 'comment',
        posted: { url: 'https://github.com/meridian/api/pull/1200#pullrequestreview-1', at: '2026-10-14T09:00:00.000Z' },
        waiting: false,
      },
    })
    const settled = task({
      taskId: 's1',
      threadId: 'ths1',
      title: 'Shipped before',
      phase: 'settled',
      state: 'done',
      settledAt: '2026-10-14T10:00:00.000Z',
    })
    const lanes = lanesOf(
      board({
        tasks: [
          finished,
          kept,
          review,
          answered,
          settled,
          task({ taskId: 't4', threadId: 'th4', title: 'Rate-limit refunds', phase: 'ready', change: change() }),
        ],
        calls: [],
        settledTotal: 1,
      }),
    )
    withServices(
      <BoardView lanes={lanes} agents={agents} now="2026-10-14T12:00:00.000Z" onOpen={vi.fn()} actions={actions} />,
      fakeClient().client,
    )
    const needs = within(screen.getByRole('region', { name: /^Needs you/ }))
    const card = (title: string) => within(needs.getByRole('button', { name: title }).closest('article') ?? document.body)
    // A finished plain task: both. A review drafted: Keep for later alone. A change: neither.
    await userEvent.click(card('Prototype the tabs').getByRole('button', { name: 'Done' }))
    expect(markDone).toHaveBeenCalledWith('p1')
    await userEvent.click(card('Prototype the tabs').getByRole('button', { name: 'Keep for later' }))
    expect(keep).toHaveBeenCalledWith('p1')
    expect(card('Review #1199').queryByRole('button', { name: 'Done' })).toBeNull()
    await userEvent.click(card('Review #1199').getByRole('button', { name: 'Keep for later' }))
    expect(keep).toHaveBeenCalledWith('r1')
    // A review posted and answered since: Finished, with both.
    expect(card('Review #1200').getByText('Finished')).toBeTruthy()
    await userEvent.click(card('Review #1200').getByRole('button', { name: 'Done' }))
    expect(markDone).toHaveBeenCalledWith('r2')
    expect(card('Rate-limit refunds').queryByRole('button', { name: 'Keep for later' })).toBeNull()
    // Settled opens on its ledger, as it always has, its head naming what was kept beside it.
    const lane = within(screen.getByRole('region', { name: /^Settled/ }))
    expect(lane.getByText('Shipped before')).toBeTruthy()
    expect(lane.queryByText('Spike the limits')).toBeNull()
    expect(lane.getByRole('button', { name: /^Settled/, pressed: true })).toBeTruthy()
    await userEvent.click(lane.getByRole('button', { name: 'Kept 1', pressed: false }))
    // Pressed, Kept shows in Settled's place: each in a line, when it was kept under its title.
    expect(lane.getByRole('button', { name: 'Kept 1', pressed: true })).toBeTruthy()
    expect(lane.getByText('Spike the limits')).toBeTruthy()
    expect(lane.getByText(/^kept /)).toBeTruthy()
    expect(lane.queryByText('Shipped before')).toBeNull()
    await userEvent.click(lane.getByRole('button', { name: 'Done' }))
    expect(markDone).toHaveBeenCalledWith('p2')
  })

  it('keeps a merged task with commits after its pull request in Needs you, and settles it once they are left out', () => {
    const merged = change({ state: 'merged' })
    const after = task({
      taskId: 't8',
      threadId: 'th8',
      title: 'Cap parallel agents per machine',
      state: 'done',
      phase: 'ready',
      change: merged,
      unshipped: { commits: 1, add: 300, del: 304 },
      settledAt: '2026-10-01T09:30:00.000Z',
    })
    const before = lanesOf(board({ tasks: [after], calls: [] }))
    expect(before.ready.map((work) => work.taskId)).toEqual(['t8'])
    expect(yoursOf(before)).toBe(1)
    expect(needsOf(before, () => '', vi.fn()).map((need) => need.title)).toEqual(['Cap parallel agents per machine'])
    // Left out, the runtime reads it as settled, with nothing in none: it goes among the settled, at the time it first settled.
    const left = lanesOf(board({ tasks: [{ ...after, phase: 'settled', unshipped: null }], calls: [], settledTotal: 1 }))
    expect(left.ready).toEqual([])
    expect(left.settled.map((work) => [work.taskId, work.settledAt])).toEqual([['t8', '2026-10-01T09:30:00.000Z']])
    expect(yoursOf(left)).toBe(0)
  })

  it('lists a drafted review as one to post, by its pull request and whose it is', () => {
    const reviewing = {
      product: 'github' as const,
      repository: 'meridian/api',
      number: 1199,
      url: 'https://github.com/meridian/api/pull/1199',
      title: 'Retry webhooks',
      author: 'ninemate',
      outside: true,
      additions: 12,
      deletions: 3,
      findings: 3,
      blocking: 1,
      verdict: 'changes' as const,
      posted: null,
    }
    const lanes = lanesOf(
      board({
        tasks: [task({ taskId: 'r1', threadId: 'thr1', title: 'Review #1199', phase: 'ready', kind: 'review', reviewing, branch: null })],
        calls: [],
      }),
    )
    expect(needsOf(lanes, () => '', vi.fn()).map((need) => [need.kind, need.title, need.meta])).toEqual([
      ['Review drafted', 'Review #1199', 'PR #1199 by ninemate'],
    ])
    expect(yoursOf(lanes)).toBe(1)
  })

  it('lists what needs the person, the task on screen among them but opening nothing, and opens the first of the others', () => {
    const lanes = lanesOf(board())
    const onTask = vi.fn()
    const needs = needsOf(lanes, () => '', onTask, 'th3')
    expect(needs.map((need) => [need.kind, need.title, need.here === true])).toEqual([
      ['Permission', 'Run make deploy', true],
      ['Ready to accept', 'Rate-limit refunds', false],
      ['Ready to accept', 'Tidy the docs', false],
    ])
    expect(firstNeedOf(lanes)).toBe('th3')
    expect(firstNeedOf(lanes, 'th3')).toBe('th4')
    expect(firstNeedOf(lanesOf(board({ tasks: [], calls: [permission] })), 'th3')).toBeNull()
  })

  it('names a task’s steps, and the one it is on', () => {
    expect(trackOf(task({ step: 'settle' }))).toEqual({ steps: ['Implement', 'Review'], at: 1 })
    expect(trackOf(task({ step: 'publish' }))).toEqual({ steps: ['Implement', 'Review'], at: 1 })
    expect(trackOf(task({ step: 'implement' }))).toEqual({ steps: ['Implement', 'Review'], at: 0 })
    // A task with no plan is a conversation with its lead.
    expect(trackOf(task({ plan: null }))).toEqual({ steps: ['Conversation'], at: 0 })
    // Resolving a conflict, or fixing the checks on the merge, comes after the steps.
    expect(trackOf(task({ step: 'conflict' }))).toEqual({ steps: ['Implement', 'Review'], at: 1 })
    expect(trackOf(task({ step: 'checks' }))).toEqual({ steps: ['Implement', 'Review'], at: 1 })
  })

  it('lists work its lead couldn’t resolve a conflict for as stuck, with why, among what needs the person', () => {
    const why = 'The lead couldn’t resolve the conflict with main, in README.md. The merge of origin/main isn’t committed.'
    const lanes = lanesOf(
      board({ tasks: [task({ taskId: 't8', threadId: 'th8', title: 'Add a limit', phase: 'ready', handedBack: why })], calls: [] }),
    )
    expect(lanes.ready.map((work) => work.taskId)).toEqual(['t8'])
    expect(needsOf(lanes, () => '', vi.fn()).map((need) => [need.kind, need.title, need.meta])).toEqual([['Stuck', 'Add a limit', why]])
  })

  it('lists work whose failing checks its lead brought to the person as stuck, with its line', () => {
    const why = 'Fails on main too: test times out in limit.test.ts.'
    const lanes = lanesOf(
      board({ tasks: [task({ taskId: 't9', threadId: 'th9', title: 'Add a limit', phase: 'ready', checksBack: why })], calls: [] }),
    )
    expect(needsOf(lanes, () => '', vi.fn()).map((need) => [need.kind, need.title, need.meta])).toEqual([['Stuck', 'Add a limit', why]])
  })
})

describe('the board', () => {
  it('shows the project’s work by lane, and how much runs and needs you', async () => {
    const { client } = fakeClient({ getBoard: vi.fn(async () => board()) })
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('radio', { name: 'Board' }))
    const work = await screen.findByRole('region', { name: 'The project’s work' })
    expect(within(work).getByText('Add a retry')).toBeTruthy()
    expect(within(work).getByText('Fix the limit')).toBeTruthy()
    // The task waiting on a call is one card, saying the call and why, with the command it asks to run.
    const asking = within(work).getByRole('button', { name: 'Ship it' }).closest('article') as HTMLElement
    expect(within(asking).getByText('Permission')).toBeTruthy()
    expect(within(asking).getByText('Run make deploy')).toBeTruthy()
    expect(within(asking).getByText('make deploy')).toBeTruthy()
    expect(within(work).getByText('Rate-limit refunds')).toBeTruthy()
    // Ready on its branch, with no pull request: the branch, and how big its change is.
    expect(within(work).getByText('althar/tidy-the-docs')).toBeTruthy()
    expect(within(work).getByText('PR #7 merged')).toBeTruthy()
    // In the header, where it stands is one chip: three things that need you, a way into them; what runs isn't said beside it.
    const header = screen.getByRole('heading', { level: 1, name: 'meridian' }).closest('header') as HTMLElement
    expect(within(header).getByRole('button', { name: '3 need you' })).toBeTruthy()
    expect(header.textContent).not.toMatch(/in progress|running|merged/)
    expect(screen.queryByText(/running/)).toBeNull()
  })

  it('says on a task’s card which automation’s run it is, whichever lane it is in, and nothing on one of the person’s own', async () => {
    const from = { id: 'auto1', name: 'Morning review' }
    const { client } = fakeClient({
      getBoard: vi.fn(async () =>
        board({
          tasks: [
            task({ taskId: 't2', threadId: 'th2', title: 'Review #264', slug: 'review-264', phase: 'running', automation: from }),
            task({ taskId: 't3', threadId: 'th3', title: 'Ship it', slug: 'ship-it', phase: 'waiting', automation: from }),
            task({
              taskId: 't4',
              threadId: 'th4',
              title: 'Bump zod',
              slug: 'bump-zod',
              phase: 'ready',
              automation: { id: 'auto2', name: 'Nightly bump' },
            }),
            task({ taskId: 't5', threadId: 'th5', title: 'Mine', slug: 'mine', phase: 'running', automation: null }),
          ],
        }),
      ),
    })
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('radio', { name: 'Board' }))
    const work = await screen.findByRole('region', { name: 'The project’s work' })
    const cardOf = (title: string) => within(within(work).getByRole('button', { name: title }).closest('article') as HTMLElement)
    expect(cardOf('Review #264').getByText('From Morning review')).toBeTruthy()
    expect(cardOf('Ship it').getByText('From Morning review')).toBeTruthy()
    expect(cardOf('Bump zod').getByText('From Nightly bump')).toBeTruthy()
    expect(cardOf('Mine').queryByText(/^From /)).toBeNull()
  })

  it('counts every settled task, loads only the latest, and loads the older ones on request', async () => {
    const settledAt = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString()
    const settledTask = (n: number) =>
      task({
        taskId: `s${n}`,
        threadId: `ths${n}`,
        title: `Settled ${n}`,
        slug: `settled-${n}`,
        phase: 'settled',
        state: 'done',
        settledAt: settledAt(n),
      })
    const latest = Array.from({ length: 30 }, (_, i) => settledTask(i + 5))
    const older = Array.from({ length: 5 }, (_, i) => settledTask(4 - i))
    const getBoard = vi.fn(async () => board({ tasks: latest, calls: [], settledTotal: 35 }))
    const getOlderSettled = vi.fn(async () => older)
    const { client, emit } = fakeClient({ getBoard, getOlderSettled })
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('radio', { name: 'Board' }))
    const work = await screen.findByRole('region', { name: 'The project’s work' })
    const column = within(work).getByRole('heading', { name: 'Settled' }).closest('section') as HTMLElement
    // 35 in all, though 30 are loaded.
    expect(within(column).getByText('35')).toBeTruthy()
    expect(within(column).getAllByRole('listitem')).toHaveLength(30)
    expect(within(column).queryByText('Settled 0')).toBeNull()

    await userEvent.click(within(column).getByRole('button', { name: 'Show older' }))
    expect(await within(column).findByText('Settled 0')).toBeTruthy()
    // Asked for what came before the oldest it had.
    expect(getOlderSettled).toHaveBeenCalledWith('p1', settledAt(5), 's5')
    expect(within(column).getAllByRole('listitem')).toHaveLength(35)
    expect(within(column).getByText('35')).toBeTruthy()
    // Everything is shown: nothing more to ask for.
    expect(within(column).queryByRole('button', { name: 'Show older' })).toBeNull()

    // One more settles: 36 in all, the older ones still there.
    getBoard.mockImplementation(async () => board({ tasks: [settledTask(35), ...latest.slice(1)], calls: [], settledTotal: 36 }))
    emit(changed('task', 's35'))
    expect(await within(column).findByText('36')).toBeTruthy()
    // Every card stays, the one that aged out of the snapshot (5) among them.
    expect(within(column).getAllByRole('listitem')).toHaveLength(36)
    expect(within(column).getByText('Settled 0')).toBeTruthy()
    expect(within(column).getByText('Settled 5')).toBeTruthy()
    expect(within(column).queryByRole('button', { name: 'Show older' })).toBeNull()
  })

  it('asks for a page of older settled tasks once, however often it is pointed at, and says when it fails', async () => {
    const settledAt = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString()
    const settledTask = (n: number) =>
      task({
        taskId: `s${n}`,
        threadId: `ths${n}`,
        title: `Settled ${n}`,
        slug: `settled-${n}`,
        phase: 'settled',
        state: 'done',
        settledAt: settledAt(n),
      })
    const latest = Array.from({ length: 30 }, (_, i) => settledTask(i + 35))
    const first = Array.from({ length: 30 }, (_, i) => settledTask(34 - i))
    let release: (tasks: BoardTask[]) => void = () => {}
    const getOlderSettled = vi
      .fn<() => Promise<BoardTask[]>>()
      .mockReturnValueOnce(new Promise((resolve) => (release = resolve)))
      .mockRejectedValueOnce(new ApiError({ reason: 'SqlError', message: 'Broken.' }))
      .mockResolvedValue([])
    const { client } = fakeClient({ getBoard: vi.fn(async () => board({ tasks: latest, calls: [], settledTotal: 65 })), getOlderSettled })
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('radio', { name: 'Board' }))
    const work = await screen.findByRole('region', { name: 'The project’s work' })
    const column = within(work).getByRole('heading', { name: 'Settled' }).closest('section') as HTMLElement
    const more = within(column).getByRole('button', { name: 'Show older' })
    await userEvent.click(more)
    await userEvent.click(more)
    expect(getOlderSettled).toHaveBeenCalledTimes(1)
    release(first)
    await waitFor(() => expect(within(column).getAllByRole('listitem')).toHaveLength(60))
    // The next page fails: it says so, and the board stays.
    await userEvent.click(within(column).getByRole('button', { name: 'Show older' }))
    expect(await screen.findByText(/couldn’t load older tasks\. Broken\./)).toBeTruthy()
    expect(within(column).getAllByRole('listitem')).toHaveLength(60)
    expect(within(column).getByRole('button', { name: 'Show older' })).toBeTruthy()
  })

  it('opens the first thing that needs you in its task, from the front page, and shows the rest when pointed at', async () => {
    const onTask = vi.fn()
    const { client } = fakeClient({ getBoard: vi.fn(async () => board()) })
    withServices(<Project onTask={onTask} />, client)
    // From Home, where a project opens, the count opens the call's task: no view changes, and nothing opens beside the board.
    await userEvent.click(await screen.findByRole('button', { name: '3 need you' }))
    expect(onTask).toHaveBeenCalledWith('th3')
    expect(screen.getByRole('radio', { name: 'Home', checked: true })).toBeTruthy()
    expect(screen.queryByRole('complementary', { name: 'Beside the board' })).toBeNull()
    // Pointed at, it says what each is, and each opens its own task.
    await userEvent.hover(screen.getByRole('button', { name: '3 need you' }))
    const needs = await screen.findByRole('list', { name: 'What needs you' })
    const rows = within(needs).getAllByRole('button')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/^Permission.*Run make deployShip it$/),
      'Ready to acceptRate-limit refundsPR #12',
      'Ready to acceptTidy the docsalthar/tidy-the-docs',
    ])
    await userEvent.click(within(needs).getByRole('button', { name: /Tidy the docs/ }))
    expect(onTask).toHaveBeenLastCalledWith('th5')
  })

  it('opens a card’s task, whatever lane it is in', async () => {
    const onTask = vi.fn()
    const { client } = fakeClient({ getBoard: vi.fn(async () => board()) })
    withServices(<Project onTask={onTask} />, client)
    await userEvent.click(await screen.findByRole('radio', { name: 'Board' }))
    for (const [title, thread] of [
      ['Add a retry', 'th1'],
      ['Fix the limit', 'th2'],
      ['Ship it', 'th3'],
      ['Rate-limit refunds', 'th4'],
      ['Old work', 'th6'],
    ] as const) {
      await userEvent.click(await screen.findByRole('button', { name: new RegExp(title) }))
      expect(onTask).toHaveBeenLastCalledWith(thread)
    }
    expect(screen.queryByRole('complementary', { name: 'Beside the board' })).toBeNull()
  })

  it('answers a call in the dock', async () => {
    const answer = vi.fn(async () => {})
    const { client } = fakeClient({ answer, getBoard: vi.fn(async () => board()) })
    withServices(<Docked target={{ kind: 'call', id: 'a1' }} />, client)
    const dock = await screen.findByRole('complementary', { name: 'Beside the board' })
    expect(within(dock).getByText(/^Ship it · /)).toBeTruthy()
    await userEvent.click(within(dock).getByRole('button', { name: /^Allow/ }))
    await waitFor(() => expect(answer).toHaveBeenCalledWith({ attentionId: 'a1', decision: 'allow' }))
  })

  it('accepts a pull request by merging it, or sends it back with a note, and says when the host won’t', async () => {
    const merge = vi
      .fn<(taskId: string) => Promise<void>>()
      .mockRejectedValueOnce(new ApiError({ reason: 'ConnectorFailed', message: 'GitHub says: Pull Request is not mergeable' }))
      .mockResolvedValue(undefined)
    const send = vi.fn(async () => {})
    const startSession = vi.fn(async () => 's1')
    const { client } = fakeClient({
      merge,
      send,
      startSession,
      getBoard: vi.fn(async () => board()),
      getThread: vi.fn(async () =>
        snapshot({
          session: null,
          task: {
            ...snapshot().task,
            id: 't4',
            lead: { agentId: 'claude-code', model: null, account: null },
            files: [{ path: 'src/limit.ts', from: null, status: 'modified', add: 12, del: 3, binary: false, uncommitted: false }],
          },
        }),
      ),
    })
    withServices(<Docked target={{ kind: 'task', id: 't4' }} />, client)
    const dock = await screen.findByRole('complementary', { name: 'Beside the board' })
    expect(within(dock).getByText('Retried the call.')).toBeTruthy()
    expect(await within(dock).findByText('limit.ts')).toBeTruthy()
    await userEvent.click(within(dock).getByRole('button', { name: /Accept and merge/ }))
    expect(await within(dock).findByText('GitHub says: Pull Request is not mergeable')).toBeTruthy()
    await userEvent.click(within(dock).getByRole('button', { name: /Accept and merge/ }))
    await waitFor(() => expect(merge).toHaveBeenCalledTimes(2))
    // At the head the dock showed.
    expect(merge).toHaveBeenLastCalledWith('t4', 'abc123', 'https://github.com/meridian/api/pull/12')
    // Sent back, its lead, which stopped, starts again with the note as its first turn.
    await userEvent.click(within(dock).getByRole('button', { name: 'Ask for changes' }))
    await userEvent.type(within(dock).getByRole('textbox'), 'Name it better.')
    await userEvent.click(within(dock).getByRole('button', { name: 'Send to the lead' }))
    await waitFor(() => expect(send).toHaveBeenCalledWith({ threadId: 'th4', body: 'Name it better.', disposition: 'after_current' }))
    await waitFor(() => expect(startSession).toHaveBeenCalledWith({ threadId: 'th4', agentId: 'claude-code' }))
    // The note is queued first, so the lead reads it in its first turn.
    expect(send.mock.invocationCallOrder[0]).toBeLessThan(startSession.mock.invocationCallOrder[0] ?? 0)
  })

  describe('merged anywhere in the window, as in its task before Back', () => {
    const url = 'https://github.com/meridian/api/pull/12'
    function Elsewhere() {
      const merge = useMerge()
      return (
        <button type="button" onClick={() => void merge({ taskId: 't4', head: 'abc123', url }).catch(() => undefined)}>
          Merge there
        </button>
      )
    }
    const lane = (name: string) => within(screen.getByRole('region', { name }))
    const settledBoard = () =>
      board({
        tasks: board().tasks.map((one) =>
          one.taskId === 't4'
            ? { ...one, phase: 'settled', state: 'done', settledAt: '2026-10-01T10:00:00.000Z', change: change({ state: 'merged' }) }
            : one,
        ),
        settledTotal: 3,
      })

    it('leaves Needs you as Merging the moment it is pressed, and settles as the runtime says, read once', async () => {
      let merged = () => undefined as void
      const merge = vi.fn(() => new Promise<void>((resolve) => (merged = resolve)))
      const getBoard = vi.fn(async () => board())
      const { client, emit } = fakeClient({ merge, getBoard })
      withServices(
        <>
          <Project />
          <Elsewhere />
        </>,
        client,
      )
      await userEvent.click(await screen.findByRole('radio', { name: 'Board' }))
      expect(await lane('Needs you').findByText('Rate-limit refunds')).toBeTruthy()
      await userEvent.click(screen.getByRole('button', { name: 'Merge there' }))
      // At once, with nothing read again: at work, merging, and no longer counted as needing the person.
      expect(await lane('Running').findByText('Merging')).toBeTruthy()
      expect(lane('Running').getByText('Rate-limit refunds')).toBeTruthy()
      expect(lane('Needs you').queryByText('Rate-limit refunds')).toBeNull()
      expect(screen.getByRole('button', { name: '2 need you' })).toBeTruthy()
      expect(merge).toHaveBeenCalledWith('t4', 'abc123', url)
      // Merged on its host: merging still, until the board reads it settled, not back in Needs you meanwhile.
      const reads = getBoard.mock.calls.length
      getBoard.mockImplementation(async () => settledBoard())
      await act(async () => merged())
      expect(lane('Running').getByText('Rate-limit refunds')).toBeTruthy()
      expect(lane('Needs you').queryByText('Rate-limit refunds')).toBeNull()
      // The runtime says it settled: read once, and it is in Settled.
      emit(changed('task', 't4'))
      expect(await lane('Settled').findByText('Rate-limit refunds')).toBeTruthy()
      expect(lane('Running').queryByText('Rate-limit refunds')).toBeNull()
      expect(getBoard).toHaveBeenCalledTimes(reads + 1)
    })

    it('is in Running, in the merge queue, for as long as the board reads it so, and the person’s again once the queue takes it out', async () => {
      const queued = board({
        tasks: board().tasks.map((one) => (one.taskId === 't4' ? { ...one, change: change({ queued: true }) } : one)),
      })
      const getBoard = vi.fn(async () => queued)
      const { client, emit } = fakeClient({ getBoard })
      withServices(<Project />, client)
      await userEvent.click(await screen.findByRole('radio', { name: 'Board' }))
      // Read so, as after a restart, with nothing pressed in this window: at work, and saying where.
      expect(await lane('Running').findByText('In the merge queue')).toBeTruthy()
      expect(lane('Running').getByText('Rate-limit refunds')).toBeTruthy()
      expect(lane('Needs you').queryByText('Rate-limit refunds')).toBeNull()
      // The queue took it out: it is the person's to merge again.
      getBoard.mockImplementation(async () => board())
      emit(changed('task', 't4'))
      expect(await lane('Needs you').findByText('Rate-limit refunds')).toBeTruthy()
      expect(lane('Running').queryByText('In the merge queue')).toBeNull()
    })

    it('is the person’s again once its pull request merged and another of its own is open', async () => {
      const merge = vi.fn(async () => undefined)
      const next = change({ number: 13, url: 'https://github.com/meridian/api/pull/13', head: 'def456', draft: false })
      const getBoard = vi.fn(async () => board())
      const { client, emit } = fakeClient({ merge, getBoard })
      withServices(
        <>
          <Project />
          <Elsewhere />
        </>,
        client,
      )
      await userEvent.click(await screen.findByRole('radio', { name: 'Board' }))
      await lane('Needs you').findByText('Rate-limit refunds')
      // #12 merged; the task shows #13 now, still open, which nobody is merging.
      getBoard.mockImplementation(async () =>
        board({ tasks: board().tasks.map((one) => (one.taskId === 't4' ? { ...one, change: next } : one)) }),
      )
      await userEvent.click(screen.getByRole('button', { name: 'Merge there' }))
      await waitFor(() => expect(merge).toHaveBeenCalled())
      emit(changed('task', 't4'))
      expect(await lane('Needs you').findByText('Rate-limit refunds')).toBeTruthy()
      expect(lane('Running').queryByText('Merging')).toBeNull()
    })

    it('comes back to Needs you with why it didn’t merge, and merges again from its card', async () => {
      const merge = vi
        .fn<(taskId: string) => Promise<void>>()
        .mockRejectedValueOnce(new ApiError({ reason: 'ConnectorFailed', message: 'GitHub says: Pull Request is not mergeable' }))
        .mockResolvedValue(undefined)
      const { client } = fakeClient({ merge, getBoard: vi.fn(async () => board()) })
      withServices(
        <>
          <Project />
          <Elsewhere />
        </>,
        client,
      )
      await userEvent.click(await screen.findByRole('radio', { name: 'Board' }))
      await lane('Needs you').findByText('Rate-limit refunds')
      await userEvent.click(screen.getByRole('button', { name: 'Merge there' }))
      const card = within((await lane('Needs you').findByRole('button', { name: 'Rate-limit refunds' })).closest('article') as HTMLElement)
      expect(await card.findByText(/Pull Request is not mergeable/)).toBeTruthy()
      expect(lane('Running').queryByText('Rate-limit refunds')).toBeNull()
      await userEvent.click(card.getByRole('button', { name: /again/i }))
      await waitFor(() => expect(merge).toHaveBeenCalledTimes(2))
      expect(merge).toHaveBeenLastCalledWith('t4', 'abc123', url)
    })
  })

  it.each([
    ['a stale session summary', false, true],
    ['a held session', true, false],
  ] as const)('sends back with a note when %s', async (_description, held, starts) => {
    const send = vi.fn(async () => {})
    const startSession = vi.fn(async () => 's1')
    const base = snapshot()
    const { client } = fakeClient({
      send,
      startSession,
      getBoard: vi.fn(async () => board()),
      getThread: vi.fn(async () =>
        snapshot({
          session: base.session === null ? null : { ...base.session, held },
          task: { ...base.task, id: 't4', lead: { agentId: 'claude-code', model: null, account: null } },
        }),
      ),
    })
    withServices(<Docked target={{ kind: 'task', id: 't4' }} />, client)
    const dock = await screen.findByRole('complementary', { name: 'Beside the board' })
    await userEvent.click(within(dock).getByRole('button', { name: 'Ask for changes' }))
    await userEvent.type(within(dock).getByRole('textbox'), 'Please rename it.')
    await userEvent.click(within(dock).getByRole('button', { name: 'Send to the lead' }))
    await waitFor(() => expect(send).toHaveBeenCalledWith({ threadId: 'th4', body: 'Please rename it.', disposition: 'after_current' }))
    if (starts) {
      await waitFor(() => expect(startSession).toHaveBeenCalledWith({ threadId: 'th4', agentId: 'claude-code' }))
      expect(send.mock.invocationCallOrder[0]).toBeLessThan(startSession.mock.invocationCallOrder[0] ?? 0)
    } else expect(startSession).not.toHaveBeenCalled()
  })

  it('starts the lead the thread has now, not the one the board card was read with', async () => {
    const send = vi.fn(async () => {})
    const startSession = vi.fn(async () => 's1')
    const { client } = fakeClient({
      send,
      startSession,
      getBoard: vi.fn(async () => board()),
      getThread: vi.fn(async () =>
        snapshot({ session: null, task: { ...snapshot().task, id: 't4', lead: { agentId: 'codex', model: null, account: null } } }),
      ),
    })
    withServices(<Docked target={{ kind: 'task', id: 't4' }} />, client)
    const dock = await screen.findByRole('complementary', { name: 'Beside the board' })
    await userEvent.click(within(dock).getByRole('button', { name: 'Ask for changes' }))
    await userEvent.type(within(dock).getByRole('textbox'), 'Please rename it.')
    await userEvent.click(within(dock).getByRole('button', { name: 'Send to the lead' }))
    await waitFor(() => expect(startSession).toHaveBeenCalledWith({ threadId: 'th4', agentId: 'codex' }))
  })

  it('reports that Send back has no lead to start without queuing the note', async () => {
    const send = vi.fn(async () => {})
    const startSession = vi.fn(async () => 's1')
    const { client } = fakeClient({
      send,
      startSession,
      getBoard: vi.fn(async () => board()),
      getThread: vi.fn(async () => snapshot({ session: null, task: { ...snapshot().task, id: 't4', lead: null } })),
    })
    withServices(<Docked target={{ kind: 'task', id: 't4' }} />, client)
    const dock = await screen.findByRole('complementary', { name: 'Beside the board' })
    await userEvent.click(within(dock).getByRole('button', { name: 'Ask for changes' }))
    await userEvent.type(within(dock).getByRole('textbox'), 'Please rename it.')
    await userEvent.click(within(dock).getByRole('button', { name: 'Send to the lead' }))
    expect(await screen.findByText('This task has no lead to start. Pick an agent for it first.')).toBeTruthy()
    expect(send).not.toHaveBeenCalled()
    expect(startSession).not.toHaveBeenCalled()
  })

  it('shows the queued note status when the lead fails before a session exists', async () => {
    const send = vi.fn(async () => {})
    const startSession = vi.fn(async () => {
      throw new ApiError({ reason: 'NoAccount', message: 'No signed-in account is available.' })
    })
    const base = snapshot()
    const { client } = fakeClient({
      send,
      startSession,
      getBoard: vi.fn(async () => board()),
      getThread: vi.fn(async () =>
        snapshot({
          session: base.session === null ? null : { ...base.session, held: false },
          task: { ...base.task, id: 't4', lead: { agentId: 'claude-code', model: null, account: null } },
        }),
      ),
    })
    withServices(<Docked target={{ kind: 'task', id: 't4' }} />, client)
    const dock = await screen.findByRole('complementary', { name: 'Beside the board' })
    await userEvent.click(within(dock).getByRole('button', { name: 'Ask for changes' }))
    await userEvent.type(within(dock).getByRole('textbox'), 'Please rename it.')
    await userEvent.click(within(dock).getByRole('button', { name: 'Send to the lead' }))

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(startSession).toHaveBeenCalledWith({ threadId: 'th4', agentId: 'claude-code' }))
    const status = await screen.findByRole('alert')
    expect(status.textContent).toContain('Note queued, but the lead could not start.')
    expect(status.textContent).toContain('No signed-in account is available.')
    expect(status.textContent).toContain("The note is already queued; don't send it again.")
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('pushes what the lead committed since before the pull request can be accepted, up to what the dock showed', async () => {
    const push = vi
      .fn<(taskId: string, head: string, url?: string) => Promise<void>>()
      .mockRejectedValueOnce(new ApiError({ reason: 'ChangedSinceSeen', message: 'It changed since you looked. Look again.' }))
      .mockResolvedValue(undefined)
    const later = board().tasks.map((work) =>
      work.taskId === 't4' && work.change !== null ? { ...work, change: { ...work.change, unpushed: 2, localHead: 'def456' } } : work,
    )
    const { client } = fakeClient({ push, getBoard: vi.fn(async () => board({ tasks: later })) })
    withServices(<Docked target={{ kind: 'task', id: 't4' }} />, client)
    const dock = await screen.findByRole('complementary', { name: 'Beside the board' })
    expect(await within(dock).findByText('2 commits aren’t on the pull request yet')).toBeTruthy()
    expect(within(dock).queryByRole('button', { name: /Accept and merge/ })).toBeNull()
    // A push that didn't go through says why, and can be tried again.
    await userEvent.click(within(dock).getByRole('button', { name: 'Push' }))
    expect(await within(dock).findByText('It changed since you looked. Look again.')).toBeTruthy()
    await userEvent.click(within(dock).getByRole('button', { name: 'Push' }))
    await waitFor(() => expect(push).toHaveBeenCalledTimes(2))
    expect(push).toHaveBeenLastCalledWith('t4', 'def456', 'https://github.com/meridian/api/pull/12')
  })

  it('offers neither Push nor Accept while what the lead committed goes up on its own (ADR-071)', async () => {
    const later = board().tasks.map((work) =>
      work.taskId === 't4' && work.change !== null
        ? { ...work, change: { ...work.change, unpushed: 1, localHead: 'def456', pushing: { held: null } } }
        : work,
    )
    const { client } = fakeClient({ getBoard: vi.fn(async () => board({ tasks: later })) })
    withServices(<Docked target={{ kind: 'task', id: 't4' }} />, client)
    const dock = await screen.findByRole('complementary', { name: 'Beside the board' })
    expect(await within(dock).findByText('One commit is going up to the pull request')).toBeTruthy()
    expect(within(dock).queryByRole('button', { name: /Accept and merge/ })).toBeNull()
    expect(within(dock).queryByRole('button', { name: 'Push' })).toBeNull()
  })

  it('opens work ready on its branch to review its changes, and its task', async () => {
    const onTask = vi.fn()
    const onChanges = vi.fn()
    const { client } = fakeClient({ getBoard: vi.fn(async () => board()) })
    withServices(<Docked target={{ kind: 'task', id: 't5' }} onTask={onTask} onChanges={onChanges} />, client)
    const dock = await screen.findByRole('complementary', { name: 'Beside the board' })
    await userEvent.click(within(dock).getByRole('button', { name: 'Review the changes' }))
    expect(onChanges).toHaveBeenCalledWith(expect.objectContaining({ taskId: 't5' }))
    await userEvent.click(within(dock).getByRole('button', { name: 'Open the task' }))
    expect(onTask).toHaveBeenCalledWith('th5')
  })

  it('opens the pull request of work that ended on its branch, and says when it can’t', async () => {
    const openChange = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError({ reason: 'NotConnected', message: "Althar isn't connected to GitHub. Connect it, then try again." }),
      )
      .mockResolvedValue(undefined)
    const { client } = fakeClient({ openChange, getBoard: vi.fn(async () => board()) })
    withServices(<Docked target={{ kind: 'task', id: 't5' }} />, client)
    const dock = await screen.findByRole('complementary', { name: 'Beside the board' })
    await userEvent.click(within(dock).getByRole('button', { name: 'Open a pull request' }))
    expect(await within(dock).findByRole('alert')).toHaveProperty(
      'textContent',
      "Althar isn't connected to GitHub. Connect it, then try again.",
    )
    await userEvent.click(within(dock).getByRole('button', { name: 'Open a pull request' }))
    await waitFor(() => expect(within(dock).queryByRole('alert')).toBeNull())
    expect(openChange).toHaveBeenLastCalledWith('t5')
  })

  it('merges work that ended on its branch here, and says when it can’t', async () => {
    const mergeHere = vi
      .fn<(taskId: string, heads: ReadonlyArray<{ repository: string; head: string }>) => Promise<void>>()
      .mockRejectedValueOnce(
        new ApiError({
          reason: 'CantMerge',
          message: 'It conflicts with the default branch, in README.md. Tell the lead to bring its branch up to date, then merge again.',
        }),
      )
      .mockResolvedValue(undefined)
    const here = [{ repository: 'meridian', name: 'meridian', branch: 'main', head: 'abc111' }]
    const tasks = board().tasks.map((work) => (work.taskId === 't5' ? { ...work, here } : work))
    const { client } = fakeClient({ mergeHere, getBoard: vi.fn(async () => board({ tasks })) })
    withServices(<Docked target={{ kind: 'task', id: 't5' }} />, client)
    const dock = await screen.findByRole('complementary', { name: 'Beside the board' })
    await userEvent.click(within(dock).getByRole('button', { name: 'Merge into main' }))
    expect(await within(dock).findByRole('alert')).toHaveProperty(
      'textContent',
      'It conflicts with the default branch, in README.md. Tell the lead to bring its branch up to date, then merge again.',
    )
    await userEvent.click(within(dock).getByRole('button', { name: 'Merge into main' }))
    await waitFor(() => expect(mergeHere).toHaveBeenCalledTimes(2))
    expect(mergeHere).toHaveBeenLastCalledWith('t5', [{ repository: 'meridian', head: 'abc111' }])
  })

  it('merges a repository that ended on its branch here, beside the pull request of the rest', async () => {
    const mergeHere = vi.fn(async () => {})
    const here = [{ repository: 'tools', name: 'tools', branch: 'main', head: 'abc111' }]
    const tasks = board().tasks.map((work) => (work.taskId === 't4' ? { ...work, here } : work))
    const { client } = fakeClient({ mergeHere, getBoard: vi.fn(async () => board({ tasks })) })
    withServices(<Docked target={{ kind: 'task', id: 't4' }} />, client)
    const dock = await screen.findByRole('complementary', { name: 'Beside the board' })
    expect(within(dock).getByRole('button', { name: /Accept and merge/ })).toBeTruthy()
    await userEvent.click(within(dock).getByRole('button', { name: 'Merge tools into main' }))
    await waitFor(() => expect(mergeHere).toHaveBeenCalledWith('t4', [{ repository: 'tools', head: 'abc111' }]))
  })

  it('is read again when something it shows changes, not for what is said in a thread', async () => {
    const getBoard = vi.fn(async () => board())
    const { client, emit } = fakeClient({ getBoard })
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('radio', { name: 'Board' }))
    await screen.findByRole('region', { name: 'The project’s work' })
    const reads = getBoard.mock.calls.length
    await act(async () => {
      emit(changed('thread_item', 'i9', 'th2'))
      emit(changed('user_input', 'u1', 'th2'))
      // Another project's task isn't this board's.
      emit(changed('task', 't9', null, 'p2'))
      await new Promise((resolve) => setTimeout(resolve, 120))
    })
    expect(getBoard.mock.calls.length).toBe(reads)
    await act(async () => {
      emit(changed('turn_delivery', 'd1', 'th2'))
      emit(changed('external_link', 'x1', null))
    })
    await waitFor(() => expect(getBoard.mock.calls.length).toBe(reads + 1))
  })

  it('says when it can’t be read', async () => {
    const { client } = fakeClient({ getBoard: vi.fn(async () => Promise.reject(new ApiError({ reason: 'SqlError', message: 'Broken.' }))) })
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('radio', { name: 'Board' }))
    expect(await screen.findByText('Althar couldn’t read the board. Broken.')).toBeTruthy()
  })
})

describe('every state the board shows', () => {
  const NOW = '2026-10-01T10:00:00.000Z'
  const stuck = (step: 'implement' | 'publish', why: 'session_ended' | 'failed_to_start' | 'not_connected'): BoardCall => ({
    ...permission,
    id: `s-${step}-${why}`,
    kind: 'stuck',
    title: '',
    reason: '',
    command: null,
    stuck: { step, why, detail: null, agentId: 'claude-code', round: 0, open: 0 },
  })
  const all = board({
    tasks: [
      task({ taskId: 'a', title: 'Held plan', phase: 'held', plan: { ...card().plan!, startsAt: null } }),
      task({ taskId: 'b', title: 'Starting plan', phase: 'planned', plan: { ...card().plan!, startsAt: '2026-10-01T09:59:59.000Z' } }),
      task({ taskId: 'c', title: 'Counting down', phase: 'planned', plan: { ...card().plan!, startsAt: '2026-10-01T10:00:20.000Z' } }),
      task({
        taskId: 'd',
        title: 'Stopped work',
        phase: 'stopped',
        startedAt: '2026-10-01T07:30:00.000Z',
        stopped: { by: 'declined', at: '2026-10-01T08:00:00.000Z' },
      }),
      task({ taskId: 'e', title: 'A conversation', phase: 'running', plan: null, startedAt: '2026-10-01T09:59:30.000Z' }),
      task({
        taskId: 'w',
        title: 'Waiting on a reset',
        phase: 'running',
        step: 'implement',
        waits: { agentId: 'codex', until: '2026-10-01T13:40:00.000Z' },
      }),
      task({
        taskId: 'q',
        title: 'Waiting for a free agent',
        phase: 'running',
        step: 'implement',
        queued: { busy: 4, atOnce: 4 },
      }),
      task({ taskId: 'f', title: 'No branch yet', phase: 'ready', branch: null }),
      task({
        taskId: 'g',
        title: 'Closed one',
        phase: 'settled',
        state: 'done',
        settledAt: '2026-10-01T09:00:00.000Z',
        change: change({ state: 'closed' }),
      }),
      task({ taskId: 'h', title: 'Done on its branch', phase: 'settled', state: 'done', settledAt: '2026-10-01T09:30:00.000Z' }),
      task({ taskId: 'i', title: 'Done nowhere', phase: 'settled', state: 'done', branch: null, settledAt: null }),
    ],
    calls: [stuck('implement', 'session_ended'), stuck('publish', 'failed_to_start'), stuck('publish', 'not_connected')],
  })

  it('never says "Invalid Date", or NaN, on any card, whatever time it has or lacks', () => {
    const lacking = board({
      tasks: [
        task({ taskId: 'n1', title: 'Stopped, no time known', phase: 'stopped', startedAt: null, stopped: { by: null, at: null } }),
        task({ taskId: 'n2', title: 'Stopped, an empty time', phase: 'stopped', startedAt: '', stopped: { by: 'althar', at: '' } }),
        task({ taskId: 'n3', title: 'Running, an empty start', phase: 'running', step: 'implement', startedAt: '' }),
        task({
          taskId: 'n4',
          title: 'Paused, an empty reset',
          phase: 'running',
          step: 'implement',
          waits: { agentId: 'codex', until: '' },
        }),
        task({ taskId: 'n5', title: 'Settled, an empty time', phase: 'settled', state: 'done', settledAt: '' }),
        task({ taskId: 'n6', title: 'Kept, an empty time', phase: 'kept', keptAt: '' }),
        task({ taskId: 'n7', title: 'Setting up', phase: 'running', step: 'implement', startedAt: 'not a time', settingUp: 'install' }),
      ],
      calls: [{ ...permission, id: 'c-empty', createdAt: '' }],
    })
    withServices(<BoardView lanes={lanesOf(lacking)} agents={agents} now={NOW} onOpen={vi.fn()} />, fakeClient().client)
    expect(screen.getByText('Stopped, no time known')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Invalid Date|NaN/)
  })

  it('says a task whose folder is being set up before its lead starts is under way, and why no step has begun', () => {
    const tasks = [
      task({ taskId: 's1', title: 'Installing', phase: 'running', step: 'implement', settingUp: 'install' }),
      task({ taskId: 's2', title: 'Its own setup', phase: 'running', step: 'implement', settingUp: 'kept' }),
    ]
    const lanes = lanesOf(board({ tasks, calls: [] }))
    expect(lanes.running.map((work) => work.taskId)).toEqual(['s1', 's2'])
    expect(lanes.stopped).toEqual([])
    withServices(<BoardView lanes={lanes} agents={agents} now={NOW} onOpen={vi.fn()} />, fakeClient().client)
    const running = within(screen.getByRole('region', { name: 'Running' }))
    const of = (title: string) => within(running.getByRole('button', { name: title }).closest('article') as HTMLElement)
    expect(of('Installing').getByText('Installing dependencies')).toBeTruthy()
    expect(of('Its own setup').getByText('Setting up')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Needs you' })?.textContent ?? '').not.toMatch(/Installing/)
  })

  it('draws plans waiting, stopped and planless work, stuck calls, and what settled', () => {
    const lanes = lanesOf(all)
    expect(lanes.next.map((work) => work.taskId)).toEqual(['b', 'c', 'a'])
    expect(lanes.settled.map((work) => work.taskId)).toEqual(['h', 'g', 'i'])
    const onOpen = vi.fn()
    withServices(<BoardView lanes={lanes} agents={agents} now={NOW} onOpen={onOpen} />, fakeClient().client)
    expect(screen.getByText('Held. Starts when you say')).toBeTruthy()
    expect(screen.getByText('Starting')).toBeTruthy()
    expect(screen.getByText('Starts in 20s')).toBeTruthy()
    // Stopped, it waits on the person: it says what stopped it and when, not how long it has run.
    expect(screen.getByText('Stopped when you declined a command')).toBeTruthy()
    expect(screen.getByText('2h ago')).toBeTruthy()
    expect(screen.queryByText('2h 30m')).toBeNull()
    expect(within(screen.getByRole('region', { name: 'Needs you' })).getByText('Stopped work')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Running' })).queryByText('Stopped work')).toBeNull()
    expect(screen.getByText('Conversation')).toBeTruthy()
    expect(
      screen.getByText(
        'Claude Code closed before finishing the step. This is usually harmless: try again, or hand the step to another agent.',
      ),
    ).toBeTruthy()
    // A step held for a usage limit says whom it waits for, and when they're back.
    expect(screen.getByText(`Codex is out of usage until ${clock('2026-10-01T13:40:00.000Z')}`)).toBeTruthy()
    // One waiting for a free agent says so, and what for.
    expect(screen.getByText('4 of 4 agents busy on this Mac')).toBeTruthy()
    expect(screen.getByText('Waiting')).toBeTruthy()
    expect(screen.getByText("Althar couldn't open the pull request. Try again, or go on without it.")).toBeTruthy()
    expect(screen.getByText(/isn't connected to this repository's host/)).toBeTruthy()
    expect(screen.getByText('PR #12 closed')).toBeTruthy()
    expect(screen.getAllByText('althar/add-a-retry').length).toBeGreaterThan(0)
    return userEvent.click(screen.getByRole('button', { name: 'Held plan' })).then(() => expect(onOpen).toHaveBeenCalledWith('th1'))
  })

  it('says a settled task’s pull request is open where its host says so, and closes it from its row', async () => {
    const pr = change({ state: 'open' })
    const settled = lanesOf(
      board({
        tasks: [
          task({
            taskId: 'x',
            title: 'Left open',
            phase: 'settled',
            state: 'abandoned',
            settledAt: '2026-10-01T09:00:00.000Z',
            change: pr,
          }),
        ],
      }),
    )
    const { client } = fakeClient()
    vi.mocked(client.closePullRequest).mockRejectedValueOnce(
      new ApiError({ reason: 'ConnectorFailed', message: 'GitHub won’t let this account do that.' }),
    )
    const Board = () => <BoardView lanes={settled} agents={agents} now={NOW} onOpen={vi.fn()} closing={useClosePullRequests()} />
    withServices(<Board />, client)
    // Abandoned, its pull request isn't said to be closed: GitHub last said it is open.
    expect(screen.getByText('PR #12 still open')).toBeTruthy()
    expect(screen.queryByText('PR #12 closed')).toBeNull()
    // Refused, the row says why, and still says it is open.
    await userEvent.click(screen.getByRole('button', { name: 'Close PR #12' }))
    expect((await screen.findByRole('alert')).textContent).toBe('GitHub won’t let this account do that.')
    expect(screen.getByText('PR #12 still open')).toBeTruthy()
    // Closed on the person's second press: only the pull request, its branch left as it is.
    await userEvent.click(screen.getByRole('button', { name: 'Close PR #12' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(client.closePullRequest).toHaveBeenLastCalledWith({ taskId: 'x', url: pr.url, deleteBranch: false })
  })

  it('offers no Close on a settled task’s row whose pull request is closed or merged', () => {
    const settled = lanesOf(
      board({
        tasks: [
          task({
            taskId: 'y',
            title: 'Closed',
            phase: 'settled',
            state: 'abandoned',
            settledAt: '2026-10-01T09:00:00.000Z',
            change: change({ state: 'closed' }),
          }),
          task({
            taskId: 'z',
            title: 'Merged',
            phase: 'settled',
            state: 'done',
            settledAt: '2026-10-01T09:10:00.000Z',
            change: change({ state: 'merged' }),
          }),
        ],
      }),
    )
    const closing = { busy: null, failed: null, close: vi.fn() }
    withServices(<BoardView lanes={settled} agents={agents} now={NOW} onOpen={vi.fn()} closing={closing} />, fakeClient().client)
    expect(screen.getByText('PR #12 closed')).toBeTruthy()
    expect(screen.getByText('PR #12 merged')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Close PR/ })).toBeNull()
  })

  describe('a task waiting for a free agent', () => {
    const waiting = { phase: 'running' as const, step: 'implement', queued: { busy: 4, atOnce: 4 }, startedAt: '2026-10-01T10:00:00.000Z' }
    const draw = (...tasks: BoardTask[]) =>
      withServices(
        <BoardView lanes={lanesOf(board({ tasks, calls: [] }))} agents={agents} now={NOW} onOpen={vi.fn()} />,
        fakeClient().client,
      )

    it('shows nothing of progress before its first step has had an agent, in Up next: no steps, branch or clock', () => {
      draw(task({ ...waiting, title: 'Not yet', branch: 'althar/not-yet', changed: { files: 0, add: 0, del: 0 }, inLine: true, place: 1 }))
      const next = screen.getByRole('region', { name: 'Up next' })
      expect(within(next).getByText('Not yet')).toBeTruthy()
      expect(within(next).getByText('Next in line')).toBeTruthy()
      expect(screen.queryByRole('list', { name: 'Steps' })).toBeNull()
      expect(screen.queryByText('althar/not-yet')).toBeNull()
      expect(screen.queryByText('0s')).toBeNull()
    })

    it('keeps the steps done so far and its real branch once work was done, with no step shown as under way', () => {
      draw(
        task({
          ...waiting,
          title: 'Midway',
          branch: 'althar/midway',
          changed: { files: 2, add: 14, del: 3 },
          step: 'review',
          startedAt: '2026-10-01T09:30:00.000Z',
        }),
      )
      expect(screen.getByText('4 of 4 agents busy on this Mac')).toBeTruthy()
      const track = screen.getByRole('list', { name: 'Steps' })
      expect(within(track).getByText('Implement').closest('li')?.className).toMatch(/done/)
      // The step it waits on isn't drawn as running: the kit's track stands still and empty for a waiting task.
      expect(track.getAttribute('data-status')).toBe('queued')
      expect(screen.getByText('althar/midway')).toBeTruthy()
      expect(screen.getByText('+14')).toBeTruthy()
      expect(screen.getByText('30m')).toBeTruthy()
    })

    it('shows no branch chip for an empty diff on a running or a ready card, and still one whose size is unknown', () => {
      draw(
        task({
          taskId: 'r',
          title: 'Running, nothing yet',
          phase: 'running',
          step: 'implement',
          branch: 'althar/running-empty',
          changed: { files: 0, add: 0, del: 0 },
        }),
        task({
          taskId: 'k',
          title: 'Ready, nothing changed',
          phase: 'ready',
          branch: 'althar/ready-empty',
          changed: { files: 0, add: 0, del: 0 },
        }),
        task({ taskId: 'u', title: 'Running, unknown', phase: 'running', step: 'implement', branch: 'althar/unknown-size', changed: null }),
      )
      expect(screen.queryByText('althar/running-empty')).toBeNull()
      expect(screen.queryByText('althar/ready-empty')).toBeNull()
      expect(screen.getByText('althar/unknown-size')).toBeTruthy()
    })
  })

  it('shows work its lead is resolving a conflict for at work, and what it couldn’t resolve as stuck, with why', () => {
    const why = 'The lead couldn’t resolve the conflict with main, in README.md. The merge of origin/main isn’t committed.'
    const lanes = lanesOf(
      board({
        tasks: [
          task({
            taskId: 'r1',
            threadId: 'thr1',
            title: 'Resolving it',
            phase: 'running',
            step: 'conflict',
            startedAt: '2026-10-01T09:30:00.000Z',
          }),
          task({
            taskId: 'r2',
            threadId: 'thr2',
            title: 'Fixing its checks',
            phase: 'running',
            step: 'checks',
            startedAt: '2026-10-01T09:30:00.000Z',
          }),
          task({ taskId: 'r3', threadId: 'thr3', title: 'Handed back', phase: 'ready', handedBack: why }),
          task({ taskId: 'r4', threadId: 'thr4', title: 'Ready as ever', phase: 'ready' }),
        ],
        calls: [],
      }),
    )
    withServices(<BoardView lanes={lanes} agents={agents} now={NOW} onOpen={vi.fn()} />, fakeClient().client)
    // At work, on the board's running lane, saying what it does where the step count would be.
    expect(screen.getByText('Resolving a conflict')).toBeTruthy()
    expect(screen.getByText('Fixing the checks')).toBeTruthy()
    // Handed back, it is a merge conflict, its reason warm at its foot; the other is ready to accept, as ever.
    expect(screen.getByText('Merge conflict')).toBeTruthy()
    expect(screen.getByText(why)).toBeTruthy()
    expect(screen.getAllByText('Ready to accept')).toHaveLength(1)
  })

  it('says how long work has run', () => {
    expect(running('2026-10-01T09:59:30.000Z', NOW)).toBe('30s')
    expect(running('2026-10-01T09:54:00.000Z', NOW)).toBe('6m')
    expect(running('2026-10-01T07:56:00.000Z', NOW)).toBe('2h 4m')
    expect(running('2026-09-25T06:56:00.000Z', NOW)).toBe('6d 3h')
  })

  it('holds a stuck call, waiting plans, settled work, and says why an answer didn’t go through', async () => {
    const answerStuck = vi.fn(async () => {})
    const { client } = fakeClient({
      answerStuck,
      getBoard: vi.fn(async () => all),
      send: vi.fn(async () => Promise.reject(new ApiError({ reason: 'NoSession', message: 'Nobody to tell.' }))),
    })
    const Dock = ({ target }: { target: Parameters<typeof DockView>[0]['target'] }) => {
      const model = useBoard('p1')
      return (
        <>
          <DockView
            target={target}
            model={model}
            agents={agents}
            project="meridian"
            now={NOW}
            onClose={vi.fn()}
            onTask={vi.fn()}
            onChanges={vi.fn()}
          />
          <button type="button" onClick={() => void model.sendBack(all.tasks[5] as BoardTask, 'Again.')}>
            send
          </button>
          <p>{model.error}</p>
        </>
      )
    }
    const view = withServices(<Dock target={{ kind: 'call', id: 's-implement-session_ended' }} />, client)
    const dock = await screen.findByRole('complementary', { name: 'Beside the board' })
    await userEvent.click(within(dock).getByRole('button', { name: /^Abandon/ }))
    await waitFor(() => expect(answerStuck).toHaveBeenCalledWith({ attentionId: 's-implement-session_ended', answer: { kind: 'abandon' } }))
    // A note that can't be sent says why.
    await userEvent.click(screen.getByRole('button', { name: 'send' }))
    expect(await screen.findByText('Nobody to tell.')).toBeTruthy()
    view.unmount()
    for (const [id, words] of [
      ['a', 'Held. Starts when you say'],
      ['c', 'Starts in 20s'],
      ['d', 'Stopped'],
      ['g', 'Settled'],
      ['f', 'Review the changes'],
    ] as const) {
      const shown = withServices(<Dock target={{ kind: 'task', id }} />, client)
      expect((await screen.findAllByText(words)).length).toBeGreaterThan(0)
      shown.unmount()
    }
    // Something the board no longer has: nothing in the dock.
    const gone = withServices(<Dock target={{ kind: 'task', id: 'gone' }} />, client)
    await waitFor(() => expect(client.getBoard).toHaveBeenCalled())
    expect(screen.queryByRole('complementary', { name: 'Beside the board' })).toBeNull()
    gone.unmount()
  })

  it('waits for checks still running before it can be accepted', async () => {
    const runningChecks = change({
      draft: false,
      checks: {
        outcome: 'running',
        passed: 0,
        failed: 0,
        running: 2,
        total: 2,
        failing: [],
        list: [
          { name: 'test', state: 'queued', summary: null },
          { name: 'lint', state: 'running', summary: null },
          { name: 'docs', state: 'skipped', summary: null },
        ],
      },
    })
    const { client } = fakeClient({
      getBoard: vi.fn(async () => board({ tasks: [task({ taskId: 't9', phase: 'ready', change: runningChecks })], calls: [] })),
    })
    withServices(<Docked target={{ kind: 'task', id: 't9' }} />, client)
    expect(await screen.findByText('It can be accepted once its checks pass')).toBeTruthy()
  })
})

describe('each kind’s card', () => {
  const NOW = '2026-10-01T10:00:00.000Z'
  const reviewing = {
    product: 'github' as const,
    repository: 'meridian/api',
    number: 1199,
    url: 'https://github.com/meridian/api/pull/1199',
    title: 'Send back won’t restart a dead lead session',
    author: 'ninemate',
    outside: true,
    additions: 58,
    deletions: 20,
    findings: 3,
    blocking: 1,
    verdict: 'changes' as const,
    posted: null,
  }
  const passed = (n: number) => ({ outcome: 'passed' as const, passed: n, failed: 0, running: 0, total: n, failing: [], list: [] })
  const kinds = board({
    tasks: [
      task({ taskId: 'k1', title: 'On its branch', phase: 'running', step: 'implement', changed: { files: 2, add: 84, del: 6 } }),
      task({
        taskId: 'k2',
        title: 'With its pull request',
        phase: 'running',
        step: 'implement',
        followUp: true,
        change: change({ checks: { ...passed(8), passed: 6, running: 2, outcome: 'running' } }),
      }),
      task({ taskId: 'k3', title: 'Just looking', phase: 'running', kind: 'plain', plan: null, branch: null }),
      task({
        taskId: 'k4',
        title: 'Review #1202',
        phase: 'running',
        kind: 'review',
        reviewing: { ...reviewing, number: 1202, findings: 1 },
      }),
      task({ taskId: 'k5', title: 'Ready with checks', phase: 'ready', change: change({ checks: passed(8) }) }),
      task({ taskId: 'k6', title: 'Checks failed', phase: 'ready', change: change() }),
      task({ taskId: 'k7', title: 'Unchecked', phase: 'ready', change: change({ checks: null }) }),
      task({ taskId: 'k8', title: 'Review #1199', phase: 'ready', kind: 'review', reviewing }),
      task({
        taskId: 'k9',
        title: 'Prototype the empty state',
        phase: 'ready',
        kind: 'plain',
        handed: {
          pictures: [
            { digest: 'a'.repeat(64), mediaType: 'image/png', bytes: 9, width: 4, height: 3, name: 'one.png', unkept: null },
            { digest: null, mediaType: 'image/png', bytes: 9, width: null, height: null, name: 'big.png', unkept: 'too_large' },
            { digest: 'b'.repeat(64), mediaType: 'image/png', bytes: 9, width: 4, height: 3, name: null, unkept: null },
          ],
          files: [{ path: '/tmp/notes.md', add: null }],
        },
      }),
      task({
        taskId: 'k10',
        title: 'Draft the notes',
        phase: 'ready',
        kind: 'plain',
        handed: { pictures: [], files: [{ path: 'docs/releases/notes-0.4.md', add: 64 }] },
      }),
      task({ taskId: 'k11', title: 'Which partners call v1?', phase: 'ready', kind: 'plain', branch: null }),
      task({
        taskId: 'k19',
        title: 'Sketch the settings',
        phase: 'ready',
        kind: 'plain',
        branch: 'althar/sketch-the-settings',
        changed: { files: 1, add: 31, del: 0 },
      }),
      task({ taskId: 'k12', title: 'Asked a question', threadId: 'thk12', phase: 'waiting', kind: 'plain' }),
      task({ taskId: 'k13', title: 'Gave up', threadId: 'thk13', phase: 'waiting' }),
      task({ taskId: 'k14', title: 'Settled plainly', phase: 'settled', state: 'done', kind: 'plain', settledAt: NOW }),
      task({ taskId: 'k15', title: 'Up next, a change', phase: 'held', plan: { ...card().plan!, startsAt: null } }),
      task({
        taskId: 'k16',
        title: 'Merged, then more',
        phase: 'ready',
        change: change({ state: 'merged' }),
        unshipped: { commits: 2, add: 395, del: 383 },
      }),
      task({
        taskId: 'k17',
        title: 'Two repositories',
        phase: 'ready',
        change: change({ checks: passed(2) }),
        unshipped: { commits: 1, add: 7, del: 1 },
      }),
      task({ taskId: 'k18', title: 'Review, read', phase: 'ready', kind: 'review' }),
    ],
    calls: [
      { ...permission, id: 'c1', kind: 'question', title: 'Which database?', command: null, taskId: 'k12', threadId: 'thk12' },
      {
        ...permission,
        id: 'c2',
        kind: 'stuck',
        title: '',
        command: null,
        taskId: 'k13',
        threadId: 'thk13',
        stuck: { step: 'implement', why: 'session_ended', detail: null, agentId: 'claude-code', round: 0, open: 0 },
      },
    ],
  })
  const cardOf = (title: string) => screen.getByRole('button', { name: title }).closest('article') as HTMLElement

  it('says where each stands in a word, its kind’s word, and at most one card in the card and one fact', () => {
    withServices(<BoardView lanes={lanesOf(kinds)} agents={agents} now={NOW} onOpen={vi.fn()} />, fakeClient().client)
    // A change at work: its step, its kind, its track, its branch with how big it is so far.
    const branch = within(cardOf('On its branch'))
    expect(branch.getAllByText('Implement')).toHaveLength(2)
    expect(branch.getByText('Change')).toBeTruthy()
    expect(branch.getByText('althar/add-a-retry')).toBeTruthy()
    expect(branch.getByText('+84')).toBeTruthy()
    // With its pull request open: the pull request, and its checks so far.
    const pr = within(cardOf('With its pull request'))
    expect(pr.getAllByText('Follow-up')).toHaveLength(2)
    expect(pr.getByText('#12')).toBeTruthy()
    expect(pr.getByText('6 of 8 checks passed')).toBeTruthy()
    // A plain task at work says only that it works.
    const plain = within(cardOf('Just looking'))
    expect(plain.getByText('Working')).toBeTruthy()
    expect(plain.queryByText('Change')).toBeNull()
    expect(plain.queryByRole('list', { name: 'Steps' })).toBeNull()
    // A review reads someone else's pull request: its number, whose, and what it found so far.
    const reading = within(cardOf('Review #1202'))
    expect(reading.getByText('Reading')).toBeTruthy()
    expect(reading.getByText('Review')).toBeTruthy()
    expect(reading.getByText('ninemate')).toBeTruthy()
    expect(reading.getByText('1 finding so far')).toBeTruthy()
    // Ready to accept: how its checks went, or which failed, and the next thing to do. A draft isn't in the way: accepting marks it ready.
    expect(within(cardOf('Ready with checks')).getByText('All 8 checks passed')).toBeTruthy()
    expect(within(cardOf('Ready with checks')).getByText('Accept and merge')).toBeTruthy()
    expect(within(cardOf('Checks failed')).getByText('test failed')).toBeTruthy()
    expect(within(cardOf('Checks failed')).getByText('Ask the lead to fix it')).toBeTruthy()
    expect(within(cardOf('Unchecked')).getByText('No checks ran')).toBeTruthy()
    // A review drafted: its findings, louder, then what they come to.
    const drafted = within(cardOf('Review #1199'))
    expect(drafted.getByText('Review drafted')).toBeTruthy()
    expect(drafted.getByText('3 findings')).toBeTruthy()
    expect(drafted.getByText('1 blocking · request changes')).toBeTruthy()
    // A plain task that finished: its pictures, small, drawn from the store; or else its files.
    const pictures = within(cardOf('Prototype the empty state'))
    expect(pictures.getByText('Finished')).toBeTruthy()
    // One that wasn't kept isn't drawn; one with no name is called as the thread calls it.
    expect(pictures.getAllByRole('img').map((img) => [img.getAttribute('src'), img.getAttribute('alt')])).toEqual([
      [pictureUrl('a'.repeat(64), true), 'one.png'],
      [pictureUrl('b'.repeat(64), true), 'Image 3'],
    ])
    expect(pictures.queryByText('notes.md')).toBeNull()
    const files = within(cardOf('Draft the notes'))
    expect(files.getByText('notes-0.4.md')).toBeTruthy()
    expect(files.getByText('+64')).toBeTruthy()
    expect(within(cardOf('Which partners call v1?')).getByText('Finished')).toBeTruthy()
    // One that handed nothing back but wrote in the repository: its branch, which stays on this Mac, and how big it is.
    const sketched = within(cardOf('Sketch the settings'))
    expect(sketched.getByText('Finished')).toBeTruthy()
    expect(sketched.getByText('althar/sketch-the-settings')).toBeTruthy()
    expect(sketched.getByText('+31')).toBeTruthy()
    expect(sketched.queryByText('Change')).toBeNull()
    // Waiting on a call: the call's kind, and why.
    const question = within(cardOf('Asked a question'))
    expect(question.getByText('Question')).toBeTruthy()
    expect(question.getByText('Which database?')).toBeTruthy()
    const stuck = within(cardOf('Gave up'))
    expect(stuck.getByText('Stuck')).toBeTruthy()
    expect(
      stuck.getByText(
        'Claude Code closed before finishing the step. This is usually harmless: try again, or hand the step to another agent.',
      ),
    ).toBeTruthy()
    // Merged, with commits after it: its branch, with what is in no pull request yet.
    const after = within(cardOf('Merged, then more'))
    expect(after.getByText('Ready for a new pull request')).toBeTruthy()
    expect(after.getByText('+395')).toBeTruthy()
    expect(after.queryByText('#12')).toBeNull()
    // One repository's pull request open, another's commits in none: both.
    const two = within(cardOf('Two repositories'))
    expect(two.getByText('Ready to accept')).toBeTruthy()
    expect(two.getByText('#12')).toBeTruthy()
    expect(two.getByText('+7')).toBeTruthy()
    // A review whose pull request isn't read yet says only where it stands.
    expect(within(cardOf('Review, read')).getByText('Review drafted')).toBeTruthy()
    // Nothing on any card is pressed but the card itself.
    for (const article of screen.getAllByRole('article')) expect(within(article).getAllByRole('button')).toHaveLength(1)
    // Rows say their kind's word, and a plain task's none.
    const settled = screen.getByRole('button', { name: 'Settled plainly' }).closest('li') as HTMLElement
    expect(within(settled).queryByText('Change')).toBeNull()
    expect(within(settled).getByText('Done')).toBeTruthy()
    // Its branch, where it has one, as any task's.
    expect(within(settled).getByText('althar/add-a-retry')).toBeTruthy()
    const next = screen.getByRole('button', { name: 'Up next, a change' }).closest('li') as HTMLElement
    expect(within(next).getByText('Change')).toBeTruthy()
  })
})

describe('what stands between a ready change and merging', () => {
  const NOW = '2026-10-01T10:00:00.000Z'
  const passed = { outcome: 'passed' as const, passed: 5, failed: 0, running: 0, total: 5, failing: [], list: [] }
  /** Checks named check 1, check 2… each in the state given. */
  const listOf = (...states: ReadonlyArray<'passed' | 'skipped' | 'cancelled'>) =>
    states.map((state, i) => ({ name: `check ${i + 1}`, state, summary: null }))
  const ready = (taskId: string, title: string, overrides: Parameters<typeof change>[0]) =>
    task({ taskId, title, phase: 'ready', change: change({ draft: false, checks: passed, ...overrides }) })
  const lanes = lanesOf(
    board({
      tasks: [
        ready('s1', 'Good to merge', {}),
        ready('s2', 'Still a draft', { draft: true }),
        ready('s3', 'Checks still running', { checks: { ...passed, outcome: 'running', passed: 3, running: 2 } }),
        ready('s4', 'In conflict', { conflicts: true, target: 'main' }),
        ready('s5', 'Commits to push', { localHead: 'def456', unpushed: 3 }),
        // Commits here and a check that failed on what is pushed: the failure is read first, the push is offered first, as it runs the checks again.
        // Commits beside a conflict: pushing them is what clears it.
        ready('s11', 'Push clears it', { localHead: 'def456', unpushed: 5, conflicts: true, target: 'main', checks: passed }),
        ready('s6', 'Two at once', { localHead: 'def456', unpushed: 2, checks: change().checks }),
        // Commits counted before the branch's head here is known aren't said.
        ready('s7', 'Head not read yet', { unpushed: 2 }),
        // Done, but one was cancelled: not all passed, and a host holds the merge on it.
        ready('s8', 'A check cancelled', {
          checks: { ...passed, passed: 3, list: listOf('passed', 'passed', 'passed', 'cancelled', 'skipped') },
        }),
        // One skipped: not every one passed, but nothing is in the way.
        ready('s9', 'A check skipped', {
          checks: { ...passed, passed: 4, list: listOf('passed', 'passed', 'passed', 'passed', 'skipped') },
        }),
        // Closed after it was ready: nothing is in its way, and nothing to do to it.
        ready('s10', 'Closed since', { state: 'closed' }),
      ],
      calls: [],
    }),
  )
  const cardOf = (title: string) => screen.getByRole('button', { name: title }).closest('article') as HTMLElement

  it('says it in one line, the most pressing first, with the one next thing to do at its end', () => {
    withServices(<BoardView lanes={lanes} agents={agents} now={NOW} onOpen={vi.fn()} />, fakeClient().client)
    const said = (title: string) => cardOf(title).textContent ?? ''
    expect(said('Good to merge')).toMatch(/All 5 checks passed\s*Accept and merge/)
    expect(said('Still a draft')).toMatch(/All 5 checks passed\s*Accept and merge/)
    // Checks running: nothing to do but wait.
    expect(said('Checks still running')).toContain('Checks running, 3 of 5 passed')
    expect(within(cardOf('Checks still running')).queryByText(/Accept and merge|Push/)).toBeNull()
    expect(said('In conflict')).toMatch(/Conflicts with main\s*Ask the lead to resolve it/)
    // A conflict or a failed check in the way: not ready to accept.
    expect(said('In conflict')).toContain('Not ready to accept')
    expect(said('Two at once')).toContain('Not ready to accept')
    expect(said('Commits to push')).toContain('Ready to accept')
    expect(said('Push clears it')).toContain('Ready once pushed')
    expect(said('Push clears it')).toContain('The push should resolve the conflict with main')
    expect(said('Commits to push')).toMatch(/checks passed\s*Push 3 commits/)
    expect(said('Two at once')).toMatch(/test failed\s*Push 2 commits/)
    expect(said('Head not read yet')).toMatch(/All 5 checks passed\s*Accept and merge/)
    // Cancelled: said in place of a pass, and nothing to do from here but open the task.
    expect(said('A check cancelled')).toContain('check 4 cancelled')
    expect(said('A check cancelled')).not.toMatch(/checks passed|Accept and merge/)
    expect(said('A check skipped')).toMatch(/4 of 5 checks passed\s*Accept and merge/)
    expect(said('Closed since')).not.toMatch(/checks passed|Accept and merge/)
  })
})

describe('a ready card’s next step, done from the card', () => {
  const NOW = '2026-10-01T10:00:00.000Z'
  const passed = { outcome: 'passed' as const, passed: 5, failed: 0, running: 0, total: 5, failing: [], list: [] }
  const ready = (taskId: string, title: string, overrides: Parameters<typeof change>[0]) =>
    task({ taskId, threadId: `th-${taskId}`, title, phase: 'ready', change: change({ draft: false, checks: passed, ...overrides }) })
  /** The board as the runtime reads it; a test changes it, then says so on the feed. */
  let tasks: ReturnType<typeof task>[] = []
  const pending = (taskId: string) => ({ localHead: 'def456', unpushed: taskId === 's5' ? 3 : 2 })
  beforeEach(() => {
    tasks = [
      ready('s1', 'Good to merge', {}),
      ready('s4', 'In conflict', { conflicts: true, target: 'main' }),
      ready('s5', 'Commits to push', pending('s5')),
      ready('s6', 'More commits to push', pending('s6')),
      ready('s11', 'Checks failed', { checks: change().checks }),
    ]
  })
  const getBoard = () => vi.fn(async () => board({ tasks, calls: [] }))
  /** The board's own model feeds its lanes, as the project's view does, so what the runtime reports next shows. */
  function Board({ onOpen }: { onOpen: (threadId: string) => void }) {
    const model = useBoard('p1')
    return (
      <BoardView
        lanes={lanesOf(model.board ?? board({ tasks: [], calls: [] }))}
        agents={agents}
        now={NOW}
        onOpen={onOpen}
        actions={model}
      />
    )
  }
  const cardOf = async (title: string) => within((await screen.findByRole('button', { name: title })).closest('article') as HTMLElement)

  it('carries a stopped task on from the card: tells its lead to continue, and starts it again', async () => {
    tasks = [
      task({
        taskId: 'sd',
        threadId: 'th-sd',
        title: 'Stopped d',
        phase: 'stopped',
        stopped: { by: 'declined', at: '2026-09-30T14:00:00.000Z' },
      }),
    ]
    const send = vi.fn(async () => {})
    const startSession = vi.fn(async () => 's1')
    const base = snapshot()
    const getThread = vi.fn(async () =>
      snapshot({ session: null, task: { ...base.task, lead: { agentId: 'claude-code', model: null, account: null } } }),
    )
    const onOpen = vi.fn()
    withServices(<Board onOpen={onOpen} />, fakeClient({ send, startSession, getThread, getBoard: getBoard() }).client)
    const card = await cardOf('Stopped d')
    await userEvent.click(card.getByRole('button', { name: 'Carry on' }))
    await waitFor(() => expect(send).toHaveBeenCalledWith({ threadId: 'th-sd', body: 'Carry on.', disposition: 'after_current' }))
    await waitFor(() => expect(startSession).toHaveBeenCalledWith({ threadId: 'th-sd', agentId: 'claude-code' }))
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('pushes right there, and does not open the task', async () => {
    const onOpen = vi.fn()
    let finish = () => {}
    const push = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    withServices(<Board onOpen={onOpen} />, fakeClient({ push, getBoard: getBoard() }).client)
    const card = await cardOf('Commits to push')
    // A button of its own, named for what it does and to which pull request.
    await userEvent.click(card.getByRole('button', { name: 'Push 3 commits to #12' }))
    expect(push).toHaveBeenCalledWith('s5', 'def456', 'https://github.com/meridian/api/pull/12')
    expect(onOpen).not.toHaveBeenCalled()
    // While it runs, it says so, and presses are ignored.
    const busy = await card.findByRole('button', { name: 'Push 3 commits to #12' })
    expect(busy.getAttribute('aria-busy')).toBe('true')
    expect(busy.textContent).toBe('Pushing 3 commits')
    await userEvent.click(busy)
    expect(push).toHaveBeenCalledTimes(1)
    finish()
    await waitFor(() => expect(card.getByRole('button', { name: 'Push 3 commits to #12' }).getAttribute('aria-busy')).toBeNull())
    expect(onOpen).not.toHaveBeenCalled()
    // The rest of the card still opens its task.
    await userEvent.click(screen.getByRole('button', { name: 'Commits to push' }))
    expect(onOpen).toHaveBeenCalledWith('th-s5')
  })

  it('updates the card by itself once the runtime reports the push: the unpushed line goes, the next thing is to merge', async () => {
    const { client, emit } = fakeClient({
      push: vi.fn(async () => {
        // The commits are on the pull request, which now stands at a new head with new numbers.
        tasks = tasks.map((one) =>
          one.taskId === 's5'
            ? ready('s5', 'Commits to push', { localHead: 'def456', head: 'def456', unpushed: 0, additions: 20, deletions: 5 })
            : one,
        )
        emit(changed('task', 's5'))
      }),
      getBoard: getBoard(),
    })
    withServices(<Board onOpen={vi.fn()} />, client)
    const card = await cardOf('Commits to push')
    expect(card.getByRole('button', { name: 'Push 3 commits to #12' })).toBeTruthy()
    await userEvent.click(card.getByRole('button', { name: 'Push 3 commits to #12' }))
    await waitFor(() => expect(card.queryByRole('button', { name: /^Push/ })).toBeNull())
    expect(card.getByText(/\+20/)).toBeTruthy()
    // It was pushed and nothing is left to push: what is next is to merge, at the new head.
    expect(card.queryByRole('button', { name: /^Push/ })).toBeNull()
    expect(card.getByRole('button', { name: 'Accept and merge #12' })).toBeTruthy()
    // The other card's commits are still to push.
    expect((await cardOf('More commits to push')).getByRole('button', { name: 'Push 2 commits to #12' })).toBeTruthy()
  })

  it('keeps each card’s own state when two push at once: one finishing does not free the other', async () => {
    const finish: Record<string, () => void> = {}
    const push = vi.fn((taskId: string) => new Promise<void>((resolve) => (finish[taskId] = resolve)))
    withServices(<Board onOpen={vi.fn()} />, fakeClient({ push, getBoard: getBoard() }).client)
    const a = await cardOf('Commits to push')
    const b = await cardOf('More commits to push')
    await userEvent.click(a.getByRole('button', { name: 'Push 3 commits to #12' }))
    await userEvent.click(b.getByRole('button', { name: 'Push 2 commits to #12' }))
    expect(a.getByRole('button', { name: 'Push 3 commits to #12' }).getAttribute('aria-busy')).toBe('true')
    expect(b.getByRole('button', { name: 'Push 2 commits to #12' }).getAttribute('aria-busy')).toBe('true')
    // B finishes first; A is still pushing, and a press on it is still ignored.
    finish['s6']?.()
    await waitFor(() => expect(b.getByRole('button', { name: 'Push 2 commits to #12' }).getAttribute('aria-busy')).toBeNull())
    expect(a.getByRole('button', { name: 'Push 3 commits to #12' }).getAttribute('aria-busy')).toBe('true')
    await userEvent.click(a.getByRole('button', { name: 'Push 3 commits to #12' }))
    expect(push).toHaveBeenCalledTimes(2)
    finish['s5']?.()
    await waitFor(() => expect(a.getByRole('button', { name: 'Push 3 commits to #12' }).getAttribute('aria-busy')).toBeNull())
  })

  it('says why a push failed, in a line, and offers to try again; another card’s push does not clear it', async () => {
    const onOpen = vi.fn()
    const push = vi.fn(async (taskId: string) => {
      if (taskId === 's5') throw new ApiError({ reason: 'ConnectorFailed', message: 'GitHub says: the branch is protected' })
    })
    withServices(<Board onOpen={onOpen} />, fakeClient({ push, getBoard: getBoard() }).client)
    const card = await cardOf('Commits to push')
    await userEvent.click(card.getByRole('button', { name: 'Push 3 commits to #12' }))
    expect((await card.findByRole('alert')).textContent).toContain('Push failed: GitHub says: the branch is protected')
    // The commits are still not on it, and the button now tries again.
    expect(card.getByRole('button', { name: 'Try pushing 3 commits to #12 again' })).toBeTruthy()
    // Another card pushes, and goes through: the first still says why it failed.
    await userEvent.click((await cardOf('More commits to push')).getByRole('button', { name: 'Push 2 commits to #12' }))
    await waitFor(() => expect(push).toHaveBeenCalledTimes(2))
    expect(card.getByRole('alert').textContent).toContain('Push failed')
    push.mockResolvedValue(undefined)
    await userEvent.click(card.getByRole('button', { name: 'Try pushing 3 commits to #12 again' }))
    await waitFor(() => expect(push).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(card.queryByRole('alert')).toBeNull())
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('merges right there, at the head the card showed', async () => {
    const onOpen = vi.fn()
    const merge = vi.fn(async () => {})
    withServices(<Board onOpen={onOpen} />, fakeClient({ merge, getBoard: getBoard() }).client)
    await userEvent.click((await cardOf('Good to merge')).getByRole('button', { name: 'Accept and merge #12' }))
    expect(merge).toHaveBeenCalledWith('s1', 'abc123', 'https://github.com/meridian/api/pull/12')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('leaves what needs the lead to the task: words that open it, not a button of their own', async () => {
    const onOpen = vi.fn()
    withServices(<Board onOpen={onOpen} />, fakeClient({ getBoard: getBoard() }).client)
    for (const title of ['In conflict', 'Checks failed']) expect((await cardOf(title)).getAllByRole('button')).toHaveLength(1)
    expect((await cardOf('In conflict')).getByText('Ask the lead to resolve it')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'In conflict' }))
    expect(onOpen).toHaveBeenCalledWith('th-s4')
  })

  it('shows a stopped task in conflict as stopped: what stopped it and when, the conflict a line under it, and Carry on settles both', async () => {
    // An automation's run Althar stopped two days ago, out of its minutes: on its branch, no pull request, and a conflict Althar
    // didn't ask its lead about, as it is stopped.
    tasks = [
      task({
        taskId: 's9',
        threadId: 'th-s9',
        title: 'Nightly dependency check, 27 Oct',
        kind: 'change',
        phase: 'stopped',
        step: null,
        branch: 'althar/nightly-dependency-check-27-oct',
        changed: { files: 3, add: 287, del: 375 },
        startedAt: '2026-09-29T08:00:00.000Z',
        stopped: { by: 'althar', at: '2026-09-29T09:00:00.000Z' },
        conflictUnsent: 'It’s stopped, so Althar doesn’t start its lead for a conflict.',
        automation: { id: 'au1', name: 'Nightly dependency check' },
      }),
    ]
    const send = vi.fn(async () => {})
    const resumeTask = vi.fn(async () => {})
    const startSession = vi.fn(async () => 's1')
    const resolveConflictsNow = vi.fn(async () => {})
    const base = snapshot()
    // Its run suspended, the task's own screen would resume it.
    const getThread = vi.fn(async () =>
      snapshot({
        session: null,
        task: { ...base.task, actions: ['resume', 'abandon'], lead: { agentId: 'claude-code', model: null, account: null } },
      }),
    )
    const onOpen = vi.fn()
    withServices(
      <Board onOpen={onOpen} />,
      fakeClient({ send, resumeTask, startSession, getThread, resolveConflictsNow, getBoard: getBoard() }).client,
    )
    const card = await cardOf('Nightly dependency check, 27 Oct')
    // In Needs you, stopped, with what stopped it and when; never under way, with a step and a running clock.
    const yours = within(screen.getByRole('region', { name: 'Needs you' }))
    expect(yours.getByText('Nightly dependency check, 27 Oct')).toBeTruthy()
    expect(card.getByText('Stopped')).toBeTruthy()
    expect(card.getByText('Stopped by Althar')).toBeTruthy()
    expect(card.getByText('Sep 29')).toBeTruthy()
    expect(card.queryByText(/^\d+d \d+h$/)).toBeNull()
    // The conflict is one quiet line, not why it waits, and not that the person stopped it.
    expect(card.getByText('Conflicts with the default branch')).toBeTruthy()
    expect(card.queryByText(/stopped, so Althar/)).toBeNull()
    expect(card.queryByRole('button', { name: 'Resolve now' })).toBeNull()
    // One action covers both: the lead is told to merge the default branch in, then go on, and its run carries on.
    await userEvent.click(card.getByRole('button', { name: 'Carry on' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        threadId: 'th-s9',
        body: 'Carry on. Your branch conflicts with the default branch: merge it in and settle the conflict first.',
        disposition: 'after_current',
      }),
    )
    await waitFor(() => expect(resumeTask).toHaveBeenCalledWith({ taskId: 's9' }))
    expect(startSession).not.toHaveBeenCalled()
    expect(resolveConflictsNow).not.toHaveBeenCalled()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('offers Resolve now where the lead couldn’t resolve a conflict, though neither branch moved', async () => {
    const why = 'The lead couldn’t resolve the conflict with main. change.txt still conflicts.'
    tasks = [{ ...ready('s10', 'Handed back', { conflicts: true, target: 'main' }), handedBack: why }]
    const resolveConflictsNow = vi.fn(async () => {})
    withServices(<Board onOpen={vi.fn()} />, fakeClient({ resolveConflictsNow, getBoard: getBoard() }).client)
    const card = await cardOf('Handed back')
    expect(card.getByText('Merge conflict')).toBeTruthy()
    expect(card.getByText(why)).toBeTruthy()
    await userEvent.click(card.getByRole('button', { name: 'Resolve now' }))
    expect(resolveConflictsNow).toHaveBeenCalledWith('s10')
  })

  it('shows only what fails where its lead brought its failing checks to the person', async () => {
    const why = 'Fails on main too: test times out in limit.test.ts. Fixing it on main brings this one green.'
    tasks = [{ ...ready('s13', 'Broken on main', { checks: change().checks }), checksBack: why }]
    withServices(<Board onOpen={vi.fn()} />, fakeClient({ getBoard: getBoard() }).client)
    const card = await cardOf('Broken on main')
    // One fact, with its glyph: the lead's line is in its task, not on the card.
    expect(card.queryByText(why)).toBeNull()
    const failed = card.getByText(/ failed$/)
    expect(failed.closest('[class*="factLine"]')?.textContent).toBe(failed.textContent)
    expect(failed.querySelector('svg')).not.toBeNull()
    // Not a conflict: nothing offers to resolve one; nor to ask the lead to fix what it said isn't the change's.
    expect(card.queryByText('Ask the lead to fix it')).toBeNull()
    expect(card.queryByText('Merge conflict')).toBeNull()
    expect(card.queryByRole('button', { name: 'Resolve now' })).toBeNull()
  })

  it('says where Althar couldn’t look for a conflict, and keeps its next step', async () => {
    const why = 'Its folder isn’t on this computer, so Althar can’t merge main into it here.'
    tasks = [{ ...ready('s12', 'Not looked at', {}), conflictUnchecked: why }]
    withServices(<Board onOpen={vi.fn()} />, fakeClient({ getBoard: getBoard() }).client)
    const card = await cardOf('Not looked at')
    expect(card.getByText(why)).toBeTruthy()
    // Not said to conflict: Althar doesn't know.
    expect(card.queryByText('Merge conflict')).toBeNull()
    expect(card.getByRole('button', { name: 'Accept and merge #12' })).toBeTruthy()
  })
})

describe('the bar and the dock, on the rest of the board', () => {
  it('opens work ready to accept when no call waits', async () => {
    const onTask = vi.fn()
    const bare = change({ draft: false, additions: null, deletions: null, checks: null })
    const { client } = fakeClient({
      getBoard: vi.fn(async () => board({ tasks: [task({ taskId: 't9', threadId: 'th9', phase: 'ready', change: bare })], calls: [] })),
    })
    withServices(<Project onTask={onTask} />, client)
    await userEvent.click(await screen.findByRole('radio', { name: 'Board' }))
    const work = await screen.findByRole('region', { name: 'The project’s work' })
    // A pull request its host said nothing about: no sizes, and no checks.
    expect(within(work).getByText('No checks ran')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '1 needs you' }))
    expect(onTask).toHaveBeenCalledWith('th9')
  })

  it('shows running and waiting work in the dock, each as it stands', async () => {
    const { client } = fakeClient({
      getBoard: vi.fn(async () =>
        board({
          tasks: [
            task({ taskId: 'r', title: 'Running work', phase: 'running', step: 'implement', summary: 'Halfway.' }),
            task({ taskId: 'w', title: 'Waiting work', phase: 'waiting', step: 'review' }),
          ],
          calls: [],
        }),
      ),
    })
    const running = withServices(<Docked target={{ kind: 'task', id: 'r' }} />, client)
    expect(await within(await screen.findByRole('complementary', { name: 'Beside the board' })).findByText('Halfway.')).toBeTruthy()
    running.unmount()
    withServices(<Docked target={{ kind: 'task', id: 'w' }} />, client)
    const dock = await screen.findByRole('complementary', { name: 'Beside the board' })
    expect(await within(dock).findByText('Waiting work', { selector: 'h2' })).toBeTruthy()
  })
})

describe('collapsing lanes', () => {
  beforeEach(() => window.localStorage.removeItem('althar.lanes'))

  const theBoard = async () => {
    const { client } = fakeClient({ getBoard: vi.fn(async () => board()) })
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('radio', { name: 'Board' }))
    return screen.findByRole('region', { name: 'The project’s work' })
  }

  it('keeps a lane the person collapsed, for every project, and apart beside the conversation', async () => {
    const work = await theBoard()
    await userEvent.click(within(work).getByRole('button', { name: 'Collapse Settled' }))
    expect(document.activeElement).toBe(within(work).getByRole('button', { name: 'Expand Settled, 2' }))
    expect(JSON.parse(window.localStorage.getItem('althar.lanes') ?? 'null')).toEqual({
      alone: { collapsed: ['settled'], opened: [] },
      beside: { collapsed: [], opened: [] },
    })
    // Beside the conversation, the board keeps its own.
    await userEvent.click(screen.getByRole('radio', { name: 'Home' }))
    const beside = await screen.findByRole('region', { name: 'The project’s work' })
    expect(within(beside).getByRole('button', { name: 'Collapse Settled' })).toBeTruthy()
    await userEvent.click(screen.getByRole('radio', { name: 'Board' }))
    const alone = await screen.findByRole('region', { name: 'The project’s work' })
    await userEvent.click(within(alone).getByRole('button', { name: 'Expand Settled, 2' }))
    expect(JSON.parse(window.localStorage.getItem('althar.lanes') ?? 'null').alone).toEqual({ collapsed: [], opened: ['settled'] })
  })

  it('opens on what was kept, leaving out what it doesn’t know as a lane', async () => {
    window.localStorage.setItem('althar.lanes', JSON.stringify({ alone: { collapsed: ['next', 'archive', 3], opened: 'settled' } }))
    const work = await theBoard()
    expect(within(work).getByRole('button', { name: 'Expand Up next, 1' })).toBeTruthy()
    expect(within(work).getByRole('button', { name: 'Collapse Settled' })).toBeTruthy()
  })

  it('collapses nothing from storage it can’t read', async () => {
    window.localStorage.setItem('althar.lanes', '{not json')
    const work = await theBoard()
    expect(within(work).queryByRole('button', { name: /^Expand/ })).toBeNull()
    expect(within(work).getByRole('button', { name: 'Collapse Up next' })).toBeTruthy()
  })

  it('keeps a lane collapsed for this window when storage can be read but won’t take it', async () => {
    const setItem = Storage.prototype.setItem.bind(window.localStorage)
    const full = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => {
      if (key === 'althar.lanes') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      setItem(key, value)
    })
    try {
      const work = await theBoard()
      await userEvent.click(within(work).getByRole('button', { name: 'Collapse Settled' }))
      expect(within(work).getByRole('button', { name: 'Expand Settled, 2' })).toBeTruthy()
      expect(window.localStorage.getItem('althar.lanes')).toBeNull()
    } finally {
      full.mockRestore()
    }
  })

  it('keeps Needs you open while something waits in it, saying why', async () => {
    window.localStorage.setItem('althar.lanes', JSON.stringify({ alone: { collapsed: ['you'], opened: [] } }))
    const work = await theBoard()
    const stays = within(work).getByRole('button', { name: 'Needs you stays open while something waits on you' })
    expect(stays.getAttribute('aria-disabled')).toBe('true')
    await userEvent.click(stays)
    expect(within(work).getByRole('button', { name: 'Ship it' })).toBeTruthy()
  })
})

describe('a ready task’s head, read ahead', () => {
  it('is read again when its task changes, not when another on the board does', async () => {
    const getThread = vi.fn(async () => snapshot())
    const { client } = fakeClient({ getThread })
    const cache = makeQueryClient()
    const first = board()
    readHeadsAhead(client, cache, first)
    await waitFor(() => expect(getThread).toHaveBeenCalledTimes(1))
    expect(getThread).toHaveBeenLastCalledWith('th4', { limit: 0 })
    // Another task starts: the board moves on, but the ready task's head is as it was.
    const moved = board({ cursor: 4, tasks: first.tasks.map((one) => (one.taskId === 't1' ? { ...one, phase: 'running' } : one)) })
    readHeadsAhead(client, cache, moved)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(getThread).toHaveBeenCalledTimes(1)
    // A call now waits in the ready task: its head is read again.
    const called = board({ cursor: 5, tasks: moved.tasks, calls: [{ ...first.calls[0]!, id: 'a9', taskId: 't4', threadId: 'th4' }] })
    readHeadsAhead(client, cache, called)
    await waitFor(() => expect(getThread).toHaveBeenCalledTimes(2))
    // Its pull request moves on: read again.
    readHeadsAhead(client, cache, {
      ...called,
      cursor: 6,
      tasks: called.tasks.map((one) =>
        one.taskId === 't4' && one.change !== null ? { ...one, change: { ...one.change, head: 'def456' } } : one,
      ),
    })
    await waitFor(() => expect(getThread).toHaveBeenCalledTimes(3))
  })
})
