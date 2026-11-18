import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { BoardTask, Draft } from '@althar/contracts'

import { BoardView } from '../src/renderer/features/board/BoardView'
import { lanesOf } from '../src/renderer/features/board/lanes'
import { Card, type CardActions } from '../src/renderer/features/project/Card'
import { DraftingCard } from '../src/renderer/features/project/DraftingCard'
import { agents, card, fakeClient } from './fixtures'
import { withServices } from './render'

/*
 * A task that never began says where it stands, wherever the person sees it:
 * drafted with no plan, it says so rather than sizing for ever, and offers to
 * plan or discard it; discarded, from a draft, a plan or a held plan, it says
 * so, and leaves Up next.
 */

const NOW = '2026-11-18T10:00:00.000Z'

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
    // Asked once: it isn't offered again while the plan comes.
    expect(screen.queryByRole('button', { name: 'Plan it' })).toBeNull()
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
    expect(onPlanDraft).toHaveBeenCalledWith({ title: 'Explore the team', slug: 'explore-the-team' })
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
      <Card card={card({ phase: 'settled', discarded: true, startedAt: '2026-11-18T09:00:00.000Z' })} actions={actions()} />,
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
    createdAt: '2026-11-18T09:00:00.000Z',
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
      stopped: { by: null, at: '2026-11-18T09:30:00.000Z' },
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
