import {
  type ComponentPropsWithRef,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { Logo } from '../../foundations/Logo/Logo'
import { GraphNodeState } from '../../foundations/vocabulary'
import { cssVars } from '../../lib/cssVars'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Button } from '../../primitives/Button/Button'
import { HoverCard, Tooltip } from '../../primitives/HoverCard/HoverCard'
import { Model, type ModelInfo } from '../../primitives/Model/Model'
import { Popover } from '../../primitives/Popover/Popover'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { GraphMark, graphStripText } from '../Graph/Graph'
import {
  CARD,
  type EdgeLook,
  fitView,
  LANE,
  type Layout,
  layoutOf,
  nowView,
  openingView,
  type Room,
  showing,
  type View,
  zoomAbout,
} from './layout'
import s from './StepGraph.module.css'

/*
 * A task's steps as a graph: a lane for each agent that worked on it, each
 * step a card in its lane in the order the steps ran, straight lines from
 * each to the next, and a marker over the lanes where each round of work
 * starts, saying who started it; what they said shows on hover. The canvas
 * pans with a drag or the wheel and zooms with a pinch or ⌘ and the wheel,
 * or from its controls; the agents stay at its left and the markers at its
 * top. A card opens its report in a popover by it, where the host gives one.
 */

/** Who works in a lane: an agent on its model, or Althar itself, which publishes. */
export type StepGraphWho = { readonly kind: 'model'; readonly model: ModelInfo } | { readonly kind: 'althar'; readonly name: string }

export interface StepGraphLane {
  id: string
  who: StepGraphWho
  /** The task's lead works in it. */
  lead?: boolean
}

export interface StepGraphRound {
  id: string
  /** Who started it, as its marker says: You asked, You followed up, From the coordinator. */
  by: string
  /** How long after the round before it started, where that was long: 17h later. */
  after?: string
  /** What was said, shown on hover. */
  said: string
  /** What a change to its steps put in, said with what was said: Review and Pull request added. */
  changed?: string
}

export interface StepGraphStep {
  id: string
  /** Its lane, by id. */
  lane: string
  /** Its round, by id. */
  round: string
  /** Its name: Implement, Review 2, Pull request. */
  label: string
  state: GraphNodeState
  /** At its corner: how long it took or has taken, or where it stands in a word (next, asks you). */
  corner?: string
  /** What it came to, in a few words: 3 findings, #229. */
  outcome?: string
  /** What it came to wants a look: findings, failed checks. */
  warn?: boolean
}

export interface StepGraphText {
  label: string
  /** The lead's lane, after its agent. */
  lead: string
  state: Record<GraphNodeState, string>
  controls: string
  zoomIn: string
  zoomOut: string
  zoom: (percent: number) => string
  fit: string
  now: string
  nowTip: string
  /** Under what was said, on a marker that goes to it. */
  toSaid: string
  /** The markers, for assistive technology. */
  started: string
  /** What the canvas's keys do, for assistive technology. */
  keys: string
}

export const stepGraphText: StepGraphText = {
  label: 'The task’s steps',
  lead: 'lead',
  state: graphStripText.state,
  controls: 'Zoom',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  zoom: (percent) => `${percent}%`,
  fit: 'Fit',
  now: 'Now',
  nowTip: 'Back to where the task stands',
  toSaid: 'Show it in the conversation',
  started: 'What started each part of the work',
  keys: 'Arrow keys move around, plus and minus zoom, 0 fits it all.',
}

export type StepGraphProps = RootProps<
  'div',
  {
    /** Its agents' lanes, top to bottom: the lead's first. */
    lanes: readonly StepGraphLane[]
    /** Its rounds of work, oldest first. */
    rounds: readonly StepGraphRound[]
    /** Its steps, in the order they ran, then those to come. */
    steps: readonly StepGraphStep[]
    /** A step's report, in the popover its card opens. Without it, cards open nothing. */
    detail?: (id: string) => ReactNode
    /** The step whose popover shows, where the host keeps it. */
    open?: string | null
    onOpenChange?: (id: string | null) => void
    /** Goes to what started a round, as its marker is pressed. Without it, markers only show what was said. */
    onRound?: (id: string) => void
    text?: Partial<StepGraphText>
  }
>

/** How wide the agents' column is, and how tall the markers' strip. */
const GUTTER = 168
const STRIP = 44
/** How far an arrow key moves the canvas, and how much a press of a zoom control zooms. */
const NUDGE = 64
const STEP_ZOOM = 1.2
/** The dot grid's spacing, before zooming. */
const DOTS = 18

