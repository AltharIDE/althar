import { act, renderHook, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { BoardTask, Draft, ThreadItem } from '@althar/contracts'

import { BoardView } from '../src/renderer/features/board/BoardView'
import { lanesOf } from '../src/renderer/features/board/lanes'
import { Card, type CardActions } from '../src/renderer/features/project/Card'
import { DraftingCard } from '../src/renderer/features/project/DraftingCard'
import { agents, card, fakeClient } from './fixtures'
import { withServices } from './render'
import { type PlanAsk, planAskIn, planAskNow, planIt, planStillAsked, usePlansAsked } from '../src/renderer/shared/planIt'

/*
 * A task that never began says where it stands, wherever the person sees it:
 * drafted with no plan, it says so rather than sizing for ever, and offers to
 * plan or discard it; discarded, from a draft, a plan or a held plan, it says
 * so, and leaves Up next.
 */

const NOW = '2026-01-15T10:00:00.000Z'

const draft = (more: Partial<Draft> = {}): Draft => ({
  key: 'draft_1',
  title: 'Explore: what the team looks like before multiplayer',
  brief: true,
  taskId: 't5',
  slug: 'explore-the-team',
  planning: false,
  lead: null,
  review: null,
  noReview: false,
  preset: null,
  planned: false,
  held: true,
  ...more,
})

const actions = (more: Partial<CardActions> = {}): CardActions => ({
  project: 'meridian',
  agents,
  agentName: (id) => id ?? '',
  onStart: vi.fn(),
  onHold: vi.fn(),
  onChange: vi.fn(),
  onCreateBranch: vi.fn(),
  onOpen: vi.fn(),
  onStopBackground: vi.fn(),
  ...more,
})

describe('a draft whose plan did not come, while the coordinator is still at work', () => {
  it('says it has no plan, rather than sizing it, and offers to plan or discard it', async () => {
    const onPlan = vi.fn()
    const onDiscard = vi.fn(async () => {})
    withServices(
      <DraftingCard draft={draft({ unplanned: true })} project="Meridian" held onHold={vi.fn()} onPlan={onPlan} onDiscard={onDiscard} />,
      fakeClient().client,
    )
    expect(screen.getByText('No plan yet')).toBeTruthy()
    expect(screen.queryByText(/Sizing it/)).toBeNull()
    expect(screen.queryByText('Held · starts when you say')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Plan it' }))
    expect(onPlan).toHaveBeenCalledWith({
      taskId: 't5',
      title: 'Explore: what the team looks like before multiplayer',
      slug: 'explore-the-team',
    })
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onDiscard).toHaveBeenCalledWith('t5')
    expect(screen.getByText('Discarded')).toBeTruthy()
  })

  it('shows Discard at once, and as it was again where the runtime turns it down', async () => {
    let refuse: (why: Error) => void = () => {}
    const onDiscard = vi.fn(() => new Promise<void>((_, reject) => (refuse = reject)))
    withServices(
      <DraftingCard draft={draft({ unplanned: true })} project="Meridian" held onHold={vi.fn()} onPlan={vi.fn()} onDiscard={onDiscard} />,
      fakeClient().client,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.getByText('Discarded')).toBeTruthy()
    refuse(new Error('no'))
    expect(await screen.findByText('No plan yet')).toBeTruthy()
  })

  it('says it was discarded, wherever that was done, with nothing going on', () => {
    const { container } = withServices(
      <DraftingCard draft={draft({ discarded: true })} project="Meridian" held onHold={vi.fn()} onPlan={vi.fn()} onDiscard={vi.fn()} />,
      fakeClient().client,
    )
    expect(screen.getByText('Discarded')).toBeTruthy()
    expect(screen.queryByText(/Sizing it/)).toBeNull()
    expect(screen.queryByText('Held · starts when you say')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(container.querySelector('[aria-busy="true"]')).toBeNull()
  })
})

describe('Plan it, asked', () => {
  const askedAt = Date.parse(NOW)
  const at = (seconds: number) => new Date(askedAt + seconds * 1000).toISOString()

  // The session as the runtime gives it (Sessions.running): its turn's start only while it runs, its last end kept.
  const running = (endedAt: string | null) => ({ turnRunning: true, turnStartedAt: at(1), turnEndedAt: endedAt })
  const idle = (endedAt: string | null) => ({ turnRunning: false, turnStartedAt: null, turnEndedAt: endedAt })
  const task = { title: 'Explore the team', slug: 'explore-the-team' }
  const message = (state: 'queued' | 'delivered' | 'withdrawn', text = planIt(task)) =>
    ({
      id: `m-${state}`,
      sequence: 1,
      agentId: null,
      createdAt: NOW,
      kind: 'user_message',
      content: { text, links: [], pictures: [], files: [] },
      input: { state, interrupting: false },
    }) as const

  it('is on its way until the coordinator turn that took the ask is over, as its session goes from running to idle', () => {
    // Sent, not in the thread yet: on its way.
    expect(planStillAsked(askedAt, planAskIn([], task)?.input, idle(at(-60)))).toBe(true)
    // Waiting behind a turn still going when it was asked, which then ends: the ask waits its own.
    expect(planStillAsked(askedAt, planAskIn([message('queued')], task)?.input, running(null))).toBe(true)
    expect(planStillAsked(askedAt, planAskIn([message('queued')], task)?.input, idle(at(5)))).toBe(true)
    // Taken by a turn still going.
    expect(planStillAsked(askedAt, planAskIn([message('delivered')], task)?.input, running(at(5)))).toBe(true)
    // Taken, and just delivered: the turn that took it not begun yet, the last that ended before the ask.
    expect(planStillAsked(askedAt, planAskIn([message('delivered')], task)?.input, idle(at(-60)))).toBe(true)
    // That turn over, and the session idle, its start gone: where no plan came, Plan it is offered again.
    expect(planStillAsked(askedAt, planAskIn([message('delivered')], task)?.input, idle(at(40)))).toBe(false)
    // Taken back before the coordinator had it: no ask.
    expect(planStillAsked(askedAt, planAskIn([message('withdrawn')], task)?.input, running(null))).toBe(false)
    // Only its own words count, the newest so worded.
    expect(planAskIn([message('delivered', 'Something else')], task)).toBeUndefined()
    expect(planAskIn([message('delivered'), message('queued')], task)?.input?.state).toBe('queued')
    // One there before the ask is an earlier ask's, not this one's.
    expect(planAskIn([message('delivered')], { ...task, before: 'm-delivered' })).toBeUndefined()
  })

  it('follows its own message, not the thread as it shows: over once its turn is, cleared from view or not', () => {
    const ask: PlanAsk = { at: askedAt, ...task, before: null, seen: false }
    // Not in the thread yet: on its way, never seen.
    expect(planAskNow(ask, [], idle(at(-60)))).toEqual({ still: true, seen: false })
    // In the thread, taken by a turn still going: seen.
    expect(planAskNow(ask, [message('delivered')], running(at(-60)))).toEqual({ still: true, seen: true })
    const seen = { ...ask, seen: true }
    // The thread cleared from view while that turn goes on: still on its way, by the turn.
    expect(planAskNow(seen, [], running(at(-60))).still).toBe(true)
    // Cleared, and the turn that took it over: Plan it is offered again, rather than hidden for good.
    expect(planAskNow(seen, [], idle(at(40))).still).toBe(false)
    // An earlier ask's message, there at the press, is not this one: this one is on its way until its own shows.
    expect(planAskNow({ ...ask, before: 'm-delivered' }, [message('delivered')], idle(at(40)))).toEqual({ still: true, seen: false })
  })

  it('lets an ask go once it is over, so neither a later turn nor clearing the thread from view hides Plan it again', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(askedAt)
    const one = { taskId: 't5', ...task }
    type Shown = { items: ReadonlyArray<ThreadItem>; session: Parameters<typeof usePlansAsked>[1] }
    const { result, rerender } = renderHook(({ items, session }: Shown) => usePlansAsked(items, session), {
      initialProps: { items: [], session: idle(at(-60)) } as Shown,
    })
    act(() => result.current.ask(one))
    expect(result.current.asked('t5')).toBe(true)
    // Taken by a turn, which ends with no plan: Plan it is offered again.
    rerender({ items: [message('delivered')], session: running(at(-60)) })
    expect(result.current.asked('t5')).toBe(true)
    rerender({ items: [message('delivered')], session: idle(at(40)) })
    expect(result.current.asked('t5')).toBe(false)
    // A later turn on something else: still offered.
    rerender({ items: [message('delivered')], session: running(at(40)) })
    expect(result.current.asked('t5')).toBe(false)
    // The thread cleared from view after it: still offered.
    rerender({ items: [], session: idle(at(90)) })
    expect(result.current.asked('t5')).toBe(false)

    // Asked again, its message seen, then the thread cleared while its turn runs: hidden until that turn is over.
    vi.setSystemTime(askedAt + 60_000)
    act(() => result.current.ask(one))
    rerender({ items: [message('queued')], session: running(at(90)) })
    rerender({ items: [], session: running(at(90)) })
    expect(result.current.asked('t5')).toBe(true)
    rerender({ items: [], session: idle(at(100)) })
    expect(result.current.asked('t5')).toBe(false)
    vi.useRealTimers()
  })

  it('is offered again on both cards once the ask is no longer on its way', () => {
    const planAsked = vi.fn(() => true)
    const thread = () => (
      <Card
        card={card({ taskId: 't5', slug: 'explore-the-team', title: 'Explore the team', phase: 'stopped', plan: null, unplanned: true })}
        actions={actions({ onPlanDraft: vi.fn(), onDiscard: vi.fn(), planAsked })}
      />
    )
    const live = () => (
      <DraftingCard
        draft={draft({ unplanned: true })}
        project="Meridian"
        held
        onHold={vi.fn()}
        onPlan={vi.fn()}
        planAsked={planAsked}
        onDiscard={vi.fn()}
      />
    )
    for (const shown of [thread, live]) {
      planAsked.mockReturnValue(true)
      // Drawn again as the window draws it when the turn or the ask changes.
      let redraw: () => void = () => {}
      function Shown() {
        const [, setDrawn] = useState(0)
        redraw = () => setDrawn((n) => n + 1)
        return shown()
      }
      const { unmount } = withServices(<Shown />, fakeClient().client)
      // Asked, and on its way: not offered twice.
      expect(screen.queryByRole('button', { name: 'Plan it' })).toBeNull()
      expect(screen.getByText('No plan yet')).toBeTruthy()
      // Not sent, or the turn that took it ended with no plan: offered again.
      planAsked.mockReturnValue(false)
      act(() => redraw())
      expect(screen.getByRole('button', { name: 'Plan it' })).toBeTruthy()
      expect(planAsked).toHaveBeenCalledWith('t5')
      unmount()
    }
  })
})

describe("a task's card in the thread, never begun", () => {
  it('says a draft has no plan once the turn is over, and asks the coordinator to plan it', async () => {
    const onPlanDraft = vi.fn()
    const onDiscard = vi.fn(async () => {})
    withServices(
      <Card
        card={card({ taskId: 't5', slug: 'explore-the-team', title: 'Explore the team', phase: 'stopped', plan: null, unplanned: true })}
        actions={actions({ onPlanDraft, onDiscard })}
      />,
      fakeClient().client,
    )
    expect(screen.getByText('No plan yet')).toBeTruthy()
    expect(screen.queryByText('Stopped')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Plan it' }))
    expect(onPlanDraft).toHaveBeenCalledWith({ taskId: 't5', title: 'Explore the team', slug: 'explore-the-team' })
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onDiscard).toHaveBeenCalledWith('t5')
    expect(screen.getByText('Discarded')).toBeTruthy()
  })

  it('says a held plan was discarded where it said when it starts, naming its preset, with nothing to start', () => {
    const held = card()
    withServices(
      <Card
        card={card({ phase: 'settled', discarded: true, startedAt: null, plan: { ...held.plan!, startsAt: null, preset: 'Prototype' } })}
        actions={actions({ onPlanDraft: vi.fn(), onDiscard: vi.fn() })}
      />,
      fakeClient().client,
    )
    expect(screen.getByText('Discarded')).toBeTruthy()
    expect(screen.getByText('Prototype')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Start/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Plan it' })).toBeNull()
    expect(screen.queryByText(/Starts when you say|Held/)).toBeNull()
  })

  it('says a task discarded once at work was discarded, not that it is ready', () => {
    withServices(
      <Card card={card({ phase: 'settled', discarded: true, startedAt: '2026-01-15T09:00:00.000Z' })} actions={actions()} />,
      fakeClient().client,
    )
    expect(screen.getByText('Discarded')).toBeTruthy()
    expect(screen.queryByText('Ready')).toBeNull()
  })
})

describe('the board', () => {
  const task = (more: Partial<BoardTask>): BoardTask => ({
    ...card(),
    state: 'open',
    createdAt: '2026-01-15T09:00:00.000Z',
    settledAt: null,
    changed: null,
    here: [],
    ...more,
  })

  it('says a draft with no plan has none, and offers to plan it, rather than Resume', async () => {
    const sendBack = vi.fn(async () => true)
    const unplanned = task({
      taskId: 't5',
      threadId: 'th5',
      title: 'Explore the team',
      phase: 'stopped',
      state: 'draft',
      plan: null,
      unplanned: true,
      stopped: { by: null, at: '2026-01-15T09:30:00.000Z' },
    })
    const lanes = lanesOf({ cursor: 1, tasks: [unplanned], calls: [], settledTotal: 0 })
    withServices(
      <BoardView
        lanes={lanes}
        agents={agents}
        now={NOW}
        onOpen={vi.fn()}
        actions={{
          push: vi.fn(async () => true),
          merge: vi.fn(async () => true),
          pushing: new Set<string>(),
          merging: new Set<string>(),
          failed: {},
          sendBack,
          sending: new Set<string>(),
        }}
      />,
      fakeClient().client,
    )
    const it = within(screen.getByRole('button', { name: 'Explore the team' }).closest('article') as HTMLElement)
    expect(it.getByText('No plan yet')).toBeTruthy()
    expect(it.queryByText('Stopped')).toBeNull()
    expect(it.queryByRole('button', { name: 'Resume' })).toBeNull()
    await userEvent.click(it.getByRole('button', { name: 'Plan it' }))
    await waitFor(() => expect(sendBack).toHaveBeenCalledWith(unplanned, expect.any(String), true))
  })

  it('leaves a discarded task out of Up next, whether it was held or a draft with no plan', () => {
    const held = card()
    const lanes = lanesOf({
      cursor: 1,
      tasks: [
        task({ taskId: 'h', phase: 'settled', state: 'abandoned', discarded: true, plan: { ...held.plan!, startsAt: null } }),
        task({ taskId: 'd', phase: 'settled', state: 'abandoned', discarded: true, plan: null }),
      ],
      calls: [],
      settledTotal: 2,
    })
    expect(lanes.next).toEqual([])
    expect(lanes.stopped).toEqual([])
    expect(lanes.settled.map((one) => one.taskId)).toEqual(['h', 'd'])
  })
})
