import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BoardTask } from '@althar/contracts'

import { ReviewOfferOf } from '../src/renderer/features/team/ReviewOfferOf'
import { card, change, fakeClient } from './fixtures'
import { withServices } from './render'

/*
 * A review a lead or the coordinator offered a task (`offer_review`), as the person asked to harden a prototype: a quiet line of the
 * thread, by its reviewer. It adds nothing by itself: Add goes through the team's own command, No thanks turns it down, and once
 * answered the line says what came of it, as the task's card has it.
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

const OFFER_STEP = { key: 'review', agentId: 'codex', model: null, skipped: false } as const
const OFFER = { kind: 'review', projectId: 'p', taskId: 'r', agentId: 'codex', model: null } as const

const shown = (task: BoardTask, client = fakeClient().client) => {
  vi.mocked(client.getBoard).mockResolvedValue({ cursor: 1, tasks: [task], calls: [], settledTotal: 0 })
  withServices(<ReviewOfferOf offer={OFFER} />, client)
}

afterEach(cleanup)

describe('a review offered in the thread', () => {
  it('is a quiet line, naming the reviewer, and adds nothing by itself', async () => {
    const { client } = fakeClient()
    shown(offered(), client)
    const row = within((await screen.findByText('Add a review?')).closest('div') as HTMLElement)
    expect(row.getByRole('button', { name: /^Add / })).toBeTruthy()
    expect(row.getByRole('button', { name: 'No thanks' })).toBeTruthy()
    expect(client.changeTeam).not.toHaveBeenCalled()
    expect(client.declineReview).not.toHaveBeenCalled()
  })

  it('adds the reviewer it names through the team’s own command, keeping the lead', async () => {
    const { client } = fakeClient()
    shown(offered(), client)
    await userEvent.click(await screen.findByRole('button', { name: /^Add / }))
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
    await userEvent.click(await screen.findByRole('button', { name: 'No thanks' }))
    await waitFor(() => expect(client.declineReview).toHaveBeenCalledWith('r'))
    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('says who reviews it once added, without its buttons', async () => {
    shown(
      offered({
        reviewOffer: undefined,
        plan: { ...card().plan!, steps: [...card().plan!.steps.filter((step) => step.key !== 'review'), OFFER_STEP] },
      }),
    )
    expect(await screen.findByText(/reviews it\.$/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('says there is no review once turned down, and offers nothing again', async () => {
    shown(offered({ reviewOffer: undefined }))
    expect(await screen.findByText('No review.')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
