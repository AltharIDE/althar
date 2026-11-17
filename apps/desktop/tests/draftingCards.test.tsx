import { act, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import type { Draft } from '@althar/contracts'

import { DraftingCard, phaseOf, useDraftingCards } from '../src/renderer/features/project/DraftingCard'
import { fakeClient, items, card } from './fixtures'
import { withServices } from './render'

const draft: Draft = {
  key: 'draft',
  title: null,
  brief: false,
  taskId: null,
  slug: null,
  planning: false,
  lead: null,
  review: null,
  noReview: false,
  preset: null,
  planned: false,
  held: false,
}
const lead = { agentId: 'claude-code', model: 'claude-opus-5-5', effort: null }
it('follows drafting through brief, sizing, lead, review and ending, allowing review to be omitted', () => {
  expect(phaseOf(draft)).toBe('writing')
  expect(phaseOf({ ...draft, brief: true })).toBe('sizing')
  expect(phaseOf({ ...draft, brief: true, planning: true })).toBe('lead')
  expect(phaseOf({ ...draft, brief: true, planning: true, lead })).toBe('review')
  expect(phaseOf({ ...draft, brief: true, planning: true, lead, noReview: true })).toBe('end')
  expect(phaseOf({ ...draft, brief: true, planned: true, lead })).toBe('end')
  expect(phaseOf({ ...draft, brief: true, planning: true, lead, review: lead })).toBe('end')
})

it('holds a draft immediately, restores runtime state on refusal, and replaces it only with its own task card', async () => {
  let reject!: (error: Error) => void
  const hold = vi.fn(
    () =>
      new Promise<void>((_, no) => {
        reject = no
      }),
  )
  const own = { ...draft, taskId: 'own' }
  const other = { ...draft, key: 'other', taskId: 'other' }
  const cards = [items.card({ ...card(), taskId: 'other' }), items.you('Plan it')]
  const hook = renderHook(({ threadId }) => useDraftingCards(threadId, [own, other, draft], cards, hold), {
    initialProps: { threadId: 'thread' as string | null },
  })
  expect(hook.result.current.shown).toEqual([own, draft])
  act(() => hook.result.current.hold(own))
  expect(hook.result.current.held(own)).toBe(true)
  expect(hold).toHaveBeenCalledWith('thread', 'draft')
  await act(async () => reject(new Error('Refused')))
  expect(hook.result.current.held(own)).toBe(false)
  expect(hook.result.current.held({ ...own, held: true })).toBe(true)
  hook.rerender({ threadId: null })
  act(() => hook.result.current.hold(own))
  expect(hold).toHaveBeenCalledOnce()
})

it('renders a drafting plan with its selected lead and can hold it before it is complete', async () => {
  const { client } = fakeClient()
  const hold = vi.fn()
  const view = withServices(<DraftingCard draft={draft} project="Project" held={false} onHold={hold} />, client)
  await userEvent.click(await screen.findByRole('button', { name: /Hold/ }))
  expect(hold).toHaveBeenCalledOnce()
  view.unmount()
  withServices(
    <DraftingCard
      draft={{ ...draft, title: 'Build it', slug: 'build-it', preset: 'Change', lead, review: lead, brief: true, planning: true }}
      project="Project"
      held
      onHold={hold}
    />,
    client,
  )
  await waitFor(() => expect(screen.getByText('Build it')).not.toBeNull())
})
