import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type BoardCall, type BoardSnapshot, type BoardTask } from '@althar/contracts'

import { BoardView, trackOf } from '../src/renderer/features/board/BoardView'
import { DockView } from '../src/renderer/features/board/DockView'
import { pictureUrl } from '../src/main/pictureAddress'
import { clock, running } from '../src/renderer/shared/time'
import { inYoursOf, lanesOf, yoursOf } from '../src/renderer/features/board/lanes'
import { firstNeedOf, needsOf } from '../src/renderer/features/board/needs'
import { useBoard } from '../src/renderer/features/board/useBoard'
import { useClosePullRequests } from '../src/renderer/features/board/useClosePullRequests'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useProject } from '../src/renderer/features/project/useProject'
import { agents, card, change, changed, fakeClient, snapshot } from './fixtures'
import { withServices } from './render'

function Project({ onTask = vi.fn() }: { onTask?: (threadId: string) => void }) {
  return <ProjectView model={useProject('p1')} board={useBoard('p1')} connections={useConnections()} onTask={onTask} />
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

  it('shows a plain task that finished in Needs you, but counts it nowhere and opens it from nothing else', () => {
    const lanes = lanesOf(
      board({
        tasks: [
          task({ taskId: 'p1', threadId: 'thp1', title: 'Which partners call v1?', phase: 'ready', kind: 'plain', branch: null }),
          task({ taskId: 't4', threadId: 'th4', title: 'Rate-limit refunds', phase: 'ready', change: change() }),
        ],
        calls: [],
      }),
    )
    expect(lanes.ready.map((work) => work.taskId)).toEqual(['p1', 't4'])
    expect(inYoursOf(lanes)).toBe(2)
    expect(yoursOf(lanes)).toBe(1)
    expect(needsOf(lanes, () => '', vi.fn()).map((need) => need.title)).toEqual(['Rate-limit refunds'])
    expect(firstNeedOf(lanes)).toBe('th4')
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
    // On the front page: three things that need you, one in progress, and what settled last; nothing says what runs.
    expect(screen.getByRole('button', { name: '3 need you' })).toBeTruthy()
    const front = screen.getByRole('heading', { level: 1, name: 'meridian' }).closest('header')
    expect(front?.textContent).toMatch(/3 need you·1 in progress·PR 7 merged \S/)
    expect(screen.queryByText(/running/)).toBeNull()
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
    // From the conversation, the count opens the call's task: no view changes, and nothing opens beside the board.
    await userEvent.click(await screen.findByRole('button', { name: '3 need you' }))
    expect(onTask).toHaveBeenCalledWith('th3')
    expect(screen.getByRole('radio', { name: 'Conversation', checked: true })).toBeTruthy()
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
      task({ taskId: 'd', title: 'Stopped work', phase: 'stopped', startedAt: '2026-10-01T07:30:00.000Z' }),
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

  it('draws plans waiting, stopped and planless work, stuck calls, and what settled', () => {
    const lanes = lanesOf(all)
    expect(lanes.next.map((work) => work.taskId)).toEqual(['b', 'c', 'a'])
    expect(lanes.settled.map((work) => work.taskId)).toEqual(['h', 'g', 'i'])
    const onOpen = vi.fn()
    withServices(<BoardView lanes={lanes} agents={agents} now={NOW} onOpen={onOpen} />, fakeClient().client)
    expect(screen.getByText('Held. Starts when you say')).toBeTruthy()
    expect(screen.getByText('Starting')).toBeTruthy()
    expect(screen.getByText('Starts in 20s')).toBeTruthy()
    expect(screen.getByText('No agent is working on it')).toBeTruthy()
    expect(screen.getByText('2h 30m')).toBeTruthy()
    expect(screen.getByText('Conversation')).toBeTruthy()
    expect(screen.getByText('Claude Code stopped before the step was done.')).toBeTruthy()
    // A step held for a usage limit says whom it waits for, and when they're back.
    expect(screen.getByText(`Waits for Codex, back at ${clock('2026-10-01T13:40:00.000Z')}`)).toBeTruthy()
    // One waiting for a free agent says so, and what for.
    expect(screen.getByText('4 of 4 agents busy on this Mac')).toBeTruthy()
    expect(screen.getByText('Waiting')).toBeTruthy()
    expect(screen.getByText("Althar couldn't open the pull request.")).toBeTruthy()
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

    it('shows nothing of progress before its first step has had an agent: no steps, branch or clock', () => {
      draw(task({ ...waiting, title: 'Not yet', branch: 'althar/not-yet', changed: { files: 0, add: 0, del: 0 }, planWaits: true }))
      expect(screen.getByText('Waiting')).toBeTruthy()
      expect(screen.getByText('4 of 4 agents busy on this Mac')).toBeTruthy()
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

  it('says Unrestricted at the foot of each card whose task allows everything, after what it says there already', () => {
    const lanes = lanesOf(
      board({
        tasks: [
          task({ taskId: 'u1', threadId: 'thu1', title: 'Allowed at work', phase: 'running', allowEverything: true }),
          task({ taskId: 'u2', threadId: 'thu2', title: 'Handed back', phase: 'ready', handedBack: 'A conflict', allowEverything: true }),
          task({ taskId: 'u3', threadId: 'thu3', title: 'Asks as ever', phase: 'running' }),
          // Up next, it will start allowing everything.
          task({ taskId: 'u4', threadId: 'thu4', title: 'Held, allowed', phase: 'held', allowEverything: true }),
          task({ taskId: 'u5', threadId: 'thu5', title: 'Held, asks', phase: 'held' }),
        ],
        calls: [],
      }),
    )
    withServices(<BoardView lanes={lanes} agents={agents} now={NOW} onOpen={vi.fn()} />, fakeClient().client)
    const cardOf = (title: string) => screen.getByRole('button', { name: title }).closest('article') as HTMLElement
    expect(within(cardOf('Allowed at work')).getByText('Unrestricted')).toBeTruthy()
    expect(within(cardOf('Handed back')).getByText('A conflict')).toBeTruthy()
    expect(within(cardOf('Handed back')).getByText('Unrestricted')).toBeTruthy()
    expect(within(cardOf('Asks as ever')).queryByText('Unrestricted')).toBeNull()
    expect(within(cardOf('Held, allowed')).getByText('Unrestricted')).toBeTruthy()
    expect(within(cardOf('Held, asks')).queryByText('Unrestricted')).toBeNull()
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
    expect(stuck.getByText('Claude Code stopped before the step was done.')).toBeTruthy()
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
        // Commits here and a check that failed on what is pushed: the push first, as it runs the checks again.
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
    expect(said('Commits to push')).toMatch(/3 commits not on the PR\s*Push 3 commits/)
    expect(said('Two at once')).toMatch(/2 commits not on the PR\s*·\s*test failed\s*Push 2 commits/)
    expect(said('Head not read yet')).toMatch(/All 5 checks passed\s*Accept and merge/)
    // Cancelled: said in place of a pass, and nothing to do from here but open the task.
    expect(said('A check cancelled')).toContain('check 4 cancelled')
    expect(said('A check cancelled')).not.toMatch(/checks passed|Accept and merge/)
    expect(said('A check skipped')).toMatch(/4 of 5 checks passed\s*Accept and merge/)
    expect(said('Closed since')).not.toMatch(/checks passed|Accept and merge/)
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
