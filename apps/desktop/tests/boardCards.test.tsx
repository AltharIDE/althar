import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type BoardCall, type BoardSnapshot, type BoardTask, type ChangeSummary, type ReviewBrief } from '@althar/contracts'
import { BoardCard, TaskStatus } from '@althar/ui'

import type { Client } from '../src/renderer/data/client'
import { ServicesProvider } from '../src/renderer/data/services'
import { BoardView, readyCardOf, runningCardOf, severalSaid } from '../src/renderer/features/board/BoardView'
import { DockView } from '../src/renderer/features/board/DockView'
import { lanesOf } from '../src/renderer/features/board/lanes'
import { needsOf } from '../src/renderer/features/board/needs'
import { useBoard } from '../src/renderer/features/board/useBoard'
import { agents, card, change, fakeClient, snapshot } from './fixtures'
import { servicesFor, withServices } from './render'

/*
 * The board's cards in the states the rest of its tests leave out: a running
 * change's checks by how many passed or failed, a review's findings and the
 * pull request it reads, a task whose call isn't read yet, a permission whose
 * words are its command, steps stuck with no agent to name, what was kept for
 * later, and the dock beside it for each.
 */

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

const board = (tasks: ReadonlyArray<BoardTask>, calls: ReadonlyArray<BoardCall> = [], settledTotal = 0): BoardSnapshot => ({
  cursor: 3,
  tasks: [...tasks],
  calls: [...calls],
  settledTotal,
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

const checks = (passed: number, failed: number, total = passed + failed): ChangeSummary['checks'] => ({
  outcome: failed > 0 ? 'failed' : 'passed',
  passed,
  failed,
  running: 0,
  total,
  failing: [],
  list: [],
})

const reviewing: ReviewBrief = {
  product: 'github',
  repository: 'meridian/api',
  number: 1199,
  url: 'https://github.com/meridian/api/pull/1199',
  title: 'Send back won’t restart a dead lead session',
  author: 'ninemate',
  outside: true,
  additions: 58,
  deletions: null,
  findings: 3,
  blocking: 0,
  verdict: null,
  posted: null,
}

const show = (lanes: ReturnType<typeof lanesOf>, more: Partial<Parameters<typeof BoardView>[0]> = {}) =>
  withServices(<BoardView lanes={lanes} agents={agents} now={NOW} onOpen={vi.fn()} {...more} />, fakeClient().client)

const cardOf = (title: string) => within(screen.getByRole('button', { name: title }).closest('article') as HTMLElement)

describe('a running change’s card', () => {
  it('says how its checks stand: one or all passed, one or more failed, nothing where none ran', () => {
    const running = (taskId: string, title: string, summary: ChangeSummary['checks']) =>
      task({ taskId, threadId: `th-${taskId}`, title, phase: 'running', step: 'implement', change: change({ checks: summary }) })
    show(
      lanesOf(
        board([
          running('c1', 'One check', checks(1, 0)),
          running('c2', 'Every check', checks(3, 0)),
          running('c3', 'One failed', checks(2, 1)),
          running('c4', 'Two failed', checks(1, 2)),
          running('c5', 'Never looked at', null),
          running('c6', 'Nothing to run', checks(0, 0)),
        ]),
      ),
    )
    expect(cardOf('One check').getByText('1 check passed')).toBeTruthy()
    expect(cardOf('Every check').getByText('All 3 checks passed')).toBeTruthy()
    expect(cardOf('One failed').getByText('1 check failed')).toBeTruthy()
    expect(cardOf('Two failed').getByText('2 checks failed')).toBeTruthy()
    // Its pull request still shows, with no word on checks it has none of.
    for (const title of ['Never looked at', 'Nothing to run']) {
      expect(cardOf(title).getByText('#12')).toBeTruthy()
      expect(cardOf(title).queryByText(/checks? (passed|failed)/)).toBeNull()
    }
  })

  it('has no clock, track or branch before an agent has worked on it, as it waits in the line', () => {
    const waiting = task({
      taskId: 'q',
      title: 'Waiting its turn',
      phase: 'running',
      step: 'implement',
      startedAt: '2026-10-01T09:30:00.000Z',
      queued: { busy: 4, atOnce: 4 },
      inLine: true,
      changed: { files: 1, add: 3, del: 1 },
    })
    const shown = runningCardOf(waiting, NOW, () => '')
    expect(shown.status).toBe(TaskStatus.Queued)
    expect(shown.why).toBe('4 of 4 agents busy on this Mac')
    expect(shown.at).toBeUndefined()
    expect(shown.track).toBeUndefined()
    expect(shown.object).toBeUndefined()
  })
})

describe('a review’s card', () => {
  it('says how many findings it has so far, beside their pull request with what its host said of its size', () => {
    show(
      lanesOf(
        board([
          task({ taskId: 'r1', title: 'Review #1199', phase: 'running', kind: 'review', reviewing }),
          task({ taskId: 'r2', title: 'Review, still opening', phase: 'running', kind: 'review', reviewing: null }),
        ]),
      ),
    )
    const reading = cardOf('Review #1199')
    expect(reading.getByText('3 findings so far')).toBeTruthy()
    expect(reading.getByText('#1199')).toBeTruthy()
    // Its host said how much was added but not removed: no size.
    expect(reading.queryByText('+58')).toBeNull()
    // Before its pull request is read, it only reads.
    const opening = cardOf('Review, still opening')
    expect(opening.getByText('Reading')).toBeTruthy()
    expect(opening.queryByText(/so far/)).toBeNull()
  })

  it('says only how many it found once drafted, where none block it and it has no verdict', () => {
    show(lanesOf(board([task({ taskId: 'r3', title: 'Review drafted', phase: 'ready', kind: 'review', reviewing })])))
    const drafted = cardOf('Review drafted')
    expect(drafted.getByText('3 findings')).toBeTruthy()
    expect(drafted.queryByText(/blocking|approve|request changes|comment/)).toBeNull()
  })
})

describe('a card that waits on the person', () => {
  it('stays under way before its call is read, never in Needs you for a moment (DEV-173)', () => {
    show(
      lanesOf(
        board(
          [task({ taskId: 't3', threadId: 'th3', title: 'Ship it', phase: 'waiting', createdAt: '2026-10-01T08:00:00.000Z' })],
          [{ ...permission, id: 'a2', taskId: null, threadId: 'thc', title: 'Run make clean', command: 'make clean', taskTitle: null }],
        ),
      ),
    )
    expect(within(screen.getByRole('region', { name: /^Running/ })).getByText('Ship it')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: /^Needs you/ })).queryByText('Ship it')).toBeNull()
    expect(screen.queryByText('Waiting on you')).toBeNull()
  })

  it('says a permission’s command once, where what it asks is the command itself, many lines of it, or very long', () => {
    const asking = (taskId: string, title: string, command: string): [BoardTask, BoardCall] => [
      task({ taskId, threadId: `th-${taskId}`, title: `Task ${taskId}`, phase: 'waiting' }),
      { ...permission, id: `a-${taskId}`, taskId, threadId: `th-${taskId}`, title, command },
    ]
    const long = `rm -rf ${'build/'.repeat(30)}`
    const pairs = [asking('p1', 'make deploy', 'make deploy'), asking('p2', 'cd api\nmake deploy', 'make deploy'), asking('p3', long, long)]
    show(
      lanesOf(
        board(
          pairs.map(([work]) => work),
          pairs.map(([, call]) => call),
        ),
      ),
    )
    expect(cardOf('Task p1').getAllByText('make deploy')).toHaveLength(1)
    expect(cardOf('Task p2').queryByText(/cd api/)).toBeNull()
    // A long one shows in its chip, which holds it whole.
    expect(cardOf('Task p3').getByTitle(long)).toBeTruthy()
    expect(cardOf('Task p3').queryByText(long)).toBeNull()
  })

  it('says what stopped a step, publishing or with no agent to name, on a task’s card and a call’s own', () => {
    const stuckCall = (id: string, step: 'implement' | 'publish', why: 'session_ended' | 'failed_to_start', taskId: string | null) => ({
      ...permission,
      id,
      kind: 'stuck' as const,
      title: '',
      command: null,
      taskId,
      threadId: taskId === null ? 'thc' : `th-${taskId}`,
      stuck: { step, why, detail: null, agentId: null, round: 0, open: 0 },
    })
    show(
      lanesOf(
        board(
          [
            task({ taskId: 's1', threadId: 'th-s1', title: 'Publishing', phase: 'waiting' }),
            task({ taskId: 's2', threadId: 'th-s2', title: 'Nobody named', phase: 'waiting' }),
          ],
          [
            stuckCall('x1', 'publish', 'failed_to_start', 's1'),
            stuckCall('x2', 'implement', 'session_ended', 's2'),
            stuckCall('x3', 'implement', 'session_ended', null),
          ],
        ),
      ),
    )
    expect(cardOf('Publishing').getByText("Couldn't open the pull request.")).toBeTruthy()
    expect(cardOf('Nobody named').getByText(/^The agent closed before finishing the step/)).toBeTruthy()
    expect(screen.getAllByText(/^The agent closed before finishing the step/)).toHaveLength(2)
    // Listed for the bar as it is on the board.
    const needs = needsOf(lanesOf(board([], [stuckCall('x3', 'implement', 'session_ended', null)])), () => '', vi.fn(), 'thc')
    expect(needs.map((need) => [need.title.startsWith('The agent closed'), need.here])).toEqual([[true, true]])
  })

  it('names the task on screen among what needs you, waiting on its call or ready', () => {
    const lanes = lanesOf(
      board(
        [
          task({ taskId: 't3', threadId: 'th3', title: 'Ship it', phase: 'waiting' }),
          task({ taskId: 't4', threadId: 'th4', title: 'Tidy the docs', phase: 'ready', branch: 'althar/tidy-the-docs' }),
        ],
        [permission],
      ),
    )
    expect(needsOf(lanes, () => '', vi.fn(), 'th3').map((need) => [need.title, need.here])).toEqual([
      ['Run make deploy', true],
      ['Tidy the docs', undefined],
    ])
    expect(needsOf(lanes, () => '', vi.fn(), 'th4').map((need) => [need.title, need.meta, need.here])).toEqual([
      ['Run make deploy', 'Ship it', undefined],
      ['Tidy the docs', 'althar/tidy-the-docs', true],
    ])
  })
})

