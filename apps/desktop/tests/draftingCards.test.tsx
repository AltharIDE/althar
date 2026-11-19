import { act, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Draft, ThreadItem } from '@althar/contracts'
import { expect, it, vi } from 'vitest'

import { DraftingCard, phaseOf, useDraftingCards } from '../src/renderer/features/project/DraftingCard'
import { card, fakeClient, items } from './fixtures'
import { withServices } from './render'

const lead = { agentId: 'claude-code', model: null, effort: null }
const review = { agentId: 'codex', model: null, effort: null }
const draft = (more: Partial<Draft> = {}): Draft => ({
  key: 'draft_1',
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
  ...more,
})

it('describes the incoming draft through its brief, sizing, team and completed plan', () => {
  expect(phaseOf(draft())).toBe('writing')
  expect(phaseOf(draft({ brief: true }))).toBe('sizing')
  expect(phaseOf(draft({ brief: true, planning: true }))).toBe('lead')
  expect(phaseOf(draft({ brief: true, planning: true, lead }))).toBe('review')
  expect(phaseOf(draft({ brief: true, planned: true, lead }))).toBe('end')
  expect(phaseOf(draft({ brief: true, planning: true, lead, noReview: true }))).toBe('end')
  expect(phaseOf(draft({ brief: true, planning: true, lead, review }))).toBe('end')
})

it('replaces a streaming draft’s stand-in only with its own durable task card', () => {
  const pending = draft()
  const planned = draft({ key: 'draft_2', taskId: 't2' })
  const hold = vi.fn(async () => {})
  const earlier = [items.says('An earlier message'), items.card(card({ taskId: 'other' }))]
  const hook = renderHook(({ committed }: { committed: ThreadItem[] }) => useDraftingCards('th1', [pending, planned], committed, hold), {
    initialProps: { committed: earlier },
  })
  // Only the one not yet a task is after the thread; the task stands in it, its card not read yet.
  expect(hook.result.current.shown).toEqual([pending])
  expect(hook.result.current.placed.map((item) => item.id)).toEqual([...earlier.map((item) => item.id), 'drafting:t2'])
  const own = items.card(card({ taskId: 't2' }))
  hook.rerender({ committed: [...earlier, own] })
  expect(hook.result.current.placed.map((item) => item.id)).toEqual([...earlier, own].map((item) => item.id))
  expect(hook.result.current.shown).toEqual([pending])
  expect(hold).not.toHaveBeenCalled()
})

it('keeps a draft that became a task above what the person says before its card is read', () => {
  // As the reviewer put it: the draft heard as a task, its card's read still on its way, the person steers.
  const said = items.says('Drafting two tasks')
  const sizing = draft({ key: 'draft_1', taskId: 't1', slug: 'explore-the-roles', title: 'Explore the roles', brief: true })
  const hold = vi.fn(async () => {})
  const hook = renderHook(({ thread }: { thread: ThreadItem[] }) => useDraftingCards('th1', [sizing], thread, hold), {
    initialProps: { thread: [said] },
  })
  expect(hook.result.current.placed.map((item) => item.id)).toEqual([said.id, 'drafting:t1'])
  // Their message, shown at once: after the draft, not above it.
  const message = items.you('you dont need to split these')
  hook.rerender({ thread: [said, message] })
  expect(hook.result.current.placed.map((item) => item.id)).toEqual([said.id, 'drafting:t1', message.id])
  const stand = hook.result.current.placed[1]
  expect(stand?.kind === 'task' && hook.result.current.inPlace(stand.content)).toEqual(sizing)
  // Its card read, where the runtime posted it, before the message: the same place.
  const own = items.card(card({ taskId: 't1', phase: 'drafting' }))
  hook.rerender({ thread: [said, own, message] })
  expect(hook.result.current.placed.map((item) => item.id)).toEqual([said.id, own.id, message.id])
  expect(hook.result.current.inPlace(card({ taskId: 't1', phase: 'drafting' }))).toEqual(sizing)
})

