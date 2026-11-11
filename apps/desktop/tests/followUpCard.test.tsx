import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { BoardSnapshot, BoardTask, ChangeSummary } from '@althar/contracts'

import { BoardView } from '../src/renderer/features/board/BoardView'
import { lanesOf } from '../src/renderer/features/board/lanes'
import { agents, card, change, fakeClient } from './fixtures'
import { withServices } from './render'

/*
 * A task whose first pull request merged and whose follow-up, the fix after a review found something, is open with its checks
 * running: its card says what runs on that pull request, as a first one's does, and not that it is ready to accept.
 */

const NOW = '2026-10-01T10:00:00.000Z'

const first = change({ number: 763, title: 'Usage card drops the time breakdown', state: 'merged', draft: false, checks: null })

const followUp = (overrides: Partial<ChangeSummary> = {}): ChangeSummary =>
  change({
    number: 767,
    title: 'After #763: Stop summing task timing into every snapshot',
    url: 'https://github.com/meridian/api/pull/767',
    repository: 'meridian/althar',
    draft: false,
    additions: 1,
    deletions: 42,
    ...overrides,
  })

const task = (overrides: Partial<BoardTask> = {}): BoardTask => ({
  ...card(),
  taskId: 'u1',
  threadId: 'th-u1',
  title: 'Usage card drops the time breakdown',
  state: 'open',
  phase: 'ready',
  createdAt: '2026-10-01T09:00:00.000Z',
  settledAt: null,
  changed: null,
  here: [],
  branch: 'althar/usage-card-drops-the-time-breakdown-2',
  // What the branch holds is what the pull request holds: the same lines, said once.
  unshipped: { commits: 1, add: 1, del: 42 },
  earlier: [first],
  ...overrides,
})

const board = (tasks: ReadonlyArray<BoardTask>): BoardSnapshot => ({ cursor: 1, tasks: [...tasks], calls: [], settledTotal: 0 })

const show = (work: BoardTask) => {
  withServices(<BoardView lanes={lanesOf(board([work]))} agents={agents} now={NOW} onOpen={vi.fn()} />, fakeClient().client)
  return within(screen.getByRole('button', { name: 'Usage card drops the time breakdown' }).closest('article') as HTMLElement)
}

const checks = (passed: number, running: number): ChangeSummary['checks'] => ({
  outcome: running > 0 ? 'running' : 'passed',
  passed,
  failed: 0,
  running,
  total: passed + running,
  failing: [],
  list: [],
})

describe('the card of a follow-up pull request whose checks are running', () => {
  it('says the checks run, offers nothing to accept, and says the lines once', () => {
    const card = show(task({ change: followUp({ checks: checks(7, 5) }) }))
    expect(card.getByText('Checks running')).toBeTruthy()
    expect(card.getByText('Checks running, 7 of 12 passed')).toBeTruthy()
    expect(card.queryByText('Ready to accept')).toBeNull()
    expect(card.queryByText('No checks ran')).toBeNull()
    expect(card.queryByText('Accept and merge')).toBeNull()
    // Its pull request's row, and no branch row saying the same +1 −42.
    expect(card.getByText('#767')).toBeTruthy()
    expect(card.queryByText('althar/usage-card-drops-the-time-breakdown-2')).toBeNull()
    expect(card.getAllByText('+1')).toHaveLength(1)
  })

  it('is ready to accept, with its checks, once they pass', () => {
    const card = show(task({ change: followUp({ checks: checks(12, 0) }) }))
    expect(card.getByText('Ready to accept')).toBeTruthy()
    expect(card.getByText('All 12 checks passed')).toBeTruthy()
    expect(card.getByText('Accept and merge')).toBeTruthy()
  })

  it('keeps a branch row that says more than its pull request does', () => {
    const card = show(task({ change: followUp({ checks: checks(12, 0) }), unshipped: { commits: 2, add: 9, del: 0 } }))
    expect(card.getByText('althar/usage-card-drops-the-time-breakdown-2')).toBeTruthy()
    expect(card.getByText('+9')).toBeTruthy()
  })
})
