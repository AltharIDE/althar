// Scrappy: the kit as the board sees it here: Running starts with C's card, a lead-started task says where it came from, and in B sits under its parent.
import { Children, type ComponentProps, isValidElement, type ReactElement } from 'react'

import { BoardCard as RealBoardCard } from '../../../src/board/BoardCard/BoardCard'
import { BoardColumn as RealBoardColumn, BoardEmpty as RealBoardEmpty } from '../../../src/board/Board/Board'
import { LinkButton } from '../../../src/primitives/LinkButton/LinkButton'
import { openNewTask } from './projectUi'
import { BoardLane } from '../../../src/foundations/vocabulary'
import { BoardStart } from '../directions/start/BoardStart'
import { Lineage, lineageText } from '../directions/lineage/Lineage'
import { CHILD, PARENT } from '../data'
import { useProto } from '../state'
import s from '../directions/lineage/lineage.module.css'

export * from '../../../src/index'

export function BoardCard(props: ComponentProps<typeof RealBoardCard>) {
  const p = useProto()
  const fresh = p.started.find((one) => one.title === props.title)
  const child = props.title === CHILD.title
  const parent = props.title === PARENT.title
  if (p.surface === 'lineage' && p.direction !== 'Today') {
    if (child)
      return (
        <RealBoardCard
          {...props}
          {...(p.direction === 'B' && p.childHeld ? { word: lineageText.held, status: undefined } : {})}
          foot={<Lineage parent={PARENT.title} onOpen={() => window.location.assign('#/threads/th-adr')} />}
        />
      )
    if (parent && p.direction === 'B') return <RealBoardCard {...props} foot={<span className={s.count}>{lineageText.started(1)}</span>} />
  }
  return <RealBoardCard {...props} className={fresh === undefined ? props.className : `${props.className ?? ''} ${s.fresh}`} />
}

/** Puts the child task's card right under its parent's, a little in, as B has it. */
const nested = (children: React.ReactNode) => {
  const all = Children.toArray(children) as ReactElement<{ title?: string }>[]
  const child = all.find((one) => isValidElement(one) && one.props.title === CHILD.title)
  if (child === undefined) return children
  const rest = all.filter((one) => one !== child)
  const at = rest.findIndex((one) => one.props.title === PARENT.title)
  if (at < 0) return children
  return [
    ...rest.slice(0, at + 1),
    <div key="nested" className={s.nested}>
      {child}
    </div>,
    ...rest.slice(at + 1),
  ]
}

export function BoardColumn(props: ComponentProps<typeof RealBoardColumn>) {
  const p = useProto()
  if (props.lane !== BoardLane.Running) return <RealBoardColumn {...props} />
  if (p.surface === 'start' && p.direction === 'C')
    return (
      <RealBoardColumn {...props} filled>
        <BoardStart />
        {props.children}
      </RealBoardColumn>
    )
  if (p.surface === 'lineage' && p.direction === 'B') return <RealBoardColumn {...props}>{nested(props.children)}</RealBoardColumn>
  return <RealBoardColumn {...props} />
}

/** Up next, empty: work you start or the coordinator plans waits here for a free agent; either way in. */
export function BoardEmpty(props: ComponentProps<typeof RealBoardEmpty>) {
  const p = useProto()
  if (p.surface !== 'start' || p.direction === 'Today') return <RealBoardEmpty {...props} />
  return (
    <RealBoardEmpty
      title={props.title}
      action={
        <span className={s.ways}>
          <LinkButton onClick={openNewTask}>New task</LinkButton>
          {props.action}
        </span>
      }
    >
      Tasks wait here for a free agent.
    </RealBoardEmpty>
  )
}
