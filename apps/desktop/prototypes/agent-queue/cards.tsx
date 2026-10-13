import { BoardColumn as KitColumn, type BoardColumnProps } from '../../../../packages/ui/src/board/Board/Board'
import { NextRow as KitRow, type NextRowProps } from '../../../../packages/ui/src/board/NextRow/NextRow'
import { WorkCard as KitCard, type WorkCardProps } from '../../../../packages/ui/src/board/WorkCard/WorkCard'
import { Dock as KitDock, type DockProps } from '../../../../packages/ui/src/dock/Dock/Dock'
import { BoardLane, TaskStatus, Wait } from '../../../../packages/ui/src/foundations/vocabulary'
import { HoverCard } from '../../../../packages/ui/src/primitives/HoverCard/HoverCard'
import { lineOf, useScene } from './scene'
import s from './cards.module.css'
import { dividerOf, laneOf, pausedOf, rowOf, stripOf, upNext } from './words'

/*
 * The kit's pieces the directions change, each finding its task on the
 * page's board: a row up next for waiting work, a running card for work
 * under way whose turn waits, Up next's lane (C's strip), and the dock's
 * name. Today, and anything not waiting, they are the kit's own.
 */

/** A row up next. Waiting work says its place in the direction's words, under A's and E's divider. */
export function NextRow(props: NextRowProps) {
  const { direction, tasks, next, tip } = useScene()
  const work = tasks.find((one) => one.slug === props.task)
  const q = work === undefined ? null : lineOf(work)
  const index = next.indexOf(props.task)
  const before = index > 0 ? tasks.find((one) => one.slug === next[index - 1]) : undefined
  const afterLine = before !== undefined && lineOf(before) !== null && (q === null || !upNext(q))
  const divider = dividerOf(direction)
  if (q === null || !upNext(q))
    return (
      <>
        {afterLine && (divider === null ? <hr className={s.rule} /> : <p className={s.divider}>Then</p>)}
        <KitRow {...props} />
      </>
    )
  const row = rowOf(q)
  const drawn = <KitRow {...props} wait={Wait.After} reason={row.reason} {...(row.kind === undefined ? {} : { kind: row.kind })} />
  return (
    <>
      {index === 0 && divider !== null && <p className={s.divider}>{divider}</p>}
      {row.tip === undefined ? (
        drawn
      ) : (
        <HoverCard card={row.tip} placement="below" width={260} {...(tip === props.task ? { open: true } : {})}>
          <div tabIndex={0} className={s.tipTarget}>
            {drawn}
          </div>
        </HoverCard>
      )}
    </>
  )
}

/** A running card. Work under way whose turn waits stays here in D and E, muted, saying so; what just started is marked. */
export function WorkCard(props: WorkCardProps) {
  const { tasks, fresh } = useScene()
  const work = tasks.find((one) => one.slug === props.task)
  const q = work === undefined ? null : lineOf(work)
  const current = fresh === props.task ? { current: true } : {}
  if (q === null || q.direction === 'today') return <KitCard {...props} {...current} />
  const paused = pausedOf(q)
  return (
    <div className={s.muted}>
      <KitCard
        {...props}
        status={TaskStatus.Queued}
        note={paused.note}
        text={{
          ...props.text,
          status: { ...props.text?.status, [TaskStatus.Queued]: paused.status } as Record<TaskStatus, string>,
        }}
      />
    </div>
  )
}

/** A lane. C's Up next opens with a dot for each agent this Mac runs at once, filled while it works. */
export function BoardColumn(props: BoardColumnProps) {
  const { direction, tasks } = useScene()
  if (direction !== 'c' || props.lane !== BoardLane.Next) return <KitColumn {...props} />
  const q = tasks.map(lineOf).find((one) => one !== null) ?? null
  const atOnce = q?.atOnce ?? 4
  const busy = q?.busy ?? 0
  return (
    <KitColumn {...props}>
      <div className={s.strip} role="img" aria-label={stripOf(busy, atOnce)}>
        <span className={s.dots}>
          {Array.from({ length: atOnce }, (_, i) => (
            <span key={i} className={i < busy ? s.on : s.off} />
          ))}
        </span>
        <span>{stripOf(busy, atOnce)}</span>
      </div>
      {props.children}
    </KitColumn>
  )
}

/** The dock. Its head names the lane its task is in: waiting work up next says Up next. */
export function Dock(props: DockProps) {
  const { tasks } = useScene()
  const work = tasks.find((one) => one.branch === props.sub)
  const q = work === undefined ? null : lineOf(work)
  if (q === null || q.direction === 'today') return <KitDock {...props} />
  return <KitDock {...props} name={laneOf(q)} />
}
