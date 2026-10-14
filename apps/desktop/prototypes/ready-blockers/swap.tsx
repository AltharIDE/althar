import { Children, isValidElement, type ReactElement } from 'react'

import { BoardColumn as KitColumn, type BoardColumnProps } from '../../../../packages/ui/src/board/Board/Board'
import { BoardCard as KitCard, type BoardCardProps } from '../../../../packages/ui/src/board/BoardCard/BoardCard'
import { BoardLane, TaskStatus } from '../../../../packages/ui/src/foundations/vocabulary'
import { NeedLine as KitLine, type NeedLineProps } from '../../../../packages/ui/src/home/NeedLine/NeedLine'
import { kindWords } from '../../src/renderer/shared/calls'
import { useDirection } from './directions'
import { GroupHead } from './parts'
import { CASES, FACTS } from './scenario'
import { type Group, standingOf } from './standing'
import { groupWords } from './words'

/*
 * The kit's BoardCard, BoardColumn and NeedLine, as `kit.ts` hands them to
 * the app's own BoardView and HomeView. A ready change (the app's word for
 * it, Ready to accept, on a task of the scenario) is drawn as the page's
 * direction says; anything else, and everything on today's page, is the
 * kit's component with the app's props, untouched.
 */

/** A ready change of the scenario, by its title: its task and what stands between it and merging. */
const readyOf = (title: string) => {
  const found = CASES.find((one) => one.task.title === title)
  if (found === undefined || found.task.change === null) return undefined
  return { change: found.task.change, standing: standingOf(found.task, FACTS.get(title)) }
}

export function BoardCard(props: BoardCardProps) {
  const direction = useDirection()
  const ready = props.status === TaskStatus.Yours && props.word === kindWords.ready ? readyOf(props.title) : undefined
  if (direction.card === undefined || ready === undefined) return <KitCard {...props} />
  return <KitCard {...direction.card(props, ready.standing)} />
}

export function NeedLine(props: NeedLineProps) {
  const direction = useDirection()
  const ready = props.kind === kindWords.ready ? readyOf(props.title) : undefined
  if (direction.line === undefined || ready === undefined) return <KitLine {...props} />
  return <KitLine {...direction.line(props, ready.standing, ready.change)} />
}

const GROUPS: ReadonlyArray<Group> = ['merge', 'blocked', 'waiting']

/** Needs you, for a direction that groups it: its calls as ever, then its ready cards under a head per group. */
export function BoardColumn(props: BoardColumnProps) {
  const direction = useDirection()
  if (direction.grouped !== true || props.lane !== BoardLane.Yours) return <KitColumn {...props} />
  const cards = Children.toArray(props.children).filter(isValidElement) as ReadonlyArray<ReactElement<BoardCardProps>>
  const groupOf = (card: ReactElement<BoardCardProps>): Group | null =>
    card.props.word === kindWords.ready ? (readyOf(card.props.title)?.standing.group ?? null) : null
  const asks = cards.filter((card) => groupOf(card) === null)
  return (
    <KitColumn {...props}>
      {asks}
      {GROUPS.map((group) => {
        const held = cards.filter((card) => groupOf(card) === group)
        return held.length === 0
          ? null
          : [<GroupHead key={`head-${group}`} group={group} name={groupWords[group]} count={held.length} />, ...held]
      })}
    </KitColumn>
  )
}
