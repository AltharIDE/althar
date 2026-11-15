import { type ComponentProps, useRef, useState } from 'react'

import { Node, openTask, useWidth } from '../graph/parts'
import { word } from '../plan'
import { scenario } from '../state'
import type { GraphView, NodeView } from '../view'
import {
  Dropped,
  Kicker,
  LaunchStrip,
  LivePill,
  NeedsYou,
  PlannedPill,
  planEdges,
  StepPopover,
  useGraph,
  useLaid,
  usePlan,
  Wires,
} from './pieces'
import s from './card.module.css'

/*
 * Chat A · The card moves. The plan is one card, at the coordinator's
 * latest answer: each answer that changes it draws the new version there,
 * and the one before folds to a line where it was. The card is the graph,
 * top to bottom: what starts first at the top, each step under what it
 * waits for. Pressing a step opens what it does and why, who leads it, the
 * person's notes, and what it waits for, each changed there. Launched, the
 * same card runs: each step says where it stands, and its last row is what
 * waits on the person.
 */

const H = 46
const WIDEST = 210
const NARROWEST = 124
const GAP = 28
const PITCH = 12

/** As wide as the card lets the widest row be. */
const sized = (room: number) => (_columns: number, widest: number) => ({
  w: Math.floor(Math.max(NARROWEST, Math.min(WIDEST, ((room || 440) - (widest - 1) * PITCH - 2) / widest))),
  h: H,
})

/** A step, as the popover's trigger: it takes the trigger's props and ref. */
function Planned({ step, ...rest }: ComponentProps<typeof PlannedPill>) {
  return <PlannedPill step={step} {...rest} />
}

/** A task as it runs, as the popover's trigger: a press opens its task. */
function Live({ node, ...rest }: { node: NodeView } & ComponentProps<'button'>) {
  return <LivePill node={node} {...rest} onClick={() => openTask(node)} />
}

function Planning() {
  const { last } = usePlan()
  const well = useRef<HTMLDivElement>(null)
  const room = useWidth(well)
  const steps = last.steps.filter((one) => !one.dropped)
  const laid = useLaid(steps, sized(room), GAP, PITCH, true, room)
  const [lit, setLit] = useState<string | null>(null)
  return (
    <article className={s.card} aria-label={scenario().name}>
      <div className={s.top}>
        <Kicker last={last} launched={false} />
        <span className={s.at}>{steps.length} tasks</span>
      </div>
      <h3 className={s.title}>{scenario().name}</h3>
      <div className={s.well} ref={well}>
        <div className={s.canvas} style={{ width: laid.w, height: laid.h }} onPointerLeave={() => setLit(null)}>
          <Wires laid={laid} edges={planEdges(steps)} gap={GAP} down lit={lit} />
          {steps.map((step) => {
            const box = laid.boxes.get(step.key)
            if (box === undefined) return null
            return (
              <div
                key={step.key}
                className={s.place}
                data-node={step.key}
                style={{ transform: `translate(${box.x}px, ${box.y}px)`, width: box.w, height: box.h }}
                onPointerEnter={() => setLit(step.key)}
              >
                <StepPopover step={step} steps={last.steps} editable>
                  <Planned step={step} />
                </StepPopover>
              </div>
            )
          })}
        </div>
      </div>
      {last.steps.some((one) => one.dropped) && <Dropped steps={last.steps} className={s.below} />}
      <LaunchStrip steps={last.steps} className={s.steps} />
    </article>
  )
}

function Running({ graph }: { graph: GraphView }) {
  const { last } = usePlan()
  const well = useRef<HTMLDivElement>(null)
  const room = useWidth(well)
  const items = graph.nodes.map((one) => ({ key: one.key, deps: one.now.deps }))
  const laid = useLaid(items, sized(room), GAP, PITCH, true, room)
  const [lit, setLit] = useState<string | null>(null)
  return (
    <article className={s.card} aria-label={scenario().name}>
      <div className={s.top}>
        <Kicker last={last} launched graph={graph} />
        <span className={s.at}>
          {graph.merged} of {graph.nodes.length} merged
        </span>
      </div>
      <h3 className={s.title}>{scenario().name}</h3>
      <div className={s.well} ref={well}>
        <div className={s.canvas} style={{ width: laid.w, height: laid.h }} onPointerLeave={() => setLit(null)}>
          <Wires laid={laid} edges={graph.edges} gap={GAP} down lit={lit} />
          {graph.nodes.map((node) => {
            const box = laid.boxes.get(node.key)
            if (box === undefined) return null
            return (
              <div
                key={node.key}
                className={s.place}
                data-node={node.key}
                style={{ transform: `translate(${box.x}px, ${box.y}px)`, width: box.w, height: box.h }}
                onPointerEnter={() => setLit(node.key)}
              >
                <Node node={node} graph={graph} placement="right">
                  <Live node={node} />
                </Node>
              </div>
            )
          })}
        </div>
      </div>
      <NeedsYou graph={graph} className={s.steps} />
    </article>
  )
}

function LiveCard() {
  const graph = useGraph()
  return <Running graph={graph} />
}

/** A version a later one took the place of, folded to a line. */
function Folded({ version }: { version: number }) {
  return (
    <div className={s.folded}>
      <span className={s.foldedName}>
        {word()} v{version}
      </span>
      <span>Changed in v{version + 1}</span>
    </div>
  )
}

export function CardMoves({ version }: { version: number }) {
  const { last, launched } = usePlan()
  if (version !== last.n) return <Folded version={version} />
  return launched ? <LiveCard /> : <Planning />
}
