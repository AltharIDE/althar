import { type ReactNode, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { BoardColumn as KitBoardColumn, type BoardColumnProps, BoardDivider } from '../../../../packages/ui/src/board/Board/Board'
import { NextLine as KitNextLine, type NextLineProps } from '../../../../packages/ui/src/board/NextLine/NextLine'
import { NextRow as KitNextRow, type NextRowProps } from '../../../../packages/ui/src/board/NextRow/NextRow'
import { LoadReadings } from '../../../../packages/ui/src/chrome/LoadMeter/LoadPeek'
import { TaskHeader as KitTaskHeader, type TaskHeaderProps } from '../../../../packages/ui/src/chrome/TaskHeader/TaskHeader'
import { Behind as KitBehind, type BehindProps } from '../../../../packages/ui/src/composer/Behind/Behind'
import { Icon } from '../../../../packages/ui/src/foundations/Icon/Icon'
import { BoardLane, TaskStatus } from '../../../../packages/ui/src/foundations/vocabulary'
import { cx } from '../../../../packages/ui/src/lib/cx'
import { ActionButton } from '../../../../packages/ui/src/primitives/ActionButton/ActionButton'
import { LinkButton } from '../../../../packages/ui/src/primitives/LinkButton/LinkButton'
import { Popover } from '../../../../packages/ui/src/primitives/Popover/Popover'
import { inLineWords } from '../../src/renderer/shared/agents'
import { type Lab, until, useLab, words } from './context'
import { agentsOf, loadOf, SLOTS } from './data'
import w from './wrapped.module.css'

/*
 * The kit's own components, as the app gets them in the lab: each draws as
 * it is, unless the direction showing says something there while tasks are
 * held back. Nothing here draws a lookalike: a row is the kit's NextRow with
 * other words, a lane the kit's BoardColumn with something before or after
 * its cards.
 */

/** Held back now, as the direction showing says it: null for As built, or nothing held. */
const heldOf = (lab: Lab | null) =>
  lab === null || lab.direction === '0' || lab.world.why === null || lab.world.held.length === 0 ? null : lab

/** What the address opens at once, for pictures: open=tag, D's heading; open=chip, the chip over the composer. */
const opened = (what: string) => new URLSearchParams(location.search).get('open') === what

const capital = (line: string) => line.charAt(0).toUpperCase() + line.slice(1)

/* ---- a row in line ---------------------------------------------------------------------------------- */

export function NextRow(props: NextRowProps) {
  const lab = heldOf(useLab())
  const id = (props as { 'data-move'?: string })['data-move']
  if (lab === null || id === undefined || !lab.world.held.includes(id)) return <KitNextRow {...props} />
  const why = lab.world.why!
  // Every direction lets a held row start now, in its line's place, where the person points at it.
  const anyway = { onStart: () => lab.startAnyway(id), text: { ...props.text, start: words.startAnyway } }
  switch (lab.direction) {
    case 'a':
      // The row says it, warm, and until when; the place it had in line is the order it starts in once room frees.
      return <KitNextRow {...props} {...anyway} reason={words.heldLine(why)} className={cx(props.className, w.heldRow)} />
    default:
      // A count of busy agents, from a row that goes on, reads as room to spare beside the number: its place says it.
      return <KitNextRow {...props} {...anyway} {...(/ busy/.test(props.reason) ? { reason: inLineWords(props.place) } : {})} />
  }
}

/* ---- the line ------------------------------------------------------------------------------------------ */

/**
 * B: the line grouped as Up next groups it already (Your order, Planned, Paused): a divider over the rows held back says
 * until when, and how many at a time of the number, which opens This Mac; one over the rows after them says they wait for
 * an agent anyway. Rows keep their own words and their places.
 */
export function NextLine(props: NextLineProps) {
  const lab = heldOf(useLab())
  if (lab === null || lab.direction !== 'b') return <KitNextLine {...props} />
  const { held, why, atOnce, configured } = lab.world
  const rows = props.rows.map((row) =>
    held.includes(row.id) ? { ...row, group: 'held' } : row.group === 'waiting' ? { ...row, group: 'after' } : row,
  )
  return (
    <>
      <BoardDivider
        end={
          <LinkButton className={w.dividerLink} onClick={lab.showMac}>
            {words.atOnceShort(atOnce, configured)}
          </LinkButton>
        }
      >
        <span className={w.heldLabel} title={words.heldLine(why!)}>
          <Icon name="load" size={11} className={w.warmGlyph} />
          {words.heldLine(why!)}
        </span>
      </BoardDivider>
      <KitNextLine {...props} rows={rows} heads={{ ...props.heads, after: <BoardDivider>{words.after}</BoardDivider> }} />
    </>
  )
}

/* ---- a lane ------------------------------------------------------------------------------------------ */

export function BoardColumn(props: BoardColumnProps) {
  const lab = heldOf(useLab())
  if (lab === null) return <KitBoardColumn {...props} />
  if (props.lane === BoardLane.Next && lab.direction === 'd')
    return (
      <>
        <KitBoardColumn {...props} />
        <HeadTag lab={lab} />
      </>
    )
  if (props.lane === BoardLane.Running && lab.direction === 'c')
    return (
      <KitBoardColumn {...props}>
        {props.children}
        <HeldRoom lab={lab} />
      </KitBoardColumn>
    )
  return <KitBoardColumn {...props} />
}

/** C: Running ends with the room the pressure holds back, and the task that would take it first. */
function HeldRoom({ lab }: { lab: Lab }) {
  const { atOnce, configured, why, held, line } = lab.world
  const first = line.find((one) => one.id === held[0])
  // The room this board's line would take: places beyond it may go to another project's work.
  const room = held.length
  return (
    <article className={w.room} aria-label={words.room(room)}>
      <span className={w.roomTop}>
        <Icon name="load" size={11} />
        {words.held}
      </span>
      <span className={w.roomTitle}>{words.room(room)}</span>
      <span className={w.roomLine}>
        {capital(until(why!))}: {words.atOnce(atOnce, configured)}.
      </span>
      {first !== undefined && (
        <span className={w.roomFoot}>
          <span className={w.roomNext}>
            <span className={w.roomNextWord}>{words.next}</span>
            <button type="button" className={w.roomNextTitle} title={first.title} onClick={() => lab.open(first.id)}>
              {first.title}
            </button>
          </span>
          <ActionButton size="small" icon="play" onClick={() => lab.startAnyway(first.id)}>
            {words.startAnyway}
          </ActionButton>
        </span>
      )}
    </article>
  )
}

/** Up next's own head, once drawn: where D's tag goes, before the chevron that folds the lane. */
const useHead = (key: string) => {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const head = document.querySelector('section[data-lane="next"] > header')
    if (head === null) return
    const el = document.createElement('span')
    el.className = w.tagSlot!
    head.insertBefore(el, head.querySelector('[data-fold="collapse"]'))
    setSlot(el)
    return () => {
      el.remove()
      setSlot(null)
    }
  }, [key])
  return slot
}

