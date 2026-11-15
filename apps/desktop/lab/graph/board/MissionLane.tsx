import { BoardColumn, BoardLane, Icon } from '@althar/ui'
import { useLayoutEffect, useRef, useState } from 'react'

import { Mark, Node, openTask } from '../graph/parts'
import { word } from '../plan'
import { atWork, type Mission, ranFor } from './mission'
import { progressOf } from './pieces'
import s from './board.module.css'

/*
 * D · A lane of its own. Before Up next, the mission has a lane: its tasks
 * top to bottom in the order they can start, as stops on one line, each
 * with where it stands; the line is drawn in from what merged and dashed on
 * to what's to come, with a little more room where a wave ends. Pointing at
 * a stop lights what it waits for and what waits for it, and opens its
 * detail. Its tasks leave the other lanes, but for what needs the person,
 * which shows on its own in Needs you, as it always would. Where the board
 * has no room for another lane, the mission is a rail: its stops alone, a
 * mark each, down the line.
 */

/** The board's narrowest beside the mission's lane: one lane and three rails. Narrower, the mission's lane is a rail too. */
const ROOM = 186 + 3 * 40 + 220

export function MissionLane({ mission }: { mission: Mission }) {
  const [lit, setLit] = useState<string | null>(null)
  const near = lit === null ? null : nearOf(mission, lit)
  const waveEnds = new Set(mission.waves.map((wave) => wave.at(-1)?.key))
  return (
    <BoardColumn
      lane={BoardLane.Next}
      count={mission.total - mission.merged}
      text={{
        lane: { [BoardLane.Next]: mission.graph.scenario.name, [BoardLane.Running]: '', [BoardLane.Yours]: '', [BoardLane.Settled]: '' },
      }}
    >
      <p className={s.laneAt}>
        <span>{word()}</span>
        <span>{progressOf(mission)}</span>
      </p>
      <ol className={s.stops} onPointerLeave={() => setLit(null)}>
        {mission.order.map((node, i) => {
          const next = mission.order[i + 1]
          return (
            <li
              key={node.key}
              className={[
                s.stop,
                s[node.stand],
                waveEnds.has(node.key) && next !== undefined && s.waveEnd,
                next === undefined && s.last,
                node.stand === 'done' && s.passed,
                near !== null && !near.has(node.key) && s.away,
                lit === node.key && s.pointed,
              ]
                .filter(Boolean)
                .join(' ')}
              onPointerEnter={() => setLit(node.key)}
            >
              <Node node={node} graph={mission.graph} placement="right">
                <button type="button" className={s.stopButton} onClick={() => openTask(node)}>
                  <span className={s.stopMark}>
                    <Mark stand={node.stand} />
                  </span>
                  <span className={s.stopName} title={node.spec.title}>
                    {node.spec.short}
                  </span>
                  {atWork(node.stand) && node.worked !== null && <span className={s.stopAt}>{ranFor(node.worked)}</span>}
                  <span className={[s.stopWord, s[node.tone]].join(' ')} title={node.word}>
                    {node.word}
                  </span>
                </button>
              </Node>
            </li>
          )
        })}
      </ol>
    </BoardColumn>
  )
}

/** What a task waits for and what waits for it, with it: what pointing at it lights. */
const nearOf = (mission: Mission, key: string): ReadonlySet<string> => {
  const near = new Set([key])
  for (const edge of mission.graph.edges) {
    if (edge.to === key) near.add(edge.from)
    if (edge.from === key) near.add(edge.to)
  }
  return near
}

/** The mission as a rail, where the board has no room for its lane: a mark a stop, down the line, and its name written down it. Pressing it opens the lane. */
export function MissionRail({ mission, onOpen }: { mission: Mission; onOpen: () => void }) {
  return (
    <section className={s.rail} aria-label={mission.graph.scenario.name}>
      <ol className={s.railStops}>
        {mission.order.map((node) => (
          <li key={node.key} className={[s.railStop, s[node.stand]].join(' ')}>
            <Mark stand={node.stand} />
          </li>
        ))}
      </ol>
      <span className={s.railName}>{mission.graph.scenario.name}</span>
      <button type="button" className={s.railOpen} aria-label={`Expand ${mission.graph.scenario.name}`} onClick={onOpen}>
        <Icon name="chevron" size={12} />
      </button>
    </section>
  )
}

/** The mission's lane before the board, or its rail where the board has no room for it; the person can open the rail and fold the lane. */
export function WithMissionLane({ mission, children }: { mission: Mission | null; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [chosen, setChosen] = useState<'lane' | 'rail' | null>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    const measure = () => setWidth(element.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const rail = chosen === null ? width > 0 && width < ROOM : chosen === 'rail'
  return (
    <div ref={ref} className={s.withLane}>
      {mission !== null &&
        (rail ? (
          <MissionRail mission={mission} onOpen={() => setChosen('lane')} />
        ) : (
          <div className={s.laneBox}>
            <MissionLane mission={mission} />
          </div>
        ))}
      <div className={s.boardBox}>{children}</div>
    </div>
  )
}