it('says a card read as being drafted, with nothing live to fill it, is being drafted, and holds it by its task', () => {
  const hold = vi.fn(async () => {})
  const hook = renderHook(() => useDraftingCards('th1', [], [], hold))
  const drafting = hook.result.current.inPlace(card({ taskId: 't1', slug: 'explore', title: 'Explore', phase: 'drafting', plan: null }))
  expect(drafting).toMatchObject({ key: 'task:t1', taskId: 't1', title: 'Explore', brief: true, planned: false })
  expect(drafting === undefined ? 'none' : phaseOf(drafting)).toBe('sizing')
  act(() => hook.result.current.hold(drafting ?? draft()))
  expect(hold).toHaveBeenCalledWith('th1', 'task:t1')
  // No plan came, or discarded: the card says so itself.
  expect(hook.result.current.inPlace(card({ taskId: 't1', phase: 'drafting', unplanned: true }))).toBeUndefined()
  expect(hook.result.current.inPlace(card({ taskId: 't1', phase: 'settled', discarded: true }))).toBeUndefined()
})

it('shows a draft in its card’s place in the thread, above what the person said since, until its plan is in', () => {
  // As the person saw it: a message sent while two drafts were sized sat above them, the drafts drawn after the thread.
  const sizing = draft({ key: 'draft_1', taskId: 't1', slug: 'explore-the-roles', title: 'Explore the roles', brief: true })
  const writing = draft({ key: 'draft_2' })
  const hold = vi.fn(async () => {})
  const thread = [items.card(card({ taskId: 't1' })), items.says('you dont need to split these')]
  const hook = renderHook(({ drafts }: { drafts: Draft[] }) => useDraftingCards('th1', drafts, thread, hold), {
    initialProps: { drafts: [sizing, writing] },
  })
  // Its card is in the thread where it was drafted, before the message: the draft fills it there, not after the thread.
  expect(hook.result.current.inPlace(card({ taskId: 't1' }))).toEqual(sizing)
  expect(hook.result.current.shown).toEqual([writing])
  // One not yet a task has no card: it alone shows after the thread.
  expect(hook.result.current.inPlace(card({ taskId: 't2' }))).toBeUndefined()
  // Its plan in, the card shows it, in the same place.
  hook.rerender({ drafts: [{ ...sizing, planned: true }, writing] })
  expect(hook.result.current.inPlace(card({ taskId: 't1' }))).toBeUndefined()
  expect(hook.result.current.shown).toEqual([writing])
})

it('does not send a Hold without a thread and honours a hold already read from the home', () => {
  const held = draft({ held: true })
  const hold = vi.fn(async () => {})
  const hook = renderHook(() => useDraftingCards(null, [held], [], hold))
  act(() => hook.result.current.hold(held))
  expect(hold).not.toHaveBeenCalled()
  expect(hook.result.current.held(held)).toBe(true)
  expect(hook.result.current.held(draft())).toBe(false)
})

function StreamingCard({ one, hold }: { one: Draft; hold: (threadId: string, key: string) => Promise<void> }) {
  const model = useDraftingCards('th1', [one], [], hold)
  return <DraftingCard draft={one} project="Meridian" held={model.held(one)} onHold={() => model.hold(one)} />
}

it('holds the card at once while the remote acknowledgement is pending and restores its action if refused', async () => {
  let refuse!: (error: Error) => void
  const hold = vi.fn(
    () =>
      new Promise<void>((_resolve, reject) => {
        refuse = reject
      }),
  )
  const { client } = fakeClient()
  const one = draft({ title: 'Build the checkout' })
  withServices(<StreamingCard one={one} hold={hold} />, client)
  expect(screen.getByText('Build the checkout')).not.toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Hold' }))
  expect(hold).toHaveBeenCalledExactlyOnceWith('th1', one.key)
  expect(screen.getByText('Held · starts when you say')).not.toBeNull()
  expect(screen.queryByRole('button', { name: 'Hold' })).toBeNull()
  await act(async () => refuse(new Error('The home refused the hold.')))
  expect(await screen.findByRole('button', { name: 'Hold' })).not.toBeNull()
})

