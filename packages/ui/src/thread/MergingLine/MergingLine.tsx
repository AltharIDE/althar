import { useId, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Rhythm } from '../../lib/rhythm'
import { safeHref } from '../../lib/safeHref'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { type MergeLineState, mergeLineText } from '../MergeLine/MergeLine'
import s from './MergingLine.module.css'

/*
 * What is on its way into a branch, as one line at the thread's foot, under
 * whatever was said since it was asked: each pull request a mark and its
 * number, kept current in place. What was sent back says why under it; the
 * line opens to a row for each. A merge kept for later, whose pull request
 * isn't in the line yet, is one of them too, by its number or its task's
 * name, its mark a fainter ring. Once all are in, the thread holds the folded
 * merge line where it was asked, and this goes.
 */

export interface MergingRow {
  /** Tells it from the others, the same as it moves. */
  key: string
  /** As people say it: #1224, or its task's name while it has no pull request. */
  label: string
  /** Its pull request's title; empty where it has none yet. */
  title: string
  /** Where its pull request is; null while it has none. */
  url: string | null
  state: MergeLineState
  /** For one sent back or in conflict: what is wrong, and who settles it. */
  reason?: string | undefined
  /** For one kept for later, not in the line yet: what it waits for, "once its checks pass". */
  once?: string | undefined
}

export interface MergingLineText {
  state: Record<MergeLineState, string>
  /** Before what it is called, where there is no branch to name. */
  merging: string
  /** Before the branch, where it isn't the default. */
  into: string
  /** For one not in the line yet. */
  later: string
  /** After the label of one sent back, before why. */
  sentBack: string
  /** Read after a link that opens a new tab. */
  newTab: string
}

export const mergingLineText: MergingLineText = {
  state: mergeLineText.state,
  merging: 'Merging',
  into: 'Merging into',
  later: 'Not in line yet',
  sentBack: 'sent back.',
  newTab: mergeLineText.newTab,
}

export type MergingLineProps = RootProps<
  'section',
  {
    rows: ReadonlyArray<MergingRow>
    /** The branch they go into, where it isn't the repository's default. */
    branch?: string | null | undefined
    /** Opened at first, to its rows. */
    open?: boolean
    text?: Partial<MergingLineText>
  }
>

const trouble = (state: MergeLineState) => state === 'sent_back' || state === 'conflict'
const tone = (state: MergeLineState) => (state === 'sent_back' ? s.sentBack : s[state])
const later = (row: MergingRow) => row.url === null || row.once !== undefined

/** The mark before each: a check for what merged, a live dot while it runs, a ring for what waits its turn, a fainter one for what isn't in line yet, a cross for what came back. */
function Mark({ row }: { row: MergingRow }) {
  switch (row.state) {
    case 'merged':
      return <Icon name="check" size={11} />
    case 'checks':
    case 'merging':
      return <LiveDot ping />
    case 'sent_back':
    case 'conflict':
      return <Icon name="close" size={11} />
    case 'waiting':
    case 'queued':
      return <span className={cx(s.ring, later(row) && s.faint)} aria-hidden="true" />
  }
}

/** Its number and title, a link out where its address is http or https; or its task's name, while it has none. */
function Label({ row, t }: { row: MergingRow; t: MergingLineText }) {
  const href = row.url === null ? undefined : safeHref(row.url)
  const words = (
    <>
      <span className={s.number}>{row.label}</span>
      {row.title !== '' && <span className={s.title}> {row.title}</span>}
    </>
  )
  if (href === undefined) return <span className={s.label}>{words}</span>
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cx(s.label, s.link)}>
      {words}
      <VisuallyHidden> {t.newTab}</VisuallyHidden>
    </a>
  )
}

/** The merges on their way into a branch, as one line at the thread's foot that opens to a row for each. */
export function MergingLine({ rows, branch, open: opened = false, text, className, ...rest }: MergingLineProps) {
  const t = { ...mergingLineText, ...text, state: { ...mergingLineText.state, ...text?.state } }
  const [open, setOpen] = useState(opened)
  const listId = useId()
  if (rows.length === 0) return null
  const name = branch == null ? t.merging : t.into
  const said = (row: MergingRow) => (later(row) && row.state === 'waiting' ? t.later : t.state[row.state])
  // Read as one: what it is, then each with where it stands.
  const heard = `${branch == null ? name : `${name} ${branch}`}: ${rows.map((row) => `${row.label} ${said(row).toLowerCase()}`).join(', ')}`
  return (
    <section aria-label={branch == null ? name : `${name} ${branch}`} className={cx(s.line, className)} data-rhythm={Rhythm.Line} {...rest}>
      <button
        type="button"
        className={s.head}
        aria-label={heard}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((was) => !was)}
      >
        <span className={s.name}>
          {name}
          {branch != null && <span className={s.mono}> {branch}</span>}
        </span>
        <span className={s.tokens}>
          {rows.map((row) => (
            <span key={row.key} className={cx(s.token, tone(row.state))} data-move={row.key}>
              <span className={s.mark}>
                <Mark row={row} />
              </span>
              {row.label}
            </span>
          ))}
        </span>
        <span className={cx(s.chevron, open && s.chevronOpen)} aria-hidden="true">
          <Icon name="chevronD" size={11} />
        </span>
      </button>
      {!open &&
        rows
          .filter((row) => trouble(row.state) && row.reason !== undefined && row.reason !== '')
          .map((row) => (
            <p key={row.key} className={s.back}>
              <span className={s.backWho}>
                {row.label} {row.state === 'sent_back' ? t.sentBack : `${t.state[row.state].toLowerCase()}.`}
              </span>{' '}
              {row.reason}
            </p>
          ))}
      <ol id={listId} className={s.rows} hidden={!open}>
        {rows.map((row) => {
          const note = trouble(row.state) ? row.reason : row.once
          return (
            <li key={row.key} className={cx(s.row, tone(row.state))}>
              <span className={s.mark}>
                <Mark row={row} />
              </span>
              <span className={s.main}>
                <Label row={row} t={t} />
                {note !== undefined && note !== '' && <span className={s.note}>{`${note.charAt(0).toUpperCase()}${note.slice(1)}`}</span>}
              </span>
              <span className={s.state}>{said(row)}</span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
