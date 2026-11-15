import { useMemo } from 'react'

import { Popover } from '@althar/ui'

import { Mark, Node, openTask, Wires } from '../graph/parts'
import { word } from '../plan'
import { lay, type NodeView } from '../view'
import type { Mission } from './mission'
import s from './board.module.css'

/*
 * What the board's options draw a mission with: its tasks as a row of marks
 * wave by wave (how far along it is, at a glance), a task as one compact line
 * (its mark, its name, where it stands), the mission's small graph, and the
 * quiet mark a task's card carries to say which mission it is part of.
 */

/**
 * The mission's tasks as a row of bars, as a task's steps are (StepTrack's look), one a task, in the order they can
 * start: merged in ink, at work in cobalt, waiting on the person in violet, failed in red, the rest to come. A wider
 * space between one wave and the next. Each bar opens its task's detail when pointed at; it fits any lane's width.
 */
export function Strip({ mission, className }: { mission: Mission; className?: string }) {
  return (
    <div className={[s.strip, className].filter(Boolean).join(' ')}>
      {mission.waves.map((wave) => (
        <ul key={wave.map((one) => one.key).join(' ')} className={s.wave} style={{ flexGrow: wave.length }}>
          {wave.map((node) => (
            <li key={node.key}>
              <Node node={node} graph={mission.graph} placement="below">
                <button
                  type="button"
                  className={[s.bar, s[node.stand]].join(' ')}
                  aria-label={`${node.spec.short}: ${node.word}`}
                  onClick={() => openTask(node)}
                >
                  <i />
                </button>
              </Node>
            </li>
          ))}
        </ul>
      ))}
    </div>
  )
}

/** How far along: 4 of 12 merged. */
export const progressOf = (mission: Mission) => `${mission.merged} of ${mission.total} merged`

/**
 * A task as one line: its mark, its name, and where it stands, quieter, at the end. Pressing it opens the task; pointing
 * at it shows its detail, with what can be done to it.
 */
export function TaskLine({
  node,
  mission,
  stacked = false,
  placement = 'right',
}: {
  node: NodeView
  mission: Mission
  /** Where it stands under its name, rather than after it: in a lane's width. */
  stacked?: boolean
  placement?: 'below' | 'above' | 'right' | 'left'
}) {
  const name = node.spec.short
  return (
    <Node node={node} graph={mission.graph} placement={placement}>
      <button
        type="button"
        className={[s.line, stacked && s.stacked, s[node.stand]].filter(Boolean).join(' ')}
        onClick={() => openTask(node)}
      >
        <Mark stand={node.stand} />
        <span className={s.lineName} title={name}>
          {name}
        </span>
        <span className={[s.lineWord, s[node.tone]].join(' ')} title={node.word}>
          {node.word}
        </span>
      </button>
    </Node>
  )
}

/** A node of the small graph. */
const SIZE = { w: 118, h: 26 }
/** Between one row and the next, where the lines turn. */
const GAP = 18
/** Between two tasks that run side by side. */
const PITCH = 8

/** The mission's small graph, top to bottom: what starts first at the top, a line into each task from what it waits for; `here` ringed. */
export function MiniGraph({ mission, here }: { mission: Mission; here?: string }) {
  const { graph } = mission
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
    // The layout changes only with what waits for what.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shape],
  )
  return (
    <div className={s.mini}>
      <p className={s.miniHead}>
        <span className={s.miniName}>{graph.scenario.name}</span>
        <span className={s.miniWord}>{word()}</span>
        <span className={s.miniAt}>{progressOf(mission)}</span>
      </p>
      <div className={s.miniCanvas} style={{ width: laid.w, height: laid.h }}>
        <Wires laid={laid} edges={graph.edges} gap={GAP} down lit={here ?? null} heads={false} />
        {graph.nodes.map((node) => {
          const box = laid.boxes.get(node.key)
          if (box === undefined) return null
          return (
            <button
              key={node.key}
              type="button"
              className={[s.miniNode, s[node.stand], node.key === here && s.here].filter(Boolean).join(' ')}
              style={{ transform: `translate(${box.x}px, ${box.y}px)`, width: box.w, height: box.h }}
              title={`${node.spec.title}: ${node.word}`}
              onClick={() => openTask(node)}
            >
              <Mark stand={node.stand} />
              <span className={s.miniNodeName}>{node.spec.short}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * The quiet mark a task's card carries at its foot: the mission's name and the task's place in it, Althar Cloud 4/12.
 * Pointing at it opens the mission's small graph, this task ringed; where the card opens it (C), it says so through
 * `open`, and the graph keeps it open while the pointer is on it (`onStay`) and lets it go after (`onLeave`).
 */
export function Tag({
  mission,
  node,
  open,
  onOpenChange,
  onStay,
  onLeave,
}: {
  mission: Mission
  node: NodeView
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onStay?: () => void
  onLeave?: () => void
}) {
  return (
    <Popover
      hover
      label={mission.graph.scenario.name}
      placement="below"
      align="end"
      initialFocus="panel"
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
      trigger={
        <button type="button" className={s.tag}>
          <span className={s.tagName}>{mission.graph.scenario.name}</span>
          <span className={s.tagPlace}>
            {mission.placeOf(node.key)}/{mission.total}
          </span>
        </button>
      }
    >
      <div onPointerEnter={onStay} onPointerLeave={onLeave}>
        <MiniGraph mission={mission} here={node.key} />
      </div>
    </Popover>
  )
}