it('keeps an accepted Hold over an older draft read, while the plan continues to arrive', async () => {
  const hold = vi.fn(async () => {})
  const one = draft()
  const hook = renderHook(({ next }) => useDraftingCards('th1', [next], [], hold), { initialProps: { next: one } })
  act(() => hook.result.current.hold(one))
  await waitFor(() => expect(hold).toHaveBeenCalledOnce())
  const older = draft({ title: 'The title arrived' })
  hook.rerender({ next: older })
  expect(hook.result.current.held(older)).toBe(true)
})

it('draws a completed team or a plan without a review with their selected models and preset', async () => {
  const { client } = fakeClient()
  const view = withServices(
    <DraftingCard
      draft={draft({ title: 'Ship it', slug: 'ship-it', brief: true, planned: true, lead, review, preset: 'Thorough' })}
      project="Meridian"
      held
      onHold={() => {}}
    />,
    client,
  )
  expect(screen.getByText('Thorough')).not.toBeNull()
  expect(screen.getByText('Ship it')).not.toBeNull()
  expect(screen.getByText('Held · starts when you say')).not.toBeNull()
  view.unmount()
  withServices(
    <DraftingCard
      draft={draft({ title: 'Only implement', brief: true, planning: true, lead, noReview: true })}
      project="Meridian"
      held={false}
      onHold={() => {}}
    />,
    client,
  )
  expect(screen.getByText('Only implement')).not.toBeNull()
  expect(screen.queryByText('Review')).toBeNull()
  expect(screen.getByRole('button', { name: 'Hold' })).not.toBeNull()
})

const coverageDraft = draft({ key: 'draft' })
const coverageLead = { agentId: 'claude-code', model: 'claude-opus-5-5', effort: null }
it('follows drafting through brief, sizing, lead, review and ending, allowing review to be omitted', () => {
  expect(phaseOf(coverageDraft)).toBe('writing')
  expect(phaseOf({ ...coverageDraft, brief: true })).toBe('sizing')
  expect(phaseOf({ ...coverageDraft, brief: true, planning: true })).toBe('lead')
  expect(phaseOf({ ...coverageDraft, brief: true, planning: true, lead: coverageLead })).toBe('review')
  expect(phaseOf({ ...coverageDraft, brief: true, planning: true, lead: coverageLead, noReview: true })).toBe('end')
  expect(phaseOf({ ...coverageDraft, brief: true, planned: true, lead: coverageLead })).toBe('end')
  expect(phaseOf({ ...coverageDraft, brief: true, planning: true, lead: coverageLead, review: coverageLead })).toBe('end')
})

it('holds a draft immediately, restores runtime state on refusal, and replaces it only with its own task card', async () => {
  let reject!: (error: Error) => void
  const hold = vi.fn(
    () =>
      new Promise<void>((_, no) => {
        reject = no
      }),
  )
  const own = { ...coverageDraft, taskId: 'own' }
  const other = { ...coverageDraft, key: 'other', taskId: 'other' }
  const cards = [items.card({ ...card(), taskId: 'other' }), items.you('Plan it')]
  const hook = renderHook(({ threadId }) => useDraftingCards(threadId, [own, other, coverageDraft], cards, hold), {
    initialProps: { threadId: 'thread' as string | null },
  })
  expect(hook.result.current.shown).toEqual([coverageDraft])
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
  const view = withServices(<DraftingCard draft={coverageDraft} project="Project" held={false} onHold={hold} />, client)
  await userEvent.click(await screen.findByRole('button', { name: /Hold/ }))
  expect(hold).toHaveBeenCalledOnce()
  view.unmount()
  withServices(
    <DraftingCard
      draft={{
        ...coverageDraft,
        title: 'Build it',
        slug: 'build-it',
        preset: 'Change',
        lead: coverageLead,
        review: coverageLead,
        brief: true,
        planning: true,
      }}
      project="Project"
      held
      onHold={hold}
    />,
    client,
  )
  await waitFor(() => expect(screen.getByText('Build it')).not.toBeNull())
})
