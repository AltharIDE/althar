import type { AgentStatus } from '@althar/contracts'
import { BoardCard as KitBoardCard, type BoardCardProps, BoardLane, NextRow as KitNextRow, type NextRowProps } from '@althar/ui'
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react'

import type { CardActions } from '../../../src/renderer/features/board/BoardView'
import type { Lanes } from '../../../src/renderer/features/board/lanes'
import { noun } from '../plan'
import { option, stage, useStore, useWorld, worldNow } from '../state'
import { atWork, type Mission, missionNow, needsYou } from './mission'
import { MissionCardLead, missionLeadCount } from './MissionCard'
import { Tag } from './pieces'
import { SwimCell, swimCount } from './Swimlane'

/*
 * Where the board's options reach into the app's own board (patches.ts):
 * every card and Up next row draws through here, so a task of the mission
 * can carry its mark (A, C, D); each lane starts with what the option puts
 * at its head (A's card for the mission, B's row), and counts it.
 */

/** What the app's board was given, for what the options draw inside its lanes with its own cards. */
export interface BoardGiven {
  readonly lanes: Lanes
  readonly agents: ReadonlyArray<AgentStatus>
  readonly now: string
  readonly onOpen: (threadId: string) => void
  readonly actions?: CardActions | undefined
  readonly onSignIn?: ((agentId: string) => void) | undefined
}

export const Given = createContext<BoardGiven | null>(null)
export const useGiven = () => useContext(Given)

/** The mission now, as a card reads it; null while it's planned. */
export const useBoardMission = (): Mission | null => {
  useStore(noun)
  useStore(stage)
  return missionNow(useWorld())
}

/** A card's task, by the key it moves by. */
const moveKey = (props: object): string | undefined => (props as Record<string, unknown>)['data-move'] as string | undefined

/*
 * Pointing at one of the mission's cards a moment (C) opens its graph from its mark; what it stands on stays open while
 * the pointer is there or in the graph.
 */
const DWELL = 550
const LEAVE = 240

const useDwell = () => {
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const later = (to: boolean, ms: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(to), ms)
  }
  return {
    open,
    setOpen: (to: boolean) => {
      clearTimeout(timer.current)
      setOpen(to)
    },
    enter: () => later(true, DWELL),
    leave: () => later(false, LEAVE),
    stay: () => clearTimeout(timer.current),
  }
}

/** Its mark at its foot, beside what the card says there. */
const withTag = (foot: ReactNode, tag: ReactNode) => (
  <>
    {foot}
    {tag}
  </>
)

/** A card on the board: the app's own, with the mission's mark where it is one of its tasks. */
export function BoardCard(props: BoardCardProps) {
  const mission = useBoardMission()
  const picked = useStore(option.board)
  const dwell = useDwell()
  const key = moveKey(props)
  const node = key === undefined ? undefined : mission?.byTaskId(key)
  // B draws the mission's cards in its own row, where the row says whose they are.
  if (mission === null || node === undefined || picked === 'b') return <KitBoardCard {...props} />
  const pointed = picked === 'c'
  return (
    <KitBoardCard
      {...props}
      {...(pointed ? { onPointerEnter: dwell.enter, onPointerLeave: dwell.leave } : {})}
      foot={withTag(
        props.foot,
        <Tag
          mission={mission}
          node={node}
          {...(pointed ? { open: dwell.open, onOpenChange: dwell.setOpen, onStay: dwell.stay, onLeave: dwell.leave } : {})}
        />,
      )}
    />
  )
}

/**
 * A row up next: the app's own, with the mission's mark where it is one of its tasks: in its top line, after its place,
 * where a row says what kind of work it is, so the row grows no taller.
 */
export function NextRow(props: NextRowProps) {
  const mission = useBoardMission()
  const picked = useStore(option.board)
  const dwell = useDwell()
  const key = moveKey(props)
  const node = key === undefined ? undefined : mission?.byTaskId(key)
  if (mission === null || node === undefined || picked === 'b') return <KitNextRow {...props} />
  const pointed = picked === 'c'
  const tag = (
    <Tag
      mission={mission}
      node={node}
      {...(pointed ? { open: dwell.open, onOpenChange: dwell.setOpen, onStay: dwell.stay, onLeave: dwell.leave } : {})}
    />
  )
  return (
    <KitNextRow
      {...props}
      {...(pointed ? { onPointerEnter: dwell.enter, onPointerLeave: dwell.leave } : {})}
      // The row's kind is words; the mark is words too, and a button for its graph.
      kind={tag as unknown as string}
    />
  )
}

/** What the option on show puts at the head of a lane: A's card for the mission, in the lane of its loudest task; B's row. */
export function LaneLead({ lane }: { lane: BoardLane }) {
  const picked = useStore(option.board)
  const mission = useBoardMission()
  if (mission === null) return null
  if (picked === 'a') return <MissionCardLead lane={lane} mission={mission} />
  if (picked === 'b') return <SwimCell lane={lane} mission={mission} />
  return null
}

/** Whether a lane holds nothing but what the option puts at its head, as it was last drawn: B's row keeps the lane's own empty box under it. */
export const emptyBeside: Partial<Record<BoardLane, boolean>> = {}

/** A lane's count, and whether it has anything to show, with what the option puts at its head. */
export const laneOf = (lane: BoardLane, count: number, filled: boolean): { count: number; filled: boolean } => {
  const picked = option.board.get()
  const mission = missionNow(worldNow())
  if (mission === null) return { count, filled }
  const extra = picked === 'a' ? missionLeadCount(lane, mission) : picked === 'b' ? swimCount(lane, mission) : null
  if (extra === null) return { count, filled }
  emptyBeside[lane] = !filled
  return { count: count + extra.count, filled: filled || extra.shows }
}

/**
 * Up next's words where nothing is left in it but the mission's tasks that wait, folded into its card (A) or its lane
 * (D): where they are, rather than that nothing is queued. Null where Up next says what it always does.
 */
export const labUpNextEmpty = (): { title: string; how: string } | null => {
  const picked = option.board.get()
  const mission = missionNow(worldNow())
  if (mission === null || (picked !== 'a' && picked !== 'd')) return null
  if (!mission.order.some((one) => !needsYou(one) && one.stand !== 'done' && !atWork(one.stand))) return null
  return {
    title: 'Nothing else queued',
    how: `The rest of ${mission.graph.scenario.name} waits in its ${picked === 'a' ? 'card' : 'lane'}.`,
  }
}
