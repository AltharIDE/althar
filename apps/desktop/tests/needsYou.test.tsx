import { cleanup, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { BoardTask, HomeCall, HomeTask } from '@althar/contracts'

import { BoardView } from '../src/renderer/features/board/BoardView'
import { lanesOf, yoursOf } from '../src/renderer/features/board/lanes'
import { HomeView } from '../src/renderer/features/home/HomeView'
import { useHome } from '../src/renderer/features/home/useHome'
import { useStart } from '../src/renderer/features/start/useStart'
import { agents, card, change, fakeClient, home, project } from './fixtures'
import { withServices } from './render'

/*
 * What needs the person is one rule (`needsYou`, shared/calls.ts), and the
 * board's Needs you lane, the home's list, its count and its project's line
 * all take it. The same tasks and calls go to both here, each case the
 * person can meet, and the two must agree on which wait on them.
 */

const NOW = '2026-10-14T12:00:00.000Z'

const task = (overrides: Partial<HomeTask>): HomeTask => ({
  ...card(),
  state: 'open',
  createdAt: '2026-10-14T09:00:00.000Z',
  settledAt: null,
  changed: null,
  here: [],
  projectId: 'p1',
  ...overrides,
})

const passed = { outcome: 'passed' as const, passed: 2, failed: 0, running: 0, total: 2, failing: [], list: [] }

/** Each case the person can meet, and whether it waits on them. */
const cases: ReadonlyArray<{ readonly why: string; readonly needs: boolean; readonly task: HomeTask }> = [
  {
    why: 'a change with its pull request open and its checks passed',
    needs: true,
    task: task({ taskId: 'a', threadId: 'tha', title: 'Accept the retry', phase: 'ready', change: change({ checks: passed }) }),
  },
  {
    why: 'a change whose pull request fails its checks',
    needs: true,
    task: task({ taskId: 'b', threadId: 'thb', title: 'Fix the failing checks', phase: 'ready', change: change() }),
  },
  {
    why: 'a change whose open pull request has commits not pushed yet',
    needs: true,
    task: task({
      taskId: 'c',
      threadId: 'thc',
      title: 'Push the last commits',
      phase: 'ready',
      change: change({ checks: passed, localHead: 'def456', unpushed: 2 }),
    }),
  },
  {
    why: 'a task whose pull request merged, with commits after it',
    needs: true,
    task: task({
      taskId: 'd',
      threadId: 'thd',
      title: 'Merged, then more',
      phase: 'ready',
      change: change({ state: 'merged' }),
      unshipped: { commits: 3, add: 40, del: 2 },
    }),
  },
  {
    why: 'a task handed back after a conflict its lead could not resolve',
    needs: true,
    task: task({ taskId: 'e', threadId: 'the', title: 'Conflict handed back', phase: 'ready', handedBack: 'It conflicts in README.md.' }),
  },
  {
    why: 'a review drafted, to post',
    needs: true,
    task: task({ taskId: 'f', threadId: 'thf', title: 'Review #1199', phase: 'ready', kind: 'review', branch: null }),
  },
  {
    why: 'a quick task that finished with an answer, no pull request coming',
    needs: false,
    task: task({ taskId: 'g', threadId: 'thg', title: 'Which partners call v1?', phase: 'ready', kind: 'plain', branch: null }),
  },
  {
    why: 'a prototype that finished on its branch, with nothing to accept',
    needs: false,
    task: task({ taskId: 'h', threadId: 'thh', title: 'Prototype the usage limits', phase: 'ready', kind: 'plain' }),
  },
  {
    why: 'a task at work',
    needs: false,
    task: task({ taskId: 'i', threadId: 'thi', title: 'Still going', phase: 'running' }),
  },
]

const permission = {
  id: 'a1',
  kind: 'permission',
  title: 'Run npm publish',
  reason: 'Deploying or publishing always asks.',
  command: 'npm publish',
  stuck: null,
  createdAt: '2026-10-14T09:30:00.000Z',
  taskId: 'wait',
  threadId: 'thwait',
  taskTitle: 'Waits on a call',
  taskSlug: 'waits',
  projectId: 'p1',
} as unknown as HomeCall

const waiting = task({ taskId: 'wait', threadId: 'thwait', title: 'Waits on a call', phase: 'waiting' })
const tasks: ReadonlyArray<HomeTask> = [...cases.map((one) => one.task), waiting]
const wanted = [...cases.filter((one) => one.needs).map((one) => one.task.title), 'Run npm publish'].toSorted()

function Home() {
  return <HomeView model={useHome()} start={useStart()} onProject={vi.fn()} onTalk={vi.fn()} onTask={vi.fn()} />
}

/** The titles of the cards in a lane of the board. */
const onBoard = (lane: string) =>
  within(screen.getByRole('region', { name: new RegExp(`^${lane}`) }))
    .queryAllByRole('article')
    .map((card) => card.querySelector('button')?.textContent ?? '')
    .toSorted()

describe('what needs the person', () => {
  it('is the same on the board and on the home, for each case', async () => {
    const calls: ReadonlyArray<HomeCall> = [permission]
    const lanes = lanesOf({ cursor: 1, tasks: tasks as ReadonlyArray<BoardTask>, calls, settledTotal: 0 })

    withServices(<BoardView lanes={lanes} agents={agents} now={NOW} onOpen={vi.fn()} />, fakeClient().client)
    // The board: what needs them, and a call once, as its task's card is; a task that finished is not in it.
    const board = onBoard('Needs you').map((title) => (title === 'Waits on a call' ? 'Run npm publish' : title))
    expect(board).toEqual(wanted)
    expect(yoursOf(lanes)).toBe(wanted.length)
    // It waits above what settled instead, and counts there.
    expect(onBoard('Settled')).toEqual(['Prototype the usage limits', 'Which partners call v1?'])
    cleanup()

    const { client } = fakeClient({ getHome: vi.fn(async () => home({ tasks: [...tasks], calls: [permission], projects: [project] })) })
    withServices(<Home />, client)
    const needs = await screen.findByRole('region', { name: /needs? you/ })
    const lines = within(needs)
      .getAllByRole('article')
      .map((line) => line.getAttribute('aria-label') ?? line.querySelector('h3, h4, button')?.textContent ?? '')
      .toSorted()
    expect(lines).toEqual(wanted)
    // The count at the head of the home, and the project's line, say the same number.
    expect(screen.getByRole('heading', { level: 2, name: new RegExp(`^${wanted.length} `) })).toBeTruthy()
    expect(within(screen.getByRole('complementary', { name: 'Projects' })).getByText(String(wanted.length))).toBeTruthy()

    // Each line says what to do: accept, push, open a new pull request, or take over a conflict.
    const line = (title: string) => within(within(needs).getByRole('article', { name: title }))
    expect(line('Accept the retry').getByRole('button', { name: 'Review' })).toBeTruthy()
    expect(line('Fix the failing checks').getByText(/1 check failed/)).toBeTruthy()
    expect(line('Push the last commits').getByText(/2 commits to push/)).toBeTruthy()
    expect(line('Merged, then more').getByText('Ready for a new pull request')).toBeTruthy()
    expect(line('Merged, then more').getByText('3 commits in no pull request · +40 −2')).toBeTruthy()
    expect(line('Merged, then more').getByRole('button', { name: 'Open' })).toBeTruthy()
    expect(line('Conflict handed back').getByText('Stuck')).toBeTruthy()
    expect(line('Conflict handed back').getByText('It conflicts in README.md.')).toBeTruthy()
    expect(line('Review #1199').getByRole('button', { name: 'Review' })).toBeTruthy()
  })

  for (const one of cases)
    it(`says ${one.needs ? 'it waits' : 'nothing waits'} for ${one.why}, on the board and the home alike`, async () => {
      const lanes = lanesOf({ cursor: 1, tasks: [one.task as BoardTask], calls: [], settledTotal: 0 })
      expect(yoursOf(lanes)).toBe(one.needs ? 1 : 0)
      const { client } = fakeClient({ getHome: vi.fn(async () => home({ tasks: [one.task], projects: [project] })) })
      withServices(<Home />, client)
      await screen.findByRole('complementary', { name: 'Projects' })
      if (one.needs) expect(await screen.findByRole('article', { name: one.task.title })).toBeTruthy()
      else expect(screen.queryByRole('article', { name: one.task.title })).toBeNull()
    })
})
