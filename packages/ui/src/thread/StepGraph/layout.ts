import { GraphNodeState } from '../../foundations/vocabulary'

/*
 * Where a task's graph puts things: a lane for each agent, a column for each
 * step in the order the steps ran, rounds of work one after another with a
 * wider gap between them, and the lines between steps, straight along a lane
 * and turning at right angles in the gap before a card. Pure, so the drawing
 * and how it is looked at (the view: where it is panned to, how far zoomed)
 * are worked out apart from React.
 */

/** A card's size, on the canvas before zooming. */
export const CARD = { w: 176, h: 82 } as const
/** A lane's height, a card in its middle. */
export const LANE = CARD.h + 44
/** The gap between cards of a round, and the wider one between rounds. */
const GAP = 48
const ROUND_GAP = 88
/** The canvas's own margin round what it draws. */
const PAD = 40
/** The radius a line turns with. */
const TURN = 8

export type EdgeLook = 'done' | 'next' | 'live' | 'you' | 'round'

export interface LayoutStep {
  readonly id: string
  readonly lane: string
  readonly round: string
  readonly state: GraphNodeState
}

export interface PlacedCard {
  readonly id: string
  readonly x: number
  readonly y: number
}

export interface PlacedEdge {
  /** The card it goes into: there is one line into each card but the first. */
  readonly id: string
  readonly d: string
  readonly look: EdgeLook
}

/** A round's span, from the line before it to the line after. */
export interface PlacedRound {
  readonly id: string
  readonly x: number
  readonly w: number
}

export interface PlacedLane {
  readonly id: string
  readonly y: number
}

export interface Layout {
  readonly w: number
  readonly h: number
  readonly cards: ReadonlyArray<PlacedCard>
  readonly edges: ReadonlyArray<PlacedEdge>
  readonly rounds: ReadonlyArray<PlacedRound>
  readonly lanes: ReadonlyArray<PlacedLane>
  /** The middle of the card where the task stands, else of the last; the middle of the canvas with none. */
  readonly focus: { readonly x: number; readonly y: number }
}

/** Whether a step is where the task stands: at work, or waiting on someone. */
export const isCurrent = (state: GraphNodeState) =>
  state === GraphNodeState.Now || state === GraphNodeState.Waiting || state === GraphNodeState.Held || state === GraphNodeState.Proposed

/** A line's look, by where it goes: into the card at work, live; into one that waits on you, yours; between done steps, done. */
const lookOf = (from: GraphNodeState, to: GraphNodeState): EdgeLook => {
  if (to === GraphNodeState.Now) return 'live'
  if (to === GraphNodeState.Waiting || to === GraphNodeState.Proposed) return 'you'
  return from === GraphNodeState.Done && to === GraphNodeState.Done ? 'done' : 'next'
}

/** Out of one card's right side into the next's left: straight along a lane, else across at right angles, its corners rounded. */
export const across = (x1: number, y1: number, x2: number, y2: number): string => {
  if (y1 === y2) return `M ${x1} ${y1} H ${x2}`
  const turnAt = x2 - GAP / 2
  const down = y2 > y1 ? 1 : -1
  const r = Math.min(TURN, Math.abs(y2 - y1) / 2)
  return `M ${x1} ${y1} H ${turnAt - r} Q ${turnAt} ${y1} ${turnAt} ${y1 + down * r} V ${y2 - down * r} Q ${turnAt} ${y2} ${turnAt + r} ${y2} H ${x2}`
}

/**
 * Places a task's steps, in the order given, each in its lane's row and its own column; a step whose lane isn't given has
 * nowhere to go and is left out. Rounds follow in the order their steps first come.
 */
export function layoutOf(lanes: ReadonlyArray<{ readonly id: string }>, steps: ReadonlyArray<LayoutStep>): Layout {
  const row = new Map(lanes.map((lane, index) => [lane.id, index]))
  const cardY = (index: number) => PAD + index * LANE + (LANE - CARD.h) / 2
  const cards: PlacedCard[] = []
  const edges: PlacedEdge[] = []
  const rounds: PlacedRound[] = []
  let x = PAD + ROUND_GAP / 2
  let last: (PlacedCard & { readonly state: GraphNodeState; readonly round: string }) | undefined
  for (const step of steps) {
    const index = row.get(step.lane)
    if (index === undefined) continue
    const opens = last === undefined || last.round !== step.round
    if (opens && last !== undefined) x += ROUND_GAP - GAP
    if (opens) rounds.push({ id: step.round, x: x - ROUND_GAP / 2, w: 0 })
    const card = { id: step.id, x, y: cardY(index) }
    if (last !== undefined)
      edges.push({
        id: step.id,
        d: across(last.x + CARD.w, last.y + CARD.h / 2, card.x, card.y + CARD.h / 2),
        look: opens ? 'round' : lookOf(last.state, step.state),
      })
    cards.push(card)
    last = { ...card, state: step.state, round: step.round }
    x += CARD.w + GAP
  }
  // Each round reaches the line before the next, the last as far past its last card as the first starts before its first.
  const end = x - GAP + ROUND_GAP / 2
  const spans = rounds.map((round, index) => ({ ...round, w: (rounds[index + 1]?.x ?? end) - round.x }))
  const h = PAD * 2 + lanes.length * LANE
  const w = end + PAD
  const current = [...steps].reverse().find((step) => isCurrent(step.state) && row.has(step.lane))
  const at = cards.find((card) => card.id === current?.id) ?? cards.at(-1)
  return {
    w,
    h,
    cards,
    edges,
    rounds: spans,
    lanes: lanes.map((lane, index) => ({ id: lane.id, y: PAD + index * LANE })),
    focus: at === undefined ? { x: w / 2, y: h / 2 } : { x: at.x + CARD.w / 2, y: at.y + CARD.h / 2 },
  }
}