/** D: the heading says how many at a time of the number, and opens This Mac's popover with what of this line is held back. */
function HeadTag({ lab }: { lab: Lab }) {
  const { atOnce, configured, why, held, line } = lab.world
  const slot = useHead(`${lab.world.scene}-${held.length}`)
  if (slot === null) return null
  const tag = (
    <Popover
      label={words.heldLine(why!)}
      placement="below"
      align="start"
      width={300}
      padded={false}
      initialFocus="panel"
      defaultOpen={opened('tag')}
      trigger={
        <button type="button" className={w.tag}>
          <Icon name="load" size={11} />
          {words.atOnceShort(atOnce, configured)}
        </button>
      }
    >
      <div className={w.peek}>
        {/* This Mac's own popover, as the bar's meter opens it, with what is held back of this board's line after it. */}
        <span className={w.peekTitle}>{words.showMac}</span>
        <LoadReadings load={loadOf(lab.world)} agents={agentsOf(lab.world)} slots={SLOTS} />
        <section className={w.peekRows}>
          <span className={w.eyebrow}>{words.held}</span>
          <ul className={w.peekList}>
            {held.map((id) => {
              const one = line.find((each) => each.id === id)
              return one === undefined ? null : (
                <li key={id} className={w.peekRow}>
                  <span className={w.peekRowTitle} title={one.title}>
                    {one.title}
                  </span>
                  <ActionButton size="small" onClick={() => lab.startAnyway(id)}>
                    {words.startAnyway}
                  </ActionButton>
                </li>
              )
            })}
          </ul>
        </section>
      </div>
    </Popover>
  )
  return createPortal(tag, slot)
}

/* ---- the task's own view ----------------------------------------------------------------------------- */

/** The task first in line, while it is held back: where it stands says so and until when, and why on hover. */
export function TaskHeader<F extends string>(props: TaskHeaderProps<F>) {
  const lab = heldOf(useLab())
  const first = lab?.world.line[0]
  if (lab === null || first === undefined || props.status !== TaskStatus.Queued || !lab.world.held.includes(first.id))
    return <KitTaskHeader {...props} />
  const { atOnce, configured, why } = lab.world
  return <KitTaskHeader {...props} state={words.heldLine(why!)} why={words.headerWhy(atOnce, configured, why!)} />
}

/** The chip over its composer: Held back rather than Waiting for a place; its popover, who is at work, and Start anyway. */
export function Behind(props: BehindProps): ReactNode {
  const lab = heldOf(useLab())
  const first = lab?.world.line[0]
  const shown = props.open === undefined && opened('chip') ? { ...props, defaultOpen: true } : props
  if (lab === null || first === undefined || props.wait == null || !lab.world.held.includes(first.id)) return <KitBehind {...shown} />
  return (
    <KitBehind
      {...shown}
      text={{ ...props.text, waiting: words.held, front: words.startAnyway }}
      onFront={() => lab.startAnyway(first.id)}
    />
  )
}
