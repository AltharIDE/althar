import { BoardCard, BoardEmpty, BoardLane, boardText, LinkButton } from '@althar/ui'
import { useLayoutEffect, useRef, useState } from 'react'

import { readyCardOf, runningCardOf, stoppedCardOf, waitingCardOf } from '../../../src/renderer/features/board/BoardView'
import { word } from '../plan'
import { store, useStore } from '../state'
import type { NodeView, Stand } from '../view'
import type { Mission } from './mission'
import { Strip, TaskLine } from './pieces'
import { emptyBeside, useGiven } from './seam'
// The kit's own box for a lane with nothing in it, as BoardColumn draws it.
import kit from '../../../../../packages/ui/src/board/Board/Board.module.css'
import s from './board.module.css'

/*
 * B · Its own row. The mission is a row across the board, under the lanes'
 * heads: its name and how far along it is, then its tasks in their lanes
 * within the row, each drawn as the board draws it (a running task's card,
 * an ask's card), what waits and what merged as a line each so the row stays
 * short. A rule across the board under it; everything else below, as it is.
 * The row's cells are as tall as its tallest, so the rule runs straight.
 */

/** Which lane each of the mission's tasks stands in, as the board would put it. */
const laneOfStand = (stand: Stand): BoardLane => {
  switch (stand) {
    case 'running':
      return BoardLane.Running
    case 'yours':
      return BoardLane.Yours
    case 'done':
      return BoardLane.Settled
    default:
      return BoardLane.Next
  }
}

const inLane = (mission: Mission, lane: BoardLane) => mission.order.filter((one) => laneOfStand(one.stand) === lane)

/** The row shows in every lane; each counts the mission's tasks in it, as the lane would have. */
export const swimCount = (lane: BoardLane, mission: Mission) => ({ count: inLane(mission, lane).length, shows: true })

/** How tall each lane's cell would be by itself; every cell is as tall as the tallest. */
const heights = store<Readonly<Partial<Record<BoardLane, number>>>>({})

const useTallest = (lane: BoardLane) => {
  const inner = useRef<HTMLDivElement>(null)
  const all = useStore(heights)
  useLayoutEffect(() => {
    const element = inner.current
    if (element === null) return
    const measure = () => heights.set((was) => (was[lane] === element.offsetHeight ? was : { ...was, [lane]: element.offsetHeight }))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => {
      observer.disconnect()
      heights.set((was) => {
        const { [lane]: _gone, ...rest } = was
        return rest
      })
    }
  }, [lane])
  return { inner, tallest: Math.max(0, ...Object.values(all)) }
}

export function SwimCell({ lane, mission }: { lane: BoardLane; mission: Mission }) {
  const given = useGiven()
  const { inner, tallest } = useTallest(lane)
  const nodes = inLane(mission, lane)
  // Nothing in the row here, and nothing else in the lane: under the row, the lane says what will be here, as it would.
  const bare = emptyBeside[lane] === true && nodes.length === 0
  return (
    <>
      <section className={s.swim} aria-label={lane === BoardLane.Next ? mission.graph.scenario.name : undefined}>
        <div style={{ minHeight: tallest }}>
          <div ref={inner} className={s.swimIn}>
            {/* The row's name, in the first of its cells that shows; the others keep its room, so their cards line up. */}
            <header className={s.swimHead}>
              <p className={s.swimTitle}>
                <span className={s.swimName}>{mission.graph.scenario.name}</span>
                <span className={s.swimWord}>{word()}</span>
              </p>
              <Strip mission={mission} />
            </header>
            {given !== null && <Cell lane={lane} nodes={nodes} mission={mission} />}
          </div>
        </div>
      </section>
      {bare && (
        <div className={[kit.empty, kit.says].join(' ')}>
          <BoardEmpty title={boardText.empty[lane].title}>{boardText.empty[lane].how}</BoardEmpty>
        </div>
      )}
    </>
  )
}

function Cell({ lane, nodes, mission }: { lane: BoardLane; nodes: ReadonlyArray<NodeView>; mission: Mission }) {
  const given = useGiven()
  if (given === null) return null
  const { lanes, now, agents, actions, onOpen, onSignIn } = given
  const name = (id: string | null) => agents.find((agent) => agent.id === id)?.name ?? id ?? ''
  const of = (node: NodeView) => node.slug
  switch (lane) {
    case BoardLane.Running:
      return (
        <div className={s.swimCards}>
          {lanes.running
            .filter((task) => nodes.some((node) => of(node) === task.slug))
            .map((task) => (
              <BoardCard
                key={task.taskId}
                data-move={task.taskId}
                {...runningCardOf(task, now, name, actions)}
                onOpen={() => onOpen(task.threadId)}
              />
            ))}
        </div>
      )
    case BoardLane.Yours:
      return (
        <div className={s.swimCards}>
          {lanes.waiting
            .filter((one) => nodes.some((node) => of(node) === one.task.slug))
            .map((one) => (
              <BoardCard
                key={one.task.taskId}
                data-move={one.task.taskId}
                {...waitingCardOf(one, name, onSignIn)}
                onOpen={() => onOpen(one.task.threadId)}
              />
            ))}
          {lanes.ready
            .filter((task) => nodes.some((node) => of(node) === task.slug))
            .map((task) => (
              <BoardCard key={task.taskId} data-move={task.taskId} {...readyCardOf(task, actions)} onOpen={() => onOpen(task.threadId)} />
            ))}
        </div>
      )
    case BoardLane.Next: {
      const failed = lanes.stopped.filter((task) => nodes.some((node) => of(node) === task.slug))
      const waiting = nodes.filter((node) => node.stand !== 'failed')
      return (
        <div className={s.swimCards}>
          {failed.map((task) => (
            <BoardCard
              key={task.taskId}
              data-move={task.taskId}
              {...stoppedCardOf(task, now, actions)}
              onOpen={() => onOpen(task.threadId)}
            />
          ))}
          <Lines nodes={waiting} mission={mission} />
        </div>
      )
    }
    case BoardLane.Settled:
      // The latest merged first, as Settled lists them.
      return <Lines nodes={nodes.toSorted((a, b) => (b.now.mergedAt ?? 0) - (a.now.mergedAt ?? 0))} mission={mission} />
    default:
      return null
  }
}

/** How many of a cell's lines show before the rest is a press away, so the row stays short while much waits. */
const SHOWN = 4

/** What waits, or merged, a line each: the first few, and the rest in place on a press. */
function Lines({ nodes, mission }: { nodes: ReadonlyArray<NodeView>; mission: Mission }) {
  const [all, setAll] = useState(false)
  if (nodes.length === 0) return null
  // One more than the cut would take the line that says so: show it instead.
  const shown = all || nodes.length <= SHOWN + 1 ? nodes : nodes.slice(0, SHOWN)
  return (
    <div className={s.linesBox}>
      <ul className={s.lines}>
        {shown.map((node) => (
          <li key={node.key}>
            <TaskLine node={node} mission={mission} stacked />
          </li>
        ))}
      </ul>
      {nodes.length > SHOWN + 1 && (
        <LinkButton className={s.more} onClick={() => setAll((was) => !was)}>
          {all ? 'Fewer' : `${nodes.length - SHOWN} more`}
        </LinkButton>
      )}
    </div>
  )
}