const LOOKS: readonly EdgeLook[] = ['done', 'next', 'live', 'you', 'round']
/** Each look's line and head, by class. */
const EDGE: Readonly<Record<EdgeLook, string | undefined>> = {
  done: s.edgeDone,
  next: s.edgeNext,
  live: s.edgeLive,
  you: s.edgeYou,
  round: s.edgeRound,
}
const HEAD: Readonly<Record<EdgeLook, string | undefined>> = {
  done: s.headDone,
  next: s.headNext,
  live: s.headLive,
  you: s.headYou,
  round: s.headRound,
}

export function StepGraph({ lanes, rounds, steps, detail, open, onOpenChange, onRound, text, className, ...rest }: StepGraphProps) {
  const t = { ...stepGraphText, ...text }
  const keys = useId()
  const layout: Layout = useMemo(() => layoutOf(lanes, steps), [lanes, steps])
  const box = useRef<HTMLElement>(null)
  const [room, setRoom] = useState<Room | null>(null)
  const [view, setView] = useState<View | null>(null)
  const [own, setOwn] = useState<string | null>(null)
  const opened = open === undefined ? own : open
  const openStep = (id: string | null) => {
    if (open === undefined) setOwn(id)
    onOpenChange?.(id)
  }
  // Whether the canvas is being dragged: past a few pixels a press is a drag, which closes what is open rather than opening.
  const drag = useRef<{ x: number; y: number; from: View; moved: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)

  useLayoutEffect(() => {
    const element = box.current
    if (element === null) return
    const measure = () => setRoom({ w: element.clientWidth, h: element.clientHeight, left: GUTTER, top: STRIP })
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(element)
    return () => watch.disconnect()
  }, [])
  // Placed as it is measured, and again as its steps or its room change, to keep where the task stands in view: until the
  // person moves it, after which it stays where they put it; and never while a report is open by its card.
  const moved = useRef(false)
  const placed = useRef(false)
  useLayoutEffect(() => {
    if (room === null || (placed.current && (moved.current || opened !== null))) return
    placed.current = true
    setView(openingView(layout, room))
  }, [layout, room, opened])

  // A view the person moves to closes what is open: its popover stays by the card it was opened from.
  const move = (next: View | ((current: View) => View)) => {
    moved.current = true
    if (opened !== null) openStep(null)
    setView((current) => (current === null ? current : typeof next === 'function' ? next(current) : next))
  }
  // The wheel pans; with a pinch or ⌘ it zooms about the pointer. Not passive, so the page doesn't scroll with it.
  const onWheel = useEffectEvent((event: WheelEvent, bounds: DOMRect) =>
    move((current) =>
      event.ctrlKey || event.metaKey
        ? zoomAbout(current, Math.exp(-event.deltaY * 0.01), { x: event.clientX - bounds.left, y: event.clientY - bounds.top })
        : { ...current, x: current.x - event.deltaX, y: current.y - event.deltaY },
    ),
  )
  useEffect(() => {
    const element = box.current
    if (element === null) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      onWheel(event, element.getBoundingClientRect())
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [])

  const middle = () => (room === null ? { x: 0, y: 0 } : { x: room.left + (room.w - room.left) / 2, y: room.top + (room.h - room.top) / 2 })
  const zoom = (factor: number) => move((current) => zoomAbout(current, factor, middle()))
  const fit = () => room !== null && move(fitView(layout, room))
  const toNow = () => room !== null && move((current) => nowView(layout, room, current.k))

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.target !== event.currentTarget || event.metaKey || event.ctrlKey || event.altKey) return
    const pan = { ArrowLeft: [NUDGE, 0], ArrowRight: [-NUDGE, 0], ArrowUp: [0, NUDGE], ArrowDown: [0, -NUDGE] }[event.key]
    if (pan !== undefined) move((current) => ({ ...current, x: current.x + (pan[0] ?? 0), y: current.y + (pan[1] ?? 0) }))
    else if (event.key === '+' || event.key === '=') zoom(STEP_ZOOM)
    else if (event.key === '-') zoom(1 / STEP_ZOOM)
    else if (event.key === '0') fit()
    else return
    event.preventDefault()
  }

  const at = (x: number) => (view === null ? 0 : view.x + x * view.k)
  const top = (y: number) => (view === null ? 0 : view.y + y * view.k)
  const laneOf = new Map(lanes.map((lane) => [lane.id, lane]))
  const placedAt = new Map(layout.cards.map((card) => [card.id, card]))
  const shown = steps.filter((step) => placedAt.has(step.id))
  const placedRounds = new Map(layout.rounds.map((round) => [round.id, round]))

  return (
    <div className={cx(s.graph, className)} {...rest}>
      <section
        ref={box}
        className={cx(s.canvas, dragging && s.dragging)}
        style={
          view === null ? undefined : cssVars({ '--dots': `${DOTS * view.k}px`, '--dots-x': `${view.x}px`, '--dots-y': `${view.y}px` })
        }
        // The canvas takes the keys that move it, and says so; Tab goes on to its cards.
        tabIndex={0}
        aria-label={t.label}
        aria-describedby={keys}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          if (
            view === null ||
            event.button !== 0 ||
            (event.target instanceof Element && event.target.closest('button, a, [data-controls]'))
          )
            return
          drag.current = { x: event.clientX, y: event.clientY, from: view, moved: false }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const held = drag.current
          if (held === null) return
          const dx = event.clientX - held.x
          const dy = event.clientY - held.y
          if (!held.moved && Math.abs(dx) + Math.abs(dy) <= 3) return
          if (!held.moved) setDragging(true)
          held.moved = true
          move({ ...held.from, x: held.from.x + dx, y: held.from.y + dy })
        }}
        onPointerUp={() => {
          drag.current = null
          setDragging(false)
        }}
        onPointerCancel={() => {
          drag.current = null
          setDragging(false)
        }}
      >
        <VisuallyHidden id={keys}>{t.keys}</VisuallyHidden>
        {view !== null && (
          <>
            {/* The lanes run the canvas's width, and the lines between rounds its height, whatever is in view. */}
            <div className={s.under} aria-hidden="true">
              {layout.lanes.map((lane) => (
                <div key={lane.id} className={s.lane} style={{ top: top(lane.y), height: LANE * view.k }} />
              ))}
              {layout.rounds.slice(1).map((round) => (
                <div key={round.id} className={s.line} style={{ left: at(round.x) }} />
              ))}
            </div>

            <div
              className={s.world}
              style={{ width: layout.w, height: layout.h, transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
            >
              <svg className={s.edges} width={layout.w} height={layout.h} aria-hidden="true" focusable="false">
                <defs>
                  {LOOKS.map((look) => (
                    <marker
                      key={look}
                      id={`step-graph-${look}`}
                      viewBox="0 0 8 8"
                      refX="7.5"
                      refY="4"
                      markerWidth="7"
                      markerHeight="7"
                      orient="auto"
                      markerUnits="userSpaceOnUse"
                    >
                      <path d="M 0 0.5 L 7.5 4 L 0 7.5 Z" className={HEAD[look]} />
                    </marker>
                  ))}
                </defs>
                {layout.edges.map((edge) => (
                  <path key={edge.id} d={edge.d} className={cx(s.edge, EDGE[edge.look])} markerEnd={`url(#step-graph-${edge.look})`} />
                ))}
              </svg>
              <ol className={s.cards}>
                {shown.map((step, index) => {
                  const place = placedAt.get(step.id)
                  const lane = laneOf.get(step.lane)
                  if (place === undefined || lane === undefined) return null
                  const card = (
                    <Card
                      interactive={detail !== undefined}
                      step={step}
                      n={index + 1}
                      who={lane.who}
                      state={t.state[step.state]}
                      opened={opened === step.id}
                      onFocus={() => {
                        if (room === null) return
                        // Tabbed to, a card is brought into view: the person's move, which the canvas then keeps.
                        moved.current = true
                        setView((current) => (current === null ? current : showing(current, place, room)))
                      }}
                    />
                  )
                  return (
                    <li key={step.id} className={s.place} style={{ left: place.x, top: place.y, width: CARD.w, height: CARD.h }}>
                      {detail === undefined ? (
                        card
                      ) : (
                        <Popover
                          trigger={card}
                          label={step.label}
                          width={420}
                          open={opened === step.id}
                          onOpenChange={(next) => openStep(next ? step.id : null)}
                        >
                          {detail(step.id)}
                        </Popover>
                      )}
                    </li>
                  )
                })}
              </ol>
            </div>

            {/* Where each round starts, held at the top as the canvas moves. */}
            <ol className={s.strip} style={{ height: STRIP, left: GUTTER }} aria-label={t.started}>
              {rounds.map((round) => {
                const span = placedRounds.get(round.id)
                if (span === undefined) return null
                // Its start panned off to the left while the rest of it shows, its marker holds at the strip's edge.
                const from = at(span.x) - GUTTER
                const held = from < 0 && at(span.x + span.w) - GUTTER > 0
                return (
                  <li key={round.id} className={cx(s.markerAt, held && s.pinned)} style={{ left: held ? 0 : from }}>
                    <Marker round={round} onRound={onRound} toSaid={t.toSaid} />
                  </li>
                )
              })}
            </ol>

            {/* The agents, held at the left as the canvas moves. The cards say their agent too. */}
            <div className={s.gutter} style={{ width: GUTTER }} aria-hidden="true">
              <div className={s.corner} style={{ height: STRIP }} />
              {layout.lanes.map((placedLane) => {
                const lane = laneOf.get(placedLane.id)
                if (lane === undefined) return null
                return (
                  <div key={lane.id} className={s.name} style={{ top: top(placedLane.y), height: LANE * view.k }}>
                    <Who who={lane.who} />
                    {lane.lead === true && <span className={s.lead}>{t.lead}</span>}
                  </div>
                )
              })}
            </div>
          </>
        )}

        <div className={s.controls} style={{ top: STRIP + 12 }} role="group" aria-label={t.controls} data-controls>
          <Button variant="quiet" size="small" onClick={() => zoom(1 / STEP_ZOOM)} aria-label={t.zoomOut}>
            −
          </Button>
          <span className={s.percent} aria-live="polite">
            {t.zoom(Math.round((view?.k ?? 1) * 100))}
          </span>
          <Button variant="quiet" size="small" onClick={() => zoom(STEP_ZOOM)} aria-label={t.zoomIn}>
            +
          </Button>
          <i aria-hidden="true" />
          <Button variant="quiet" size="small" onClick={fit}>
            {t.fit}
          </Button>
          <Tooltip label={t.nowTip}>
            <Button variant="quiet" size="small" onClick={toNow}>
              {t.now}
            </Button>
          </Tooltip>
        </div>
      </section>
    </div>
  )
}

