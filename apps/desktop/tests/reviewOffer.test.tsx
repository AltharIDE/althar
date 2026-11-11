import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BoardTask } from '@althar/contracts'

import { ReviewOfferOf } from '../src/renderer/features/team/ReviewOfferOf'
import { card, change, fakeClient } from './fixtures'
import { withServices } from './render'

/*
 * The review a change is offered once, as its work turns real: a quiet line in its task view, by the composer, with the reviewer the rules would
 * pick. It adds nothing by itself: Add goes through the team's own command, No thanks turns it down.
 */

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

const shown = (task: BoardTask, client = fakeClient().client) => {
  withServices(<ReviewOfferOf work={task} />, client)
}

afterEach(cleanup)

describe('the review a change is offered', () => {
  it('is a quiet line, naming the reviewer, and adds nothing by itself', () => {
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

  it('is nothing where there is no offer', () => {
    shown(offered({ reviewOffer: undefined }))
    expect(screen.queryByText('Add a review?')).toBeNull()
  })
})
