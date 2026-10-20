import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CODEX, OPUS } from '../src/fixtures/models'
import { GraphNodeState } from '../src/foundations/vocabulary'
import { StepGraph, type StepGraphLane, type StepGraphStep } from '../src/thread/StepGraph/StepGraph'
import {
  across,
  CARD,
  fitView,
  isCurrent,
  LANE,
  layoutOf,
  nowView,
  openingView,
  showing,
  zoomAbout,
  ZOOM,
} from '../src/thread/StepGraph/layout'

const LANES = [{ id: 'lead' }, { id: 'reviewer' }, { id: 'althar' }]
const step = (id: string, lane: string, round: string, state: GraphNodeState) => ({ id, lane, round, state })
const LOOP = [
  step('implement', 'lead', 'r1', GraphNodeState.Done),
  step('review-1', 'reviewer', 'r1', GraphNodeState.Done),
  step('settle-1', 'lead', 'r1', GraphNodeState.Now),
  step('review-2', 'reviewer', 'r1', GraphNodeState.Next),
  step('publish', 'althar', 'r1', GraphNodeState.Next),
]

describe('where a task’s graph puts things', () => {
  it('puts each step in its lane’s row and its own column, in the order given', () => {
    const layout = layoutOf(LANES, LOOP)
    const [implement, review, settle] = layout.cards
    expect(layout.cards.map((card) => card.id)).toEqual(LOOP.map((one) => one.id))
    // Columns step right; rows are the lanes', a card in the middle of its lane.
    expect(review!.x - implement!.x).toBe(settle!.x - review!.x)
    expect(review!.y - implement!.y).toBe(LANE)
    expect(settle!.y).toBe(implement!.y)
    expect(layout.lanes.map((lane) => lane.y)).toEqual([40, 40 + LANE, 40 + 2 * LANE])
    expect(layout.h).toBe(80 + 3 * LANE)
  })

  it('draws a line into each card but the first, its look from where it goes', () => {
    const layout = layoutOf(LANES, [
      ...LOOP.slice(0, 2),
      step('settle-1', 'lead', 'r1', GraphNodeState.Waiting),
      step('review-2', 'reviewer', 'r1', GraphNodeState.Proposed),
      step('publish', 'althar', 'r1', GraphNodeState.Now),
      step('follow-up', 'lead', 'r2', GraphNodeState.Next),
      step('review-3', 'reviewer', 'r2', GraphNodeState.Next),
    ])
    expect(layout.edges.map((edge) => [edge.id, edge.look])).toEqual([
      ['review-1', 'done'],
      ['settle-1', 'you'],
      ['review-2', 'you'],
      ['publish', 'live'],
      ['follow-up', 'round'],
      ['review-3', 'next'],
    ])
  })

  it('runs a line straight along a lane, and across at right angles with rounded corners between lanes', () => {
    expect(across(0, 10, 50, 10)).toBe('M 0 10 H 50')
    expect(across(0, 10, 100, 110)).toBe('M 0 10 H 68 Q 76 10 76 18 V 102 Q 76 110 84 110 H 100')
    // Going up, and between rows too close for a whole corner.
    expect(across(0, 110, 100, 10)).toBe('M 0 110 H 68 Q 76 110 76 102 V 18 Q 76 10 84 10 H 100')
    expect(across(0, 10, 100, 14)).toBe('M 0 10 H 74 Q 76 10 76 12 V 12 Q 76 14 78 14 H 100')
  })

  it('opens a wider gap where a round starts, each round reaching to the line before the next', () => {
    const layout = layoutOf(LANES, [...LOOP.slice(0, 2), step('follow-up', 'lead', 'r2', GraphNodeState.Now)])
    const [first, second] = layout.rounds
    expect(layout.rounds.map((round) => round.id)).toEqual(['r1', 'r2'])
    expect(first!.x + first!.w).toBe(second!.x)
    const [, review, followUp] = layout.cards
    expect(followUp!.x - (review!.x + CARD.w)).toBe(88)
    expect(second!.x).toBe(review!.x + CARD.w + 44)
    expect(layout.w).toBe(second!.x + second!.w + 40)
  })

  it('leaves out a step whose lane it doesn’t have', () => {
    const layout = layoutOf(LANES, [...LOOP.slice(0, 2), step('lost', 'nobody', 'r1', GraphNodeState.Done), LOOP[2]!])
    expect(layout.cards.map((card) => card.id)).toEqual(['implement', 'review-1', 'settle-1'])
    expect(layout.edges.map((edge) => edge.id)).toEqual(['review-1', 'settle-1'])
  })

  it('stands where the task does: the last step at work or waiting, else the last step, else the middle', () => {
    const layout = layoutOf(LANES, LOOP)
    const settle = layout.cards[2]!
    expect(layout.focus).toEqual({ x: settle.x + CARD.w / 2, y: settle.y + CARD.h / 2 })
    const done = layoutOf(
      LANES,
      LOOP.slice(0, 2).map((one) => ({ ...one, state: GraphNodeState.Done })),
    )
    expect(done.focus.x).toBe(done.cards[1]!.x + CARD.w / 2)
    const empty = layoutOf(LANES, [])
    expect(empty.focus).toEqual({ x: empty.w / 2, y: empty.h / 2 })
    expect([GraphNodeState.Now, GraphNodeState.Waiting, GraphNodeState.Held, GraphNodeState.Proposed].every(isCurrent)).toBe(true)
    expect([GraphNodeState.Done, GraphNodeState.Next, GraphNodeState.Added, GraphNodeState.Stopped].some(isCurrent)).toBe(false)
  })
})