function Who({ who }: { who: StepGraphWho }) {
  return who.kind === 'model' ? (
    <Model model={who.model} short className={s.model} />
  ) : (
    <span className={s.althar}>
      <Logo size={11} />
      {who.name}
    </span>
  )
}

type CardProps = ComponentPropsWithRef<'button'> & {
  /** It opens a report: a button, which the popover's trigger gives its props and ref through. Else no control. */
  interactive: boolean
  step: StepGraphStep
  n: number
  who: StepGraphWho
  /** Its state, in words, for assistive technology. */
  state: string
  opened: boolean
}

/** A step: its number, mark and time; its name; who made it and what it came to. */
function Card({ interactive, step, n, who, state, opened, ...button }: CardProps) {
  const body = (
    <>
      {/* Its name is read first; its number and time show over it. */}
      <span className={s.label}>
        {step.label}
        <VisuallyHidden>, {state}</VisuallyHidden>
      </span>
      <span className={s.top}>
        <span className={s.n}>{String(n).padStart(2, '0')}</span>
        <GraphMark state={step.state} className={s.mark} />
        {step.corner !== undefined && <span className={s.when}>{step.corner}</span>}
      </span>
      <span className={s.foot}>
        <Who who={who} />
        {step.outcome !== undefined && <span className={cx(s.outcome, step.warn === true && s.warn)}>{step.outcome}</span>}
      </span>
    </>
  )
  const className = cx(s.card, s[step.state], opened && s.opened)
  return interactive ? (
    <button type="button" {...button} className={className}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  )
}

function Marker({ round, onRound, toSaid }: { round: StepGraphRound; onRound: ((id: string) => void) | undefined; toSaid: string }) {
  const said = (
    <span className={s.saidCard}>
      <span className={s.said}>{round.said}</span>
      {round.changed !== undefined && <span className={s.changed}>{round.changed}</span>}
      {onRound !== undefined && <span className={s.toSaid}>{toSaid}</span>}
    </span>
  )
  const face = (
    <>
      <span className={cx(s.dot, round.changed !== undefined && s.dotChanged)} aria-hidden="true" />
      {round.by}
      {round.after !== undefined && <span className={s.after}>{round.after}</span>}
    </>
  )
  return (
    <HoverCard card={said} placement="below" width={340}>
      {onRound === undefined ? (
        <span className={s.marker} tabIndex={0}>
          {face}
        </span>
      ) : (
        <button type="button" className={s.marker} onClick={() => onRound(round.id)}>
          {face}
        </button>
      )}
    </HoverCard>
  )
}
