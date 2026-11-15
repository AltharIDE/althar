import { type ComponentProps, useMemo } from 'react'

import { Tooltip } from '@althar/ui'

import { Mark, Wires } from '../graph/parts'
import { type EdgeView, lay, type NodeView } from '../view'
import { goTo, type Place } from './mission'
import s from './MissionMap.module.css'

/*
 * The mission drawn small, top to bottom, for a popover: each task its mark
 * and its short name, row by row in the order they can start, this one
 * ringed, with the lines into it and out of it. Pointing at a task says where it stands; pressing it goes
 * there.
 */

const SIZE = { w: 128, h: 28 }
const GAP = 18
const PITCH = 16

/** A task in the map: a button that goes to it, its name and where it stands said on hover. */
function Spot({ node, here, ...rest }: { node: NodeView; here: boolean } & ComponentProps<'button'>) {
  return (
    <button
      type="button"
      {...rest}
      className={[s.spot, s[node.stand], here && s.here].filter(Boolean).join(' ')}
      aria-current={here ? 'page' : undefined}
      onClick={() => !here && goTo(node)}
    >
      <Mark stand={node.stand} />
      <span className={s.name}>{node.spec.short}</span>
    </button>
  )
}

export function MissionMap({ place }: { place: Place }) {
  const { graph, node: here } = place
  const mine = (edge: EdgeView) => edge.from === here.key || edge.to === here.key
  const shape = graph.nodes.map((one) => `${one.key}:${one.now.deps.join(',')}`).join(' ')
  const laid = useMemo(
    () =>
      lay(
        graph.nodes.map((one) => ({ key: one.key, deps: one.now.deps })),
        SIZE,
        GAP,
        PITCH,
        true,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shape],
  )
  return (
    <div className={s.map} style={{ width: laid.w, height: laid.h }}>
      {/* Only this task's own lines: what it waits for, and what waits for it. The rows say the rest of the order. */}
      <Wires laid={laid} edges={graph.edges.filter(mine)} gap={GAP} down heads={false} lit={here.key} />
      {graph.nodes.map((node) => {
        const box = laid.boxes.get(node.key)
        if (box === undefined) return null
        return (
          <div key={node.key} className={s.place} style={{ transform: `translate(${box.x}px, ${box.y}px)`, width: box.w, height: box.h }}>
            <Tooltip label={`${node.spec.title}: ${node.word}`} placement="right" align="center">
              <Spot node={node} here={node.key === here.key} />
            </Tooltip>
          </div>
        )
      })}
    </div>
  )
}