/** How the canvas is looked at: where its top left is on screen, and how far it is zoomed. */
export interface View {
  readonly x: number
  readonly y: number
  readonly k: number
}

/** The room the canvas has on screen, and what covers its left and top (the agents, the markers). */
export interface Room {
  readonly w: number
  readonly h: number
  readonly left: number
  readonly top: number
}

export const ZOOM = { min: 0.3, max: 1.6 } as const
/** The smallest zoom it opens at to show a task whole; below it, it opens readable on where the task stands. */
const WHOLE = 0.8
/** The zoom it opens at, and goes back to, where the whole wouldn't be readable. */
const READABLE = 0.9

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** All of it, as large as fits and never larger than life: centred across, its lanes from the top, under the markers. */
export function fitView(layout: Layout, room: Room): View {
  const aw = room.w - room.left
  const ah = room.h - room.top
  const k = clamp(Math.min(aw / layout.w, ah / layout.h, 1), ZOOM.min, ZOOM.max)
  return { k, x: room.left + (aw - layout.w * k) / 2, y: room.top }
}

/** Where the task stands, in the middle, at least readable. */
export function nowView(layout: Layout, room: Room, k: number): View {
  const at = Math.max(k, READABLE)
  return {
    k: at,
    x: room.left + (room.w - room.left) / 2 - layout.focus.x * at,
    y: room.top + (room.h - room.top) / 2 - layout.focus.y * at,
  }
}

/**
 * Where it opens: all of it, where that is readable; else readable, with the round at work from its start where the step
 * at work still shows, or else that step a little right of the middle.
 */
export function openingView(layout: Layout, room: Room): View {
  const fit = fitView(layout, room)
  if (fit.k >= WHOLE) return fit
  const k = READABLE
  const aw = room.w - room.left
  const ah = room.h - room.top
  const w = layout.w * k
  const h = layout.h * k
  const start = layout.rounds.at(-1)?.x ?? 0
  const fromStart = (layout.focus.x + CARD.w / 2 - start) * k <= aw - 24
  // From its start, the line before it tucked under the agents' edge, so the two don't read as a double line.
  const x = fromStart ? room.left - 1 - start * k : clamp(room.left + aw * 0.62 - layout.focus.x * k, room.left + aw - w, room.left)
  return {
    k,
    x: w <= aw ? room.left + (aw - w) / 2 : x,
    y: h <= ah ? room.top : clamp(room.top + ah / 2 - layout.focus.y * k, room.top + ah - h, room.top),
  }
}

/** Zoomed by a factor about a point on screen, which stays where it is. */
export function zoomAbout(view: View, factor: number, point: { readonly x: number; readonly y: number }): View {
  const k = clamp(view.k * factor, ZOOM.min, ZOOM.max)
  return { k, x: point.x - (point.x - view.x) * (k / view.k), y: point.y - (point.y - view.y) * (k / view.k) }
}

/** Moved just enough that a card is in the room, with a margin; as it is where the card already shows. */
export function showing(view: View, card: PlacedCard, room: Room, margin = 24): View {
  const left = view.x + card.x * view.k
  const top = view.y + card.y * view.k
  const right = left + CARD.w * view.k
  const bottom = top + CARD.h * view.k
  const dx = left < room.left + margin ? room.left + margin - left : right > room.w - margin ? room.w - margin - right : 0
  const dy = top < room.top + margin ? room.top + margin - top : bottom > room.h - margin ? room.h - margin - bottom : 0
  return dx === 0 && dy === 0 ? view : { ...view, x: view.x + dx, y: view.y + dy }
}

/** A round marker's room: the padding before it, and the gap kept between it and the next one. */
export const MARKER = { pad: 10, gap: 6 } as const

/** A round's span on the strip, in pixels: where it starts (below 0 where it panned off to the left) and how wide it is. */
export interface MarkerSpan {
  readonly from: number
  readonly w: number
}

/** How wide a marker is whole, and without its "· 57m later". */
export interface MarkerSize {
  readonly full: number
  readonly bare: number
}

/** Where a marker goes on the strip, how wide it is, and whether it keeps its "· 57m later". */
export interface MarkerSlot {
  readonly left: number
  readonly width: number
  readonly after: boolean
}

/**
 * Where each round's marker goes. One holds at the strip's left edge while its round is in view past it, and the next round's
 * marker pushes it out as it arrives, like a sticky header; none passes its round's end, so no two ever overlap. A label wider
 * than its round drops its "after" first, then is cut (its `width` is less than its size). A marker wholly out of view is null.
 */
export function markerSlots(spans: ReadonlyArray<MarkerSpan>, sizes: ReadonlyArray<MarkerSize>): Array<MarkerSlot | null> {
  return spans.map((span, index) => {
    const size = sizes[index] ?? { full: 0, bare: 0 }
    const room = Math.max(0, span.w - MARKER.pad - MARKER.gap)
    const after = size.full <= room
    const width = after ? size.full : Math.min(size.bare, room)
    const left = span.from >= 0 ? span.from : Math.min(0, span.from + span.w - MARKER.pad - width - MARKER.gap)
    return left + MARKER.pad + width <= 0 ? null : { left, width, after }
  })
}
