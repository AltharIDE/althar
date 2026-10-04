import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type BoardCall, type BoardSnapshot, type BoardTask } from '@althar/contracts'

import { BoardView, trackOf } from '../src/renderer/features/board/BoardView'
import { DockView } from '../src/renderer/features/board/DockView'
import { clock, running } from '../src/renderer/shared/time'
import { lanesOf, yoursOf } from '../src/renderer/features/board/lanes'
import { useBoard } from '../src/renderer/features/board/useBoard'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useProject } from '../src/renderer/features/project/useProject'
import { agents, card, change, changed, fakeClient, snapshot } from './fixtures'
import { withServices } from './render'

function Project({ onTask = vi.fn() }: { onTask?: (threadId: string) => void }) {
  return <ProjectView model={useProject('p1')} board={useBoard('p1')} connections={useConnections()} onBack={vi.fn()} onTask={onTask} />
}

const task = (overrides: Partial<BoardTask> = {}): BoardTask => ({
  ...card(),
  state: 'open',
  createdAt: '2026-10-01T09:00:00.000Z',
  settledAt: null,
  changed: null,
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
  ...overrides,
})

describe('the board’s lanes', () => {
  it('puts each task and call where it belongs', () => {
    const lanes = lanesOf(board())
    expect(lanes.next.map((work) => work.taskId)).toEqual(['t1'])
    expect(lanes.running.map((work) => work.taskId)).toEqual(['t2', 't3'])
    expect(lanes.ready.map((work) => work.taskId)).toEqual(['t4', 't5'])
    expect(lanes.settled.map((work) => work.taskId)).toEqual(['t6', 't7'])
    expect(yoursOf(lanes)).toBe(3)
  })

  it('names a task’s steps, and the one it is on', () => {
    expect(trackOf(task({ step: 'settle' }))).toEqual({ steps: ['Implement', 'Review'], at: 1 })
    expect(trackOf(task({ step: 'publish' }))).toEqual({ steps: ['Implement', 'Review'], at: 1 })
    expect(trackOf(task({ step: 'implement' }))).toEqual({ steps: ['Implement', 'Review'], at: 0 })
    // A task with no plan is a conversation with its lead.
    expect(trackOf(task({ plan: null }))).toEqual({ steps: ['Conversation'], at: 0 })
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
    expect(within(work).getByText('Run make deploy')).toBeTruthy()
    expect(within(work).getByText('Rate-limit refunds')).toBeTruthy()
    // Ready on its branch, with no pull request: the branch, and how big its change is.
    expect(within(work).getByText('althar/tidy-the-docs')).toBeTruthy()
    expect(within(work).getByText('PR #7 merged')).toBeTruthy()
    // Two running (one of them waiting on you), and three things that need you.
    expect(screen.getByText('2 running')).toBeTruthy()
    expect(screen.getByRole('button', { name: '3 need you' })).toBeTruthy()
  })

  it('answers a call in the dock, from the bar or its card', async () => {
    const answer = vi.fn(async () => {})
    const { client } = fakeClient({ answer, getBoard: vi.fn(async () => board()) })
    withServices(<Project />, client)
    // From the conversation, the bar opens the first call beside the board.
    await userEvent.click(await screen.findByRole('button', { name: '3 need you' }))
    const dock = await screen.findByRole('complementary', { name: 'Beside the board' })
    expect(within(dock).getByText(/^Ship it · /)).toBeTruthy()
    await userEvent.click(within(dock).getByRole('button', { name: /^Allow/ }))
    await waitFor(() => expect(answer).toHaveBeenCalledWith({ attentionId: 'a1', decision: 'allow' }))
    expect(screen.getByRole('radio', { name: 'Both', checked: true })).toBeTruthy()
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
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('radio', { name: 'Board' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Rate-limit refunds' }))
    const dock = await screen.findByRole('complementary', { name: 'Beside the board' })
    expect(within(dock).getByText('Retried the call.')).toBeTruthy()
    expect(await within(dock).findByText('limit.ts')).toBeTruthy()
    await userEvent.click(within(dock).getByRole('button', { name: /Accept and merge/ }))
    expect(await within(dock).findByText('GitHub says: Pull Request is not mergeable')).toBeTruthy()
    await userEvent.click(within(dock).getByRole('button', { name: /Accept and merge/ }))
    await waitFor(() => expect(merge).toHaveBeenCalledTimes(2))
    // At the head the dock showed.
    expect(merge).toHaveBeenLastCalledWith('t4', 'abc123')
    // Sent back, its lead, which stopped, starts again with the note as its first turn.
    await userEvent.click(within(dock).getByRole('button', { name: /Send back/ }))
    await userEvent.type(within(dock).getByRole('textbox'), 'Name it better.')
    await userEvent.click(within(dock).getByRole('button', { name: /Send back/ }))
    await waitFor(() => expect(send).toHaveBeenCalledWith({ threadId: 'th4', body: 'Name it better.', disposition: 'after_current' }))
    await waitFor(() => expect(startSession).toHaveBeenCalledWith({ threadId: 'th4', agentId: 'claude-code' }))
    // The note is queued first, so the lead reads it in its first turn.
    expect(send.mock.invocationCallOrder[0]).toBeLessThan(startSession.mock.invocationCallOrder[0] ?? 0)
  })

  it('opens work ready on its branch to review its changes, and any task in its own window', async () => {
    const onTask = vi.fn()
    const getFileDiff = vi.fn(async (_taskId: string, path: string) => ({
      file: { path, from: null, status: 'modified' as const, add: 1, del: 0, binary: false, uncommitted: false },
      lines: [{ kind: 'added' as const, new: 1, text: 'tidied' }],
      truncated: false,
    }))
    const { client } = fakeClient({
      getFileDiff,
      getBoard: vi.fn(async () => board()),
      getThread: vi.fn(async () =>
        snapshot({
          task: {
            ...snapshot().task,
            id: 't5',
            branch: 'althar/tidy',
            files: [{ path: 'docs/a.md', from: null, status: 'modified', add: 9, del: 4, binary: false, uncommitted: false }],
          },
        }),
      ),
    })
    withServices(<Project onTask={onTask} />, client)
    await userEvent.keyboard('{Meta>}2{/Meta}')
    await userEvent.click(await screen.findByRole('button', { name: 'Tidy the docs' }))
    const dock = await screen.findByRole('complementary', { name: 'Beside the board' })
    await userEvent.click(within(dock).getByRole('button', { name: 'Review the changes' }))
    const view = await screen.findByRole('dialog', { name: 'Changes' })
    expect(await within(view).findByText('tidied')).toBeTruthy()
    expect(getFileDiff).toHaveBeenCalledWith('t5', 'docs/a.md')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Changes' })).toBeNull())
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
    withServices(<Project />, client)
    await userEvent.keyboard('{Meta>}2{/Meta}')
    await userEvent.click(await screen.findByRole('button', { name: 'Tidy the docs' }))
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
    withServices(
      <BoardView lanes={lanes} agents={agents} now={NOW} current={{ kind: 'task', id: 'd' }} onOpen={onOpen} />,
      fakeClient().client,
    )
    expect(screen.getByText('Held. Starts when you say')).toBeTruthy()
    expect(screen.getByText('Starting')).toBeTruthy()
    expect(screen.getByText('Starts in 20s')).toBeTruthy()
    expect(screen.getByText('No agent is working on it')).toBeTruthy()
    expect(screen.getByText('2h 30m')).toBeTruthy()
    expect(screen.getByText('Conversation')).toBeTruthy()
    expect(screen.getByText('Claude Code stopped before the step was done.')).toBeTruthy()
    // A step held for a usage limit says whom it waits for, and when they're back.
    expect(screen.getByText(`Waits for Codex, back at ${clock('2026-10-01T13:40:00.000Z')}`)).toBeTruthy()
    expect(screen.getByText("Althar couldn't open the pull request.")).toBeTruthy()
    expect(screen.getByText(/isn't connected to this repository's host/)).toBeTruthy()
    expect(screen.getByText('PR #12 closed')).toBeTruthy()
    expect(screen.getAllByText('althar/add-a-retry').length).toBeGreaterThan(0)
    return userEvent
      .click(screen.getByRole('button', { name: 'Held plan' }))
      .then(() => expect(onOpen).toHaveBeenCalledWith({ kind: 'task', id: 'a' }))
  })

  it('says how long work has run', () => {
    expect(running('2026-10-01T09:59:30.000Z', NOW)).toBe('30s')
    expect(running('2026-10-01T09:54:00.000Z', NOW)).toBe('6m')
    expect(running('2026-10-01T07:56:00.000Z', NOW)).toBe('2h 4m')
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
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('radio', { name: 'Board' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Add a retry' }))
    expect(await screen.findByText('It can be accepted once its checks pass')).toBeTruthy()
  })
})

describe('the bar and the dock, on the rest of the board', () => {
  it('opens work ready to accept when no call waits, and starts a task from the board beside the conversation', async () => {
    const bare = change({ draft: false, additions: null, deletions: null, checks: null })
    const { client } = fakeClient({
      getBoard: vi.fn(async () => board({ tasks: [task({ taskId: 't9', phase: 'ready', change: bare })], calls: [] })),
    })
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('radio', { name: 'Board' }))
    const work = await screen.findByRole('region', { name: 'The project’s work' })
    // A pull request its host said nothing about: no sizes, and no checks.
    expect(within(work).getByText('No checks ran')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '1 needs you' }))
    const dock = await screen.findByRole('complementary', { name: 'Beside the board' })
    expect(within(dock).getByText('Ready')).toBeTruthy()
    // A task planned by hand opens beside the conversation, so the board makes room for it.
    await userEvent.click(screen.getByRole('button', { name: 'New task' }))
    expect(screen.getByRole('radio', { name: 'Both', checked: true })).toBeTruthy()
    expect(await screen.findByLabelText('What should change')).toBeTruthy()
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
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('radio', { name: 'Board' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Running work' }))
    let dock = await screen.findByRole('complementary', { name: 'Beside the board' })
    expect(within(dock).getByText('Halfway.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Waiting work' }))
    dock = await screen.findByRole('complementary', { name: 'Beside the board' })
    expect(within(dock).getByText('Waiting work', { selector: 'h2' })).toBeTruthy()
  })
})