describe('how a task’s graph is looked at', () => {
  const room = { w: 1440, h: 720, left: 168, top: 44 }
  const short = layoutOf(LANES, LOOP)
  const long = layoutOf(
    LANES,
    Array.from({ length: 16 }, (_, i) =>
      step(`s${i}`, i % 2 === 0 ? 'lead' : 'reviewer', i < 12 ? 'r1' : 'r2', i === 13 ? GraphNodeState.Now : GraphNodeState.Done),
    ),
  )

  it('opens on all of it where all of it is readable, never larger than life', () => {
    const view = openingView(short, room)
    expect(view).toEqual(fitView(short, room))
    expect(view.k).toBe(1)
    expect(view.x + (short.w * view.k) / 2).toBe(room.left + (room.w - room.left) / 2)
  })

  it('opens readable on the round at work from its start, where all of it wouldn’t be', () => {
    const view = openingView(long, room)
    expect(view.k).toBe(0.9)
    expect(view.x).toBe(room.left - 1 - long.rounds[1]!.x * 0.9)
  })

  it('opens on the step at work where the round at work is too long to show from its start', () => {
    const narrow = { ...room, w: 600 }
    const one = layoutOf(
      LANES,
      Array.from({ length: 12 }, (_, i) => step(`s${i}`, 'lead', 'r1', i === 10 ? GraphNodeState.Now : GraphNodeState.Done)),
    )
    const view = openingView(one, narrow)
    const focus = view.x + one.focus.x * view.k
    expect(focus).toBeGreaterThan(narrow.left)
    expect(focus).toBeLessThan(narrow.w)
  })

  it('fits all of it, comes back to where the task stands, and zooms about a point that stays put', () => {
    expect(fitView(long, room).k).toBeLessThan(1)
    const now = nowView(long, room, 0.5)
    expect(now.k).toBe(0.9)
    expect(now.x + long.focus.x * now.k).toBe(room.left + (room.w - room.left) / 2)
    const view = { x: 10, y: 20, k: 1 }
    const zoomed = zoomAbout(view, 2, { x: 110, y: 120 })
    expect(zoomed.k).toBe(1.6)
    expect((110 - zoomed.x) / zoomed.k).toBe((110 - view.x) / view.k)
    expect(zoomAbout(view, 0.01, { x: 0, y: 0 }).k).toBe(ZOOM.min)
  })

  it('moves just enough to show a card, and not at all where it shows', () => {
    const view = { x: 0, y: 0, k: 1 }
    const card = { id: 'c', x: 2000, y: 900 }
    const moved = showing(view, card, room)
    expect(moved.x + card.x + CARD.w).toBe(room.w - 24)
    expect(moved.y + card.y + CARD.h).toBe(room.h - 24)
    const behind = showing(view, { id: 'c', x: 0, y: 0 }, room)
    expect([behind.x, behind.y]).toEqual([room.left + 24, room.top + 24])
    expect(showing(view, { id: 'c', x: 400, y: 200 }, room)).toBe(view)
  })
})

