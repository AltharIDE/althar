import { BoardCard, BoardLane, Fact, FactLine, NextStep, TaskStatus } from '@althar/ui'
import { useLayoutEffect } from 'react'

import { word } from '../plan'
import { store, useStore } from '../state'
import { listed, type NodeView } from '../view'
import { atWork, type Mission, needsYou, ranFor } from './mission'
import { progressOf, Strip, TaskLine } from './pieces'
import s from './board.module.css'

/*
 * A · One card. The mission is one card on the board, in the lane of the
 * loudest of its tasks it folds in: Running while any of them is at work, Up
 * next while they wait, Settled once they've all merged. What needs the
 * person (an ask, a merge, a task that failed) isn't folded in: it shows on
 * its own, where it always would, marked as the mission's. The card says
 * how far along it is as a row of bars, wave by wave, and names what's at
 * work; pressing it unfolds every task in place, each with its detail.
 * Where its lane is folded to a rail, as in a narrow window, it goes into
 * the first lane that shows, so the mission stays in sight.
 */

/** The lane the mission's card is in, from the tasks it folds in. */
export const missionLane = (mission: Mission): BoardLane => {
  const folded = mission.order.filter((one) => !needsYou(one))
  if (folded.some((one) => atWork(one.stand))) return BoardLane.Running
  if (mission.order.every((one) => one.stand === 'done')) return BoardLane.Settled
  return BoardLane.Next
}

/** The card counts once in its lane; Settled counts the tasks it folds in, as they'd be there. */
export const missionLeadCount = (lane: BoardLane, mission: Mission) =>
  missionLane(mission) === lane ? { count: lane === BoardLane.Settled ? mission.total : 1, shows: true } : { count: 0, shows: false }

/** Where the card stands, as a card's glyph says it, from what it folds in: at work, waiting, or merged. Its word is the mission's. */
const statusOf = (mission: Mission, folded: ReadonlyArray<NodeView>): TaskStatus => {
  if (folded.some((one) => atWork(one.stand))) return TaskStatus.Running
  if (mission.order.every((one) => one.stand === 'done')) return TaskStatus.Done
  return TaskStatus.Queued
}

/** What a task that failed holds up, in a line: Runs failed: VPS proof can't start. */
const stuckOf = (mission: Mission): string | null => {
  const failed = mission.order.filter((one) => one.stand === 'failed')
  if (failed.length === 0) return null
  const stuck = mission.order.filter((one) => one.stand === 'stuck')
  const names = (nodes: ReadonlyArray<NodeView>) => listed(nodes.map((one) => one.spec.short))
  return stuck.length === 0 ? `${names(failed)} failed` : `${names(failed)} failed: ${names(stuck)} can’t start`
}

/** The lanes whose heads are drawn now: open, with something in them. A lane folded to a rail draws none. */
const showing = store<ReadonlySet<BoardLane>>(new Set())
/** The card unfolded, wherever it is. */
const unfolded = store(false)

/** Where the card goes when its own lane is a rail (a narrow window): into the first lane that shows, so it stays in sight. */
const ORDER: ReadonlyArray<BoardLane> = [BoardLane.Yours, BoardLane.Running, BoardLane.Next, BoardLane.Settled]
const hostOf = (mission: Mission, lanes: ReadonlySet<BoardLane>): BoardLane => {
  const own = missionLane(mission)
  return lanes.size === 0 || lanes.has(own) ? own : (ORDER.find((one) => lanes.has(one)) ?? own)
}

export function MissionCardLead({ lane, mission }: { lane: BoardLane; mission: Mission }) {
  const lanes = useStore(showing)
  const open = useStore(unfolded)
  useLayoutEffect(() => {
    showing.set((was) => (was.has(lane) ? was : new Set([...was, lane])))
    return () =>
      showing.set((was) => {
        const next = new Set(was)
        next.delete(lane)
        return next
      })
  }, [lane])
  if (hostOf(mission, lanes) !== lane) return null
  return <MissionCard mission={mission} open={open} onToggle={() => unfolded.set((was) => !was)} />
}

export function MissionCard({ mission, open, onToggle }: { mission: Mission; open: boolean; onToggle: () => void }) {
  const folded = mission.order.filter((one) => !needsYou(one))
  const status = statusOf(mission, folded)
  const working = folded.filter((one) => atWork(one.stand))
  const problem = stuckOf(mission)
  const shown = open ? mission.order : working
  return (
    <BoardCard
      data-move={`mission-${mission.graph.scenario.key}`}
      status={status}
      word={word()}
      at={ranFor(mission.minutes)}
      title={mission.graph.scenario.name}
      {...(problem === null ? {} : { problem })}
      object={
        <div className={s.cardBody}>
          <Strip mission={mission} />
          {shown.length > 0 && (
            <ul className={s.lines}>
              {shown.map((node) => (
                <li key={node.key}>
                  <TaskLine node={node} mission={mission} stacked />
                </li>
              ))}
            </ul>
          )}
        </div>
      }
      foot={
        <FactLine>
          <Fact key="merged">{progressOf(mission)}</Fact>
        </FactLine>
      }
      next={
        <NextStep onPress={onToggle} aria-expanded={open}>
          {open ? 'Fold' : `All ${mission.total} tasks`}
        </NextStep>
      }
      onOpen={onToggle}
    />
  )
}
