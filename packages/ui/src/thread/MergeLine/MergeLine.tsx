import type { ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Rhythm } from '../../lib/rhythm'
import { safeHref } from '../../lib/safeHref'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './MergeLine.module.css'

/*
 * The merge line for a branch, as one card in the thread that stays one card:
 * each pull request in order, its number and title a link, and where it
 * stands. It is drawn again as things change, never posted again. A pull
 * request that needs someone says what is wrong and who settles it under its
 * title. Once every one has merged it folds to a single line.
 */

export type MergeLineState = 'waiting' | 'checks' | 'queued' | 'merging' | 'merged' | 'sent_back' | 'conflict'

export interface MergeLineRow {
  number: number
  title: string
  /** Where its pull request is, on its host. */
  url: string
  state: MergeLineState
  /** For one that needs someone: what is wrong, and who settles it. */
  reason?: string | undefined
}

export interface MergeLineText {
  state: Record<MergeLineState, string>
  /** The folded line, before the numbers. */
  merged: string
  /** Before the branch, where it isn't the default. */
  into: string
  /** Read after a link that opens a new tab. */
  newTab: string
}

export const mergeLineText: MergeLineText = {
  state: {
    waiting: 'Waiting',
    checks: 'Checks running',
    queued: 'In the queue',
    merging: 'Merging',
    merged: 'Merged',
    sent_back: 'Sent back',
    conflict: 'Conflict',
  },
  merged: 'Merged',
  into: 'Into',
  newTab: '(opens in a new tab)',
}

export type MergeLineProps = RootProps<
  'section',
  {
    rows: ReadonlyArray<MergeLineRow>
    /** The branch they merge into, where it isn't the repository's default. */
    branch?: string | null | undefined
    /** What the card is, for a screen reader. */
    label?: string
    text?: Partial<MergeLineText>
  }
>

/** A pull request's number, as a link out where its address is http or https. */
function Pull({ href, children, t }: { href: string; children: ReactNode; t: MergeLineText }) {
  const safe = safeHref(href)
  if (safe === undefined) return <span>{children}</span>
  return (
    <a href={safe} target="_blank" rel="noreferrer" className={s.link}>
      {children}
      <VisuallyHidden> {t.newTab}</VisuallyHidden>
    </a>
  )
}

/** The mark before a pull request: a check for what merged, a live dot for what runs, a ring for what waits, a cross for what needs someone. */
function Mark({ state }: { state: MergeLineState }) {
  switch (state) {
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
      return <span className={s.ring} aria-hidden="true" />
  }
}

/** The merge line of a branch: each pull request, in order, with where it stands; folded to one line once all have merged. */
export function MergeLine({ rows, branch, label = 'Merge line', text, className, ...rest }: MergeLineProps) {
  const t = { ...mergeLineText, ...text, state: { ...mergeLineText.state, ...text?.state } }
  if (rows.length === 0) return null
  if (rows.every((row) => row.state === 'merged'))
    return (
      <section aria-label={label} className={cx(s.folded, className)} data-rhythm={Rhythm.Card} {...rest}>
        <span className={s.doneMark}>
          <Icon name="check" size={11} />
        </span>
        <span className={s.foldedText}>
          {t.merged}{' '}
          {rows.map((row, index) => (
            <span key={row.number}>
              {index > 0 && ', '}
              <Pull href={row.url} t={t}>
                #{row.number}
              </Pull>
            </span>
          ))}
          {branch != null && (
            <span className={s.branch}>
              {' '}
              {t.into} <span className={s.mono}>{branch}</span>
            </span>
          )}
        </span>
      </section>
    )
  return (
    <section aria-label={label} className={cx(s.card, className)} data-rhythm={Rhythm.Card} {...rest}>
      {branch != null && (
        <p className={s.head}>
          {t.into} <span className={s.mono}>{branch}</span>
        </p>
      )}
      <ol className={s.rows}>
        {rows.map((row) => (
          <li key={row.number} className={cx(s.row, row.state === 'sent_back' ? s.sentBack : s[row.state])} data-move={row.number}>
            <span className={s.mark}>
              <Mark state={row.state} />
            </span>
            <span className={s.main}>
              <Pull href={row.url} t={t}>
                <span className={s.number}>#{row.number}</span>
                {row.title !== '' && <span className={s.title}> {row.title}</span>}
              </Pull>
              {row.reason !== undefined && row.reason !== '' && <span className={s.reason}>{row.reason}</span>}
            </span>
            <span className={s.state}>{t.state[row.state]}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
