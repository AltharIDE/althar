import { type ComponentProps, useMemo, useRef, useState } from 'react'

import { NextStep, NextSteps } from '@althar/ui'

import { move, scenario, useWorld } from '../state'
import { columnsOf, graphOf, type GraphView, lay, type NodeView } from '../view'
import { Mark, Node, openTask, useWidth, Wires } from '../graph/parts'
import s from './InThread.module.css'

/*
 * A · In the conversation. Where the coordinator answers the request, one
 * card holds the tasks it became, drawn top to bottom: what starts first at
 * the top, each task under what it waits for, a line from each. The card
 * keeps itself current, so the answer stays the place to look: each task
 * says where it stands in a word, a task that waits draws its lines dashed,
 * and what waits on the person is the card's last row, to do right there.
 */

/** A task's height, and its width at most and at least: as wide as the card lets the widest row be. */
const H = 46
const WIDEST = 210
const NARROWEST = 124
const GAP = 28
const PITCH = 12

/** The card's strip: what the person can do now, the most pressing first, two at most. */
function Steps({ graph }: { graph: GraphView }) {
  const short = (key: string) => graph.byKey.get(key)?.spec.short ?? key
  const steps = graph.nodes.flatMap((node) => {
    switch (node.now.phase) {
      case 'failed':
        return [
          {
            key: node.key,
            rank: 0,
            words: `Try ${node.spec.short} again`,
            signal: false,
            run: () => move({ kind: 'retry', key: node.key }),
          },
        ]
      case 'asks':
        return [
          {
            key: node.key,
            rank: 1,
            words: `Allow ${node.spec.short}: ${node.spec.asks?.command ?? ''}`,
            signal: true,
            run: () => move({ kind: 'answer', key: node.key }),
          },
        ]
      case 'ready':
        return [
          {
            key: node.key,
            rank: 2,
            words:
              node.starts.length > 0 ? `Merge #${node.spec.pr} to start ${node.starts.map(short).join(' and ')}` : `Merge #${node.spec.pr}`,
            signal: true,
            run: () => move({ kind: 'merge', key: node.key }),
          },
        ]
      default:
        return []
    }
  })
  const shown = steps.toSorted((a, b) => a.rank - b.rank).slice(0, 2)
  if (shown.length === 0) return null
  return (
    <NextSteps className={s.steps}>
      {shown.map((one) => (
        <NextStep key={one.key} signal={one.signal} onPress={one.run}>
          {one.words}
        </NextStep>
      ))}
    </NextSteps>
  )
}

/** A task, as the popover's trigger: it takes the trigger's props and ref, and opens its task on a press. */
function Pill({ node, ...rest }: { node: NodeView } & ComponentProps<'button'>) {
  return (
    <button type="button" {...rest} className={[s.pill, s[node.stand]].join(' ')} onClick={() => openTask(node)}>
      <span className={s.name}>
        <Mark stand={node.stand} />
        <span className={s.short}>{node.spec.short}</span>
        {node.pr !== null && node.stand !== 'done' && <span className={s.pr}>{node.pr}</span>}
      </span>
      <span className={[s.word, s[node.tone]].join(' ')}>{node.stand === 'done' ? `Merged ${node.pr ?? ''}` : node.word}</span>
    </button>
  )
}

export function RequestCard() {
  const world = useWorld()
  const sc = scenario()
  const graph = useMemo(() => graphOf(sc, world), [sc, world])
  const well = useRef<HTMLDivElement>(null)
  const room = useWidth(well)
  const shape = graph.nodes.map((one) => `${one.key}:${one.now.deps.join(',')}`).join(' ')
  // Laid out again only where what depends on what changes, or the card's width, not on every tick.
  const laid = useMemo(
    () => {
      const nodes = graph.nodes.map((one) => ({ key: one.key, deps: one.now.deps }))
      const widest = Math.max(1, ...columnsOf(nodes).map((row) => row.length))
      const w = Math.floor(Math.max(NARROWEST, Math.min(WIDEST, ((room || 440) - (widest - 1) * PITCH - 2) / widest)))
      return lay(nodes, { w, h: H }, GAP, PITCH, true)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shape, room],
  )
  const [lit, setLit] = useState<string | null>(null)
  return (
    <article className={[s.card, graph.stand.tone === 'signal' && s.you].filter(Boolean).join(' ')} aria-label={sc.name}>
      <div className={s.top}>
        <span className={[s.status, s[graph.stand.tone]].join(' ')}>
          <Mark
            stand={
              graph.stand.tone === 'signal'
                ? 'yours'
                : graph.stand.tone === 'live'
                  ? 'running'
                  : graph.stand.tone === 'danger'
                    ? 'failed'
                    : graph.merged === graph.nodes.length
                      ? 'done'
                      : 'waits'
            }
          />
          {graph.stand.word}
        </span>
        <span className={s.at}>
          {graph.merged} of {graph.nodes.length} merged
        </span>
      </div>
      <h3 className={s.title}>{sc.name}</h3>
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
                  <Pill node={node} />
                </Node>
              </div>
            )
          })}
        </div>
      </div>
      <Steps graph={graph} />
    </article>
  )
}