describe('a task’s graph on screen', () => {
  const lanes: StepGraphLane[] = [
    { id: 'lead', who: { kind: 'model', model: OPUS }, lead: true },
    { id: 'reviewer', who: { kind: 'model', model: CODEX } },
    { id: 'althar', who: { kind: 'althar', name: 'Althar' } },
  ]
  const steps: StepGraphStep[] = [
    { id: 'implement', lane: 'lead', round: 'r1', label: 'Implement', state: GraphNodeState.Done, corner: '24m' },
    {
      id: 'review-1',
      lane: 'reviewer',
      round: 'r1',
      label: 'Review 1',
      state: GraphNodeState.Now,
      corner: '2m',
      outcome: '3 findings',
      warn: true,
    },
    { id: 'publish', lane: 'althar', round: 'r1', label: 'Pull request', state: GraphNodeState.Next },
  ]
  const rounds = [{ id: 'r1', by: 'You asked', said: 'Retry the checkout.' }]

  it('numbers its steps, says where each stands, and names each lane’s agent, the lead’s as the lead', () => {
    render(<StepGraph lanes={lanes} rounds={rounds} steps={steps} detail={(id) => <p>{id}</p>} />)
    const region = screen.getByRole('region', { name: 'The task’s steps' })
    const cards = within(within(region).getAllByRole('list')[0]!).getAllByRole('listitem')
    expect(cards.map((card) => card.textContent)).toEqual([
      'Implement, done0124mOpus 5',
      'Review 1, running022mCodex3 findings',
      'Pull request, next03Althar',
    ])
    expect(screen.getByRole('button', { name: /Review 1, running/ })).toBeInTheDocument()
    expect(region.querySelector('[class*="gutter"]')).toHaveTextContent(/^Opus 5leadCodexAlthar$/)
  })

  it('draws each line, and its head, in its look', () => {
    render(<StepGraph lanes={lanes} rounds={rounds} steps={steps} />)
    const svg = screen.getByRole('region', { name: 'The task’s steps' }).querySelector('svg')
    const lines = [...(svg?.querySelectorAll(':scope > path') ?? [])]
    const heads = [...(svg?.querySelectorAll('marker path') ?? [])]
    expect(lines).toHaveLength(2)
    // A look whose class didn't resolve would leave a line undrawn: each has the line's class and its look's.
    for (const line of lines) expect(line.getAttribute('class')?.trim().split(/\s+/)).toHaveLength(2)
    for (const head of heads) expect(head.getAttribute('class')).toBeTruthy()
  })

  it('zooms with ⌘ and the wheel, pans with the wheel alone, and says the zoom it is at', () => {
    render(<StepGraph lanes={lanes} rounds={rounds} steps={steps} />)
    const canvas = screen.getByRole('region', { name: 'The task’s steps' })
    const percent = () => within(screen.getByRole('group', { name: 'Zoom' })).getByText(/%$/).textContent
    const before = percent()
    act(() => void canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -40, metaKey: true, bubbles: true, cancelable: true })))
    expect(percent()).not.toBe(before)
    const zoomed = percent()
    const world = canvas.querySelector('[class*="world"]') as HTMLElement
    const at = world.style.transform
    act(() => void canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: 30, deltaY: 10, bubbles: true, cancelable: true })))
    expect(world.style.transform).not.toBe(at)
    expect(percent()).toBe(zoomed)
  })

  it('pans as it is dragged, which closes the report open, and a press without a drag leaves it as it was', () => {
    const onOpenChange = vi.fn()
    render(
      <StepGraph lanes={lanes} rounds={rounds} steps={steps} detail={(id) => <p>{id}</p>} open="review-1" onOpenChange={onOpenChange} />,
    )
    const canvas = screen.getByRole('region', { name: 'The task’s steps' })
    const world = canvas.querySelector('[class*="world"]') as HTMLElement
    const at = world.style.transform
    fireEvent.pointerDown(canvas, { button: 0, clientX: 300, clientY: 300 })
    fireEvent.pointerMove(canvas, { clientX: 301, clientY: 301 })
    fireEvent.pointerUp(canvas)
    expect(world.style.transform).toBe(at)
    expect(onOpenChange).not.toHaveBeenCalled()
    fireEvent.pointerDown(canvas, { button: 0, clientX: 300, clientY: 300 })
    fireEvent.pointerMove(canvas, { clientX: 360, clientY: 330 })
    fireEvent.pointerUp(canvas)
    expect(world.style.transform).not.toBe(at)
    expect(onOpenChange).toHaveBeenCalledWith(null)
  })

  it('moves from its own keys only while it has focus itself, and fits all of it on 0', () => {
    render(<StepGraph lanes={lanes} rounds={rounds} steps={steps} detail={(id) => <p>{id}</p>} />)
    const canvas = screen.getByRole('region', { name: 'The task’s steps' })
    const world = canvas.querySelector('[class*="world"]') as HTMLElement
    const at = world.style.transform
    fireEvent.keyDown(screen.getByRole('button', { name: /Implement/ }), { key: 'ArrowLeft' })
    expect(world.style.transform).toBe(at)
    fireEvent.keyDown(canvas, { key: 'ArrowLeft', metaKey: true })
    expect(world.style.transform).toBe(at)
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      const before = world.style.transform
      fireEvent.keyDown(canvas, { key })
      expect(world.style.transform, key).not.toBe(before)
    }
    fireEvent.keyDown(canvas, { key: '0' })
    expect(world.style.transform).toContain('scale(0.3)')
    fireEvent.keyDown(canvas, { key: 'x' })
    expect(world.style.transform).toContain('scale(0.3)')
  })

  it('fits all of it, and goes back to where the task stands, from its controls', () => {
    render(<StepGraph lanes={lanes} rounds={rounds} steps={steps} />)
    const world = screen.getByRole('region', { name: 'The task’s steps' }).querySelector('[class*="world"]') as HTMLElement
    const scale = () => Number(/scale\(([\d.]+)\)/.exec(world.style.transform)?.[1])
    fireEvent.click(screen.getByRole('button', { name: 'Fit' }))
    expect(scale()).toBeCloseTo(0.3)
    fireEvent.click(screen.getByRole('button', { name: 'Now' }))
    expect(scale()).toBeCloseTo(0.9)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(scale()).toBeCloseTo(1.08)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    expect(scale()).toBeCloseTo(0.9)
  })

  it('keeps where the task stands in view as steps come, until the person moves it', () => {
    const { rerender } = render(<StepGraph lanes={lanes} rounds={rounds} steps={steps} />)
    const world = screen.getByRole('region', { name: 'The task’s steps' }).querySelector('[class*="world"]') as HTMLElement
    const more = [...steps, { id: 'follow-up', lane: 'lead', round: 'r1', label: 'Follow-up', state: GraphNodeState.Now }]
    const at = world.style.transform
    rerender(<StepGraph lanes={lanes} rounds={rounds} steps={more} />)
    expect(world.style.transform).not.toBe(at)
    // Moved by the person, it stays where they put it as more comes.
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    const theirs = world.style.transform
    rerender(
      <StepGraph lanes={lanes} rounds={rounds} steps={[...more, { ...more[3]!, id: 'review-2', lane: 'reviewer', label: 'Review 2' }]} />,
    )
    expect(world.style.transform).toBe(theirs)
  })

  it('brings a card it tabs to into view', () => {
    render(<StepGraph lanes={lanes} rounds={rounds} steps={steps} detail={(id) => <p>{id}</p>} />)
    const world = screen.getByRole('region', { name: 'The task’s steps' }).querySelector('[class*="world"]') as HTMLElement
    const at = world.style.transform
    fireEvent.focus(screen.getByRole('button', { name: /Pull request/ }))
    expect(world.style.transform).not.toBe(at)
  })
})