describe('a ready card’s own ways', () => {
  const ways = (more: Partial<NonNullable<Parameters<typeof BoardView>[0]['actions']>> = {}) => ({
    push: vi.fn(async () => true),
    merge: vi.fn(async () => true),
    pushing: new Set<string>(),
    merging: new Set<string>(),
    failed: {},
    markDone: vi.fn(async () => true),
    keep: vi.fn(async () => true),
    settling: new Set<string>(),
    ...more,
  })

  it('lists Scratch by each chat’s latest exchange, opens one in place, and clears one by settling it', async () => {
    const said = (at: string, text: string, by: 'person' | 'lead' = 'lead') => ({ at, by, said: text })
    const older = task({
      taskId: 't9',
      threadId: 'th9',
      title: 'How does retry work?',
      phase: 'ready',
      scratch: true,
      latest: said('2026-10-01T09:00:00.000Z', 'It doubles the wait each time.'),
    })
    const newer = task({
      taskId: 't10',
      threadId: 'th10',
      title: 'Which lane heights?',
      phase: 'ready',
      scratch: true,
      createdAt: '2026-09-01T09:00:00.000Z',
      latest: said('2026-10-01T09:50:00.000Z', 'Try 52 and 64.', 'person'),
    })
    const lanes = lanesOf(board([older, newer]))
    expect(lanes.scratch.map((work) => work.taskId)).toEqual(['t10', 't9'])
    const onOpen = vi.fn()
    const actions = ways()
    show(lanes, { onOpen, actions })
    await userEvent.click(screen.getByRole('button', { name: 'Asides · 2' }))
    expect(await screen.findByText('Try 52 and 64.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /^How does retry work\?/ }))
    expect(onOpen).toHaveBeenCalledWith('th9')
    await userEvent.click(await screen.findByRole('button', { name: 'Clear “Which lane heights?”' }))
    expect(actions.markDone).toHaveBeenCalledWith('t10')
  })

  it('says Done is under way, and keeps Keep for later from being pressed meanwhile', () => {
    const finished = task({ taskId: 'f1', threadId: 'thf1', title: 'Prototype the tabs', phase: 'ready', kind: 'plain', branch: null })
    show(lanesOf(board([finished])), { actions: ways({ settling: new Set(['f1']) }) })
    const shown = cardOf('Prototype the tabs')
    expect(shown.getByRole('button', { name: 'Done' }).getAttribute('aria-busy')).toBe('true')
    expect(shown.getByRole('button', { name: 'Keep for later' }).hasAttribute('disabled')).toBe(true)
  })

  it('says what waits for Ship and ships it from the card, whatever its pull request’s checks say (a task is a conversation plus parts)', async () => {
    const ship = vi.fn(async () => true)
    const actions = ways({ ship, shipping: new Set<string>() })
    const held = task({
      taskId: 'h1',
      threadId: 'thh1',
      title: 'Retry twice',
      phase: 'ready',
      change: change({ draft: false, localHead: 'def456', unpushed: 2, checks: checks(1, 1) }),
      held: { since: NOW, commits: 2 },
    })
    show(lanesOf(board([held])), { actions })
    const shown = cardOf('Retry twice')
    expect(shown.getByText('Not shipped')).toBeTruthy()
    expect(shown.getByText('2 commits not shipped')).toBeTruthy()
    // Its checks are the pushed head's, which Ship replaces: said beside it, and no Push of its own.
    expect(shown.getByText('1 check failed')).toBeTruthy()
    expect(shown.queryByRole('button', { name: /^Push/ })).toBeNull()
    await userEvent.click(shown.getByRole('button', { name: 'Ship 2 commits' }))
    expect(ship).toHaveBeenCalledWith('h1')
  })

  it('says one sentence across several changes, naming only the exception, with a mark for each at its foot', () => {
    const several = task({
      taskId: 's1',
      threadId: 'ths1',
      title: 'Lanes and cards',
      phase: 'ready',
      change: change({ draft: false, checks: checks(2, 0) }),
      changeCount: 3,
      changeMarks: [
        { name: 'Add a retry', stands: 'ready' },
        { name: 'Lane heights', stands: 'failing' },
        { name: 'Card sizes', stands: 'ready' },
      ],
    })
    show(lanesOf(board([several])))
    const shown = cardOf('Lanes and cards')
    // Said once as the card's fact, and again by its mark, to a screen reader.
    expect(shown.getAllByText('Lane heights: checks failing')).toHaveLength(2)
    expect(shown.getByText('3 changes')).toBeTruthy()
    expect(shown.getAllByRole('listitem').map((mark) => mark.textContent)).toEqual([
      'Add a retry: ready to merge',
      'Lane heights: checks failing',
      'Card sizes: ready to merge',
    ])
    // What's alike is counted; merged ones drop out while any is open.
    const said = (...stands: ReadonlyArray<'ready' | 'checking' | 'failing' | 'merged' | 'unshipped'>) =>
      severalSaid(stands.map((one, at) => ({ name: `C${at + 1}`, stands: one })))?.words
    expect(said('ready', 'ready')).toBe('Both ready to merge')
    expect(said('checking', 'checking', 'checking')).toBe('Waiting for checks on all 3')
    expect(said('merged', 'ready')).toBe('C2: ready to merge')
    expect(said('failing', 'failing', 'ready')).toBe('Checks failing on 2 of 3')
    expect(said('unshipped', 'unshipped')).toBe('Neither shipped yet')
    expect(said('merged', 'merged')).toBe('Both merged')
  })

  it('says Ship is under way, and why it failed, offering it again', () => {
    const held = task({ taskId: 'h2', threadId: 'thh2', title: 'Retry twice', phase: 'ready', held: { since: NOW, commits: 1 } })
    show(lanesOf(board([held])), { actions: ways({ ship: vi.fn(async () => true), shipping: new Set(['h2']) }) })
    expect(cardOf('Retry twice').getByRole('button', { name: 'Ship 1 commit' }).getAttribute('aria-busy')).toBe('true')
    show(lanesOf(board([held])), {
      actions: ways({
        ship: vi.fn(async () => true),
        shipping: new Set(),
        failed: { h2: { action: 'ship', message: 'GitHub refused the push' } },
      }),
    })
    const failed = screen.getAllByRole('alert').map((one) => one.textContent)
    expect(failed).toContain('Ship failed: GitHub refused the push')
    expect(screen.getAllByRole('button', { name: 'Try shipping 1 commit again' }).length).toBeGreaterThan(0)
  })

  it('says what a review after a merge found, for that merge, with Fix it and Leave it', async () => {
    const fixAfterMerge = vi.fn(async () => true)
    const leaveAfterMerge = vi.fn(async () => true)
    const merged = change({ state: 'merged', draft: false, checks: checks(2, 0) })
    const found = task({
      taskId: 'm1',
      threadId: 'thm1',
      title: 'Rename the setting',
      phase: 'ready',
      state: 'done',
      change: merged,
      afterMerge: { url: merged.url, words: '#715', state: 'found', findings: 2 },
    })
    show(lanesOf(board([found])), { actions: ways({ fixAfterMerge, leaveAfterMerge, answeringAfterMerge: new Set() }) })
    const shown = cardOf('Rename the setting')
    expect(shown.getByText('Review found 2')).toBeTruthy()
    expect(shown.getByText('After #715 merged')).toBeTruthy()
    await userEvent.click(shown.getByRole('button', { name: /new pull request after #715/ }))
    expect(fixAfterMerge).toHaveBeenCalledWith('m1')
    await userEvent.click(shown.getByRole('button', { name: /Close the findings/ }))
    expect(leaveAfterMerge).toHaveBeenCalledWith('m1')
  })

  it('says a settled change’s lead replied, until the person reads it', () => {
    const merged = change({ state: 'merged', draft: false, checks: checks(2, 0) })
    const replied = task({
      taskId: 'r1',
      threadId: 'thr1',
      title: 'Add a retry',
      phase: 'ready',
      state: 'done',
      change: merged,
      replied: NOW,
    })
    show(lanesOf(board([replied])))
    expect(cardOf('Add a retry').getByText('Replied')).toBeTruthy()
  })

  it('merges a pull request whose head its host didn’t say, as the card showed it', async () => {
    const actions = ways()
    const ready = task({
      taskId: 'm1',
      threadId: 'thm1',
      title: 'Good to merge',
      phase: 'ready',
      change: change({ draft: false, head: null, checks: checks(2, 0) }),
    })
    show(lanesOf(board([ready])), { actions })
    await userEvent.click(cardOf('Good to merge').getByRole('button', { name: 'Accept and merge #12' }))
    expect(actions.merge).toHaveBeenCalledWith('m1', '', 'https://github.com/meridian/api/pull/12')
  })

  it('shows what was kept for later without when, Done only where it can be, and why Done failed; and Settled again on a press', async () => {
    const kept = (taskId: string, title: string, more: Partial<BoardTask> = {}) =>
      task({ taskId, threadId: `th-${taskId}`, title, phase: 'kept', kind: 'plain', branch: null, ...more })
    const settled = task({ taskId: 's1', threadId: 'ths1', title: 'Shipped before', phase: 'settled', state: 'done', settledAt: NOW })
    const lanes = lanesOf(
      board(
        [
          kept('k1', 'Kept, no time', { keptAt: null }),
          kept('k2', 'Kept, failed', { keptAt: '2026-10-01T09:00:00.000Z' }),
          kept('k3', 'Kept review', { kind: 'review', reviewing, keptAt: '2026-10-01T08:00:00.000Z' }),
          kept('k4', 'Kept, no time either', { keptAt: null }),
          settled,
          task({ taskId: 's2', threadId: 'ths2', title: 'Settled sometime', phase: 'settled', state: 'done', settledAt: null }),
          task({ taskId: 's3', threadId: 'ths3', title: 'Settled sometime too', phase: 'settled', state: 'done', settledAt: null }),
        ],
        [],
        3,
      ),
    )
    // The latest kept first, and settled, those at no known time last.
    expect(lanes.kept.map((work) => work.taskId)).toEqual(['k2', 'k3', 'k1', 'k4'])
    expect(lanes.settled.map((work) => work.taskId)).toEqual(['s1', 's2', 's3'])
    show(lanes, { actions: ways({ failed: { k2: { action: 'other', message: 'The runtime is restarting.' } } }) })
    const lane = within(screen.getByRole('region', { name: /^Settled/ }))
    await userEvent.click(lane.getByRole('button', { name: 'Kept 4' }))
    expect(lane.getAllByText(/^kept /)).toHaveLength(2)
    expect(lane.getByRole('alert').textContent).toBe('The runtime is restarting.')
    // A review with its draft still to post settles once it is posted: no Done here.
    expect(lane.getAllByRole('button', { name: 'Done' })).toHaveLength(3)
    await userEvent.click(lane.getByRole('button', { name: /^Settled/ }))
    expect(lane.getByText('Shipped before')).toBeTruthy()
    expect(lane.queryByText('Kept, no time')).toBeNull()
    expect(lane.getByText('Settled sometime')).toBeTruthy()
  })

  it('shows what was kept with no Done where the board can’t settle it', async () => {
    const kept = task({ taskId: 'k1', threadId: 'thk1', title: 'Kept away', phase: 'kept', kind: 'plain', branch: null, keptAt: NOW })
    show(lanesOf(board([kept])))
    const lane = within(screen.getByRole('region', { name: /^Settled/ }))
    await userEvent.click(lane.getByRole('button', { name: 'Kept 1' }))
    expect(lane.getByText('Kept away')).toBeTruthy()
    expect(lane.queryByRole('button', { name: 'Done' })).toBeNull()
  })
})

describe('up next', () => {
  const NEXT_ON = { busy: 4, atOnce: 4 }
  const inLine = (taskId: string, place: number | undefined, createdAt: string, more: Partial<BoardTask> = {}) =>
    task({ taskId, title: `In line ${taskId}`, phase: 'running', queued: NEXT_ON, inLine: true, place, createdAt, ...more })

  it('puts the line in its places, those the runtime gave no place after, oldest first', () => {
    const lanes = lanesOf(
      board([
        inLine('late', undefined, '2026-10-01T09:20:00.000Z'),
        inLine('early', undefined, '2026-10-01T09:10:00.000Z'),
        inLine('second', 2, '2026-10-01T09:30:00.000Z'),
        inLine('first', 1, '2026-10-01T09:40:00.000Z'),
      ]),
    )
    expect(lanes.next.map((work) => work.taskId)).toEqual(['first', 'second', 'early', 'late'])
  })

  it('says why moving the line failed, and gives a plain task no kind’s word', () => {
    const line = { move: vi.fn(async () => {}), oldestFirst: vi.fn(), failed: 'The runtime is restarting.' }
    show(
      lanesOf(
        board([
          task({ taskId: 'h', title: 'A question to look into', phase: 'held', kind: 'plain', plan: { ...card().plan!, startsAt: null } }),
        ]),
      ),
      { line },
    )
    expect(screen.getByRole('alert').textContent).toBe('The runtime is restarting.')
    const next = within(screen.getByRole('region', { name: /^Up next/ }))
    expect(next.getByText('A question to look into')).toBeTruthy()
    expect(next.queryByText('Change')).toBeNull()
  })
})

describe('the dock, for each', () => {
  function Docked({ target, onTask = vi.fn() }: { target: Parameters<typeof DockView>[0]['target']; onTask?: (threadId: string) => void }) {
    return (
      <DockView
        target={target}
        model={useBoard('p1')}
        agents={agents}
        project="meridian"
        now={NOW}
        onClose={vi.fn()}
        onTask={onTask}
        onChanges={vi.fn()}
      />
    )
  }
  const dock = (snapshot: BoardSnapshot, target: Parameters<typeof DockView>[0]['target'], more: Partial<Client> = {}) => {
    const { client } = fakeClient({ getBoard: vi.fn(async () => snapshot), ...more })
    const onTask = vi.fn()
    withServices(<Docked target={target} onTask={onTask} />, client)
    return { client, onTask, docked: async () => within(await screen.findByRole('complementary', { name: 'Beside the board' })) }
  }

  it('opens a question in its task, where it was asked, with nothing to answer here', async () => {
    const question: BoardCall = { ...permission, id: 'q1', kind: 'question', title: 'Which database?', command: null }
    const { onTask, docked } = dock(board([], [question]), { kind: 'call', id: 'q1' })
    const shown = await docked()
    expect(shown.queryByRole('button', { name: /Allow/ })).toBeNull()
    await userEvent.click(shown.getByRole('button', { name: 'Open the task' }))
    expect(onTask).toHaveBeenCalledWith('th3')
  })

  it('says what stopped a step with no agent to name, beside the board', async () => {
    const stuck: BoardCall = {
      ...permission,
      id: 'x1',
      kind: 'stuck',
      title: '',
      command: null,
      stuck: { step: 'implement', why: 'session_ended', detail: null, agentId: null, round: 0, open: 0 },
    }
    const { docked } = dock(board([], [stuck]), { kind: 'call', id: 'x1' })
    expect((await docked()).getByText(/^The agent closed before finishing the step/)).toBeTruthy()
  })

  it('says whom work waits for by its id where the agent isn’t on this Mac', async () => {
    const waits = task({
      taskId: 'w',
      title: 'Waiting on a reset',
      phase: 'running',
      step: 'implement',
      waits: { agentId: 'grok', until: NOW },
    })
    const first = dock(board([waits]), { kind: 'task', id: 'w' })
    expect(await (await first.docked()).findByText(/grok is out of usage until/)).toBeTruthy()
  })

  it('names work in the line as up next, and says it waits for a free agent', async () => {
    const queued = task({ taskId: 'q', title: 'In the line', phase: 'running', queued: { busy: 4, atOnce: 4 }, inLine: true })
    const { docked } = dock(board([queued]), { kind: 'task', id: 'q' })
    const shown = await docked()
    expect(shown.getByText('Up next')).toBeTruthy()
    expect(shown.getByText(/4 of 4 agents busy/)).toBeTruthy()
  })

  it('accepts a pull request with no checks and no head its host said, as the dock showed it', async () => {
    const ready = task({
      taskId: 'r',
      threadId: 'thr',
      title: 'Bare pull request',
      phase: 'ready',
      summary: null,
      change: change({ draft: false, checks: null, head: null }),
    })
    const { client, docked } = dock(board([ready]), { kind: 'task', id: 'r' })
    const shown = await docked()
    await userEvent.click(await shown.findByRole('button', { name: /^Accept/ }))
    await waitFor(() => expect(client.merge).toHaveBeenCalledWith('r', '', 'https://github.com/meridian/api/pull/12'))
  })

  it('sends a note back quietly where another start of the lead took over first', async () => {
    const ready = task({ taskId: 't4', threadId: 'th4', title: 'Rate-limit refunds', phase: 'ready', change: change({ draft: false }) })
    const startSession = vi.fn(async () => {
      throw new ApiError({ reason: 'SessionRunning', message: 'A session is already running.' })
    })
    const { client, docked } = dock(
      board([ready]),
      { kind: 'task', id: 't4' },
      {
        startSession,
        getThread: vi.fn(async () =>
          snapshot({ session: null, task: { ...snapshot().task, id: 't4', lead: { agentId: 'codex', model: null, account: null } } }),
        ),
      },
    )
    const shown = await docked()
    await userEvent.click(shown.getByRole('button', { name: 'Ask for changes' }))
    await userEvent.type(shown.getByRole('textbox'), 'Please rename it.')
    await userEvent.click(shown.getByRole('button', { name: 'Send to the lead' }))
    await waitFor(() => expect(startSession).toHaveBeenCalledWith({ threadId: 'th4', agentId: 'codex' }))
    expect(client.send).toHaveBeenCalledWith({ threadId: 'th4', body: 'Please rename it.', disposition: 'after_current' })
    await waitFor(() => expect(shown.queryByRole('textbox')).toBeNull())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each([
    ['open', 'beside the open one'],
    ['merged', 'after the last merged'],
  ] as const)('opens a new pull request for commits in none, %s (%s)', async (state, _where) => {
    const ready = task({
      taskId: 'u',
      threadId: 'thu',
      title: 'Commits after',
      phase: 'ready',
      change: change({ state, draft: false, checks: checks(2, 0) }),
      unshipped: { commits: 2, add: 9, del: 1 },
    })
    const { client, docked } = dock(board([ready]), { kind: 'task', id: 'u' })
    await userEvent.click((await docked()).getByRole('button', { name: 'Open a new pull request' }))
    expect(client.openChange).toHaveBeenCalledWith('u')
  })
})

describe('the board’s model', () => {
  const boardOf = (client: Client, projectId: string) => {
    const services = servicesFor(client)
    return renderHook((props: { projectId: string }) => useBoard(props.projectId), {
      initialProps: { projectId },
      wrapper: ({ children }: { children: ReactNode }) => <ServicesProvider value={services}>{children}</ServicesProvider>,
    })
  }
  const settled = (taskId: string, settledAt: string | null) => task({ taskId, phase: 'settled', state: 'done', settledAt })

  it('keeps one project’s settled work to itself, and pages nothing older than work settled at no known time', async () => {
    const { client } = fakeClient({
      getBoard: vi.fn(async (projectId: string) =>
        projectId === 'p1'
          ? board([settled('s1', '2026-10-01T08:00:00.000Z'), settled('s0', null), settled('s00', null)], [], 5)
          : board([], [], 0),
      ),
    })
    const { result, rerender } = boardOf(client, 'p1')
    await waitFor(() => expect(result.current.board?.tasks.map((work) => work.taskId)).toEqual(['s1', 's0', 's00']))
    // The oldest it shows is the one settled at no known time, last: there is nothing to page from.
    expect(result.current.moreSettled).toBe(true)
    act(() => result.current.showOlder())
    expect(client.getOlderSettled).not.toHaveBeenCalled()
    // Another project's board has none of this one's settled work.
    rerender({ projectId: 'p2' })
    await waitFor(() => expect(result.current.board?.tasks).toEqual([]))
  })

  it('drops a page of older work that arrives once another project shows', async () => {
    let page: (tasks: ReadonlyArray<BoardTask>) => void = () => undefined
    const { client } = fakeClient({
      getBoard: vi.fn(async (projectId: string) =>
        projectId === 'p1' ? board([settled('s1', '2026-10-01T08:00:00.000Z')], [], 5) : board([], [], 0),
      ),
      getOlderSettled: vi.fn(() => new Promise<ReadonlyArray<BoardTask>>((resolve) => (page = resolve))),
    })
    const { result, rerender } = boardOf(client, 'p1')
    await waitFor(() => expect(result.current.board?.tasks.map((work) => work.taskId)).toEqual(['s1']))
    act(() => result.current.showOlder())
    expect(client.getOlderSettled).toHaveBeenCalledWith('p1', '2026-10-01T08:00:00.000Z', 's1')
    rerender({ projectId: 'p2' })
    await waitFor(() => expect(result.current.board?.tasks).toEqual([]))
    await act(async () => page([settled('old', '2026-09-01T08:00:00.000Z')]))
    expect(result.current.board?.tasks).toEqual([])
  })
})

describe('a card of a task that handed back pictures', () => {
  const handed: BoardTask['handed'] = {
    pictures: [
      { digest: 'a'.repeat(64), mediaType: 'image/png', bytes: 9, width: 4, height: 3, name: 'one.png', unkept: null },
      { digest: 'b'.repeat(64), mediaType: 'image/png', bytes: 9, width: 4, height: 3, name: 'two.png', unkept: null },
    ],
    files: [{ path: 'notes.md', add: null }],
  }
  const shown = (work: BoardTask) => {
    render(<BoardCard {...readyCardOf(work)} />)
    return screen
  }

  it('shows them above its branch where it has a branch and no pull request', () => {
    const view = shown(task({ phase: 'ready', branch: 'althar/prototype-a-few-designs', changed: { files: 3, add: 1126, del: 0 }, handed }))
    expect(within(view.getByLabelText('Pictures')).getAllByRole('img')).toHaveLength(2)
    expect(view.getByText('althar/prototype-a-few-designs')).toBeTruthy()
    // Pictures are what it shows of what was handed back, not its files too.
    expect(view.queryByText('notes.md')).toBeNull()
  })

  it('shows them with its pull request chip', () => {
    const view = shown(task({ phase: 'ready', change: change({ draft: false, checks: null }), handed }))
    expect(within(view.getByLabelText('Pictures')).getAllByRole('img')).toHaveLength(2)
    expect(view.getByText(/Add a retry/)).toBeTruthy()
  })

  it('shows them on a Replied card', () => {
    const view = shown(
      task({ phase: 'ready', replied: 'th1', branch: 'althar/prototype-a-few-designs', changed: { files: 3, add: 1126, del: 0 }, handed }),
    )
    expect(view.getByText('Replied')).toBeTruthy()
    expect(within(view.getByLabelText('Pictures')).getAllByRole('img')).toHaveLength(2)
    expect(view.getByText('althar/prototype-a-few-designs')).toBeTruthy()
  })

  it('shows its files with its branch where it handed back no pictures', () => {
    const view = shown(
      task({
        phase: 'ready',
        branch: 'althar/notes',
        changed: { files: 1, add: 4, del: 0 },
        handed: { pictures: [], files: [{ path: 'docs/notes.md', add: 4 }] },
      }),
    )
    expect(view.getByText(/notes\.md/)).toBeTruthy()
    expect(view.getByText('althar/notes')).toBeTruthy()
  })
})
