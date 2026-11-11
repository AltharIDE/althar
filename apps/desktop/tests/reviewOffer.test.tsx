import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BoardSnapshot, BoardTask } from '@althar/contracts'

import { BoardView } from '../src/renderer/features/board/BoardView'
import { lanesOf } from '../src/renderer/features/board/lanes'
import { agents, card, change, fakeClient } from './fixtures'
import { withServices } from './render'

/*
 * The review a change is offered once, as its work turns real: a quiet line on its card, with the reviewer the rules would
 * pick. It adds nothing by itself: Add goes through the team's own command, No thanks turns it down.
 */

const NOW = '2026-10-01T10:00:00.000Z'

const offered = (overrides: Partial<BoardTask> = {}): BoardTask => ({
  ...card(),
  state: 'open',
  createdAt: '2026-10-01T09:00:00.000Z',
  settledAt: null,
  changed: null,
  here: [],
  taskId: 'r',
  threadId: 'thr',
  title: 'Harden the prototype',
  phase: 'ready',
  kind: 'change',
  change: change({ state: 'open', draft: false }),
  reviewerChange: 'now',
  reviewOffer: { key: 'review', agentId: 'codex', model: null, skipped: false },
  plan: { ...card().plan!, steps: card().plan!.steps.filter((step) => step.key !== 'review') },
  ...overrides,
})

const board = (tasks: ReadonlyArray<BoardTask>): BoardSnapshot => ({ cursor: 1, tasks: [...tasks], calls: [], settledTotal: 0 })

const shown = (task: BoardTask, client = fakeClient().client) => {
  withServices(<BoardView lanes={lanesOf(board([task]))} agents={agents} now={NOW} onOpen={() => {}} />, client)
}

afterEach(cleanup)

describe('the review a change is offered', () => {
  it('is a quiet line on its card, naming the reviewer, and adds nothing by itself', () => {
    const { client } = fakeClient()
    shown(offered(), client)
    const row = within(screen.getByText('Add a review?').closest('div') as HTMLElement)
    expect(row.getByRole('button', { name: /^Add / })).toBeTruthy()
    expect(row.getByRole('button', { name: 'No thanks' })).toBeTruthy()
    expect(client.changeTeam).not.toHaveBeenCalled()
    expect(client.declineReview).not.toHaveBeenCalled()
  })

  it('adds the reviewer it names through the team’s own command, keeping the lead', async () => {
    const { client } = fakeClient()
    shown(offered(), client)
    await userEvent.click(screen.getByRole('button', { name: /^Add / }))
    await waitFor(() =>
      expect(client.changeTeam).toHaveBeenCalledWith('r', [
        { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
        { key: 'review', agentId: 'codex', model: null, skipped: false },
      ]),
    )
  })

  it('is turned down with No thanks, and says why where that fails', async () => {
    const { client } = fakeClient()
    vi.mocked(client.declineReview).mockRejectedValueOnce(new Error('The runtime is busy.'))
    shown(offered(), client)
    await userEvent.click(screen.getByRole('button', { name: 'No thanks' }))
    await waitFor(() => expect(client.declineReview).toHaveBeenCalledWith('r'))
    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('is not on a card that has no offer', () => {
    shown(offered({ reviewOffer: undefined }))
    expect(screen.queryByText('Add a review?')).toBeNull()
  })
})
