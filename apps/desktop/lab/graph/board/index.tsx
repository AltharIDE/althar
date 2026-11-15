import { type ComponentProps, type ReactNode, useLayoutEffect, useRef, useState } from 'react'

import { BoardView as AppBoardView } from '../../../src/renderer/features/board/BoardView'
import { option, useStore } from '../state'
import { type Mission, needsYou, useMission, without } from './mission'
import { WithMissionLane } from './MissionLane'
import { Given } from './seam'
import s from './board.module.css'

/*
 * The board, as the option on show draws it: the app's own BoardView, with
 * the launched mission kept in sight while it runs (options.ts). Each option
 * takes some of the mission's tasks out of the lanes it hands the board, and
 * draws them its own way: in one card (A), in a row of their own (B), in a
 * lane of their own (D); C leaves them where they are and marks them. Before
 * launch, and for any other work, the board is the app's.
 */
export function BoardPart(props: ComponentProps<typeof AppBoardView>) {
  const picked = useStore(option.board)
  const mission = useMission()
  const lanes = mission === null ? props.lanes : lanesFor(picked, mission, props.lanes)
  const board = (
    <Given.Provider
      value={{
        lanes: props.lanes,
        agents: props.agents,
        now: props.now,
        onOpen: props.onOpen,
        actions: props.actions,
        onSignIn: props.onSignIn,
      }}
    >
      <AppBoardView {...props} lanes={lanes} />
    </Given.Provider>
  )
  if (picked === 'd') return <WithMissionLane mission={mission}>{board}</WithMissionLane>
  if (picked === 'c' && mission !== null) return <Lit mission={mission}>{board}</Lit>
  return board
}

/** The lanes the board is handed: without what A folds into its card and D into its lane (but what needs the person), and without all of it for B's row. */
const lanesFor = (picked: string, mission: Mission, lanes: ComponentProps<typeof AppBoardView>['lanes']) => {
  if (picked === 'a' || picked === 'd')
    return without(lanes, (task) => {
      const node = mission.byTaskId(task.taskId)
      return node !== undefined && !needsYou(node)
    })
  if (picked === 'b') return without(lanes, (task) => mission.byTaskId(task.taskId) !== undefined)
  return lanes
}

/**
 * C: the board with the mission's cards marked, so that pointing at one of
 * them steps the rest of the board back, its siblings staying as they are.
 */
function Lit({ mission, children }: { mission: Mission; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [lit, setLit] = useState(false)
  // Each of the mission's cards and rows, wherever it is on the board, is marked as one of it.
  useLayoutEffect(() => {
    for (const element of box.current?.querySelectorAll<HTMLElement>('[data-move]') ?? []) {
      const ours = mission.byTaskId(element.dataset.move ?? '') !== undefined
      if (ours !== element.hasAttribute('data-mission')) element.toggleAttribute('data-mission', ours)
    }
  })
  return (
    <div
      ref={box}
      className={[s.litBox, lit && s.lit].filter(Boolean).join(' ')}
      onPointerOver={(event) => {
        const target = event.target instanceof Element ? event.target.closest('[data-move]') : null
        setLit(target !== null && target.hasAttribute('data-mission'))
      }}
      onPointerLeave={() => setLit(false)}
    >
      {children}
    </div>
  )
}
