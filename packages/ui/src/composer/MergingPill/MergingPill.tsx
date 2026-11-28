import { Component, createRef, type ReactNode, useEffect, useId, useLayoutEffect, useRef } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { useControlled } from '../../lib/controlled'
import { cx } from '../../lib/cx'
import { edgeOf, type EdgeShot, playEdge, shootEdgeOnce } from '../../lib/edgeMorph'
import { safeHref } from '../../lib/safeHref'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { type MergeLineState, mergeLineText } from '../../thread/MergeLine/MergeLine'
import s from './MergingPill.module.css'

/*
 * What is on its way into a branch, as a pill on the composer's edge beside
 * whatever else floats there, so it stays in view while the thread scrolls
 * on: "Merging", then each pull request a mark and its number, kept current in
 * place. Pressed, it grows into a card the composer's width, a row for each:
 * its mark, number and title, where it stands, and why it came back or what it
 * waits for under it. Its head, or Escape, folds it back. A merge kept for
 * later, whose pull request isn't open yet, is one of them too, by its task's
 * name, its ring fainter. What came back says why on the composer's notice
 * line while the pill is folded (MergingBack).
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

export interface MergingPillText {
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

export const mergingPillText: MergingPillText = {
  state: mergeLineText.state,
  merging: 'Merging',
  into: 'Merging into',
  later: 'Not in line yet',
  sentBack: 'sent back.',
  newTab: mergeLineText.newTab,
}

export interface MergingPillProps {
  rows: ReadonlyArray<MergingRow>
  /** The branch they go into, where it isn't the repository's default. */
  branch?: string | null | undefined
  /** Opened into its card. Whoever holds what else opens on the composer's edge drives it, so only one is open there. */
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** All in: it goes, back to --scale-pop as it fades. */
  leaving?: boolean
  text?: Partial<MergingPillText>
  className?: string
}

const trouble = (row: MergingRow) => row.state === 'sent_back' || row.state === 'conflict'
const later = (row: MergingRow) => row.url === null || row.once !== undefined
const tone = (row: MergingRow) =>
  row.state === 'merged' ? s.merged : trouble(row) ? s.back : row.state === 'checks' || row.state === 'merging' ? s.live : undefined
/** A reason or a wait as a sentence: its first letter up. */
const sentence = (words: string) => `${words.charAt(0).toUpperCase()}${words.slice(1)}`
const textOf = (text: Partial<MergingPillText> | undefined): MergingPillText => ({
  ...mergingPillText,
  ...text,
  state: { ...mergingPillText.state, ...text?.state },
})

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

/**
 * Reads where everything on the composer's edge stands just before `step`
 * changes, and glides it from there once it has (lib/edgeMorph). A class, as
 * only a class hears of a change before the page is: getSnapshotBeforeUpdate.
 * Where two pills change at once (one opening as another folds), the first to
 * read the edge plays the change for both.
 */
class EdgeMorph extends Component<{ step: string; children: ReactNode }> {
  private readonly ref = createRef<HTMLDivElement>()
  override getSnapshotBeforeUpdate(was: Readonly<{ step: string }>): EdgeShot | null {
    return was.step === this.props.step ? null : shootEdgeOnce(edgeOf(this.ref.current))
  }
  override componentDidUpdate(_was: unknown, _state: unknown, shot: EdgeShot | null) {
    if (shot !== null) playEdge(shot, edgeOf(this.ref.current))
  }
  override render() {
    return (
      <div ref={this.ref} className={s.contents}>
        {this.props.children}
      </div>
    )
  }
}

/** The merges on their way into a branch, as a pill on the composer's edge that opens into a card of them. */
export function MergingPill({
  rows,
  branch,
  open: given,
  defaultOpen = false,
  onOpenChange,
  leaving = false,
  text,
  className,
}: MergingPillProps) {
  const t = textOf(text)
  const [open, setOpen] = useControlled(given, defaultOpen, onOpenChange)
  const pill = useRef<HTMLButtonElement>(null)
  const head = useRef<HTMLButtonElement>(null)
  const listId = useId()
  // Its pieces' names on the edge, its own, so two pills' never meet in a morph.
  const own = useId()
  // Folded, the tokens keep to one line inside the pill: those that don't fit wait in the card, and "…" says there are more.
  const tokens = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const line = tokens.current
    if (line === null) return
    const mark = () => {
      // Laid out whole first, then those that wrapped past the line are left out, so "…" sits right after the last that fits.
      for (const token of line.children) token.removeAttribute('data-cut')
      const top = (line.firstElementChild as HTMLElement | null)?.offsetTop ?? 0
      const off = [...line.children].filter((token) => (token as HTMLElement).offsetTop > top)
      for (const token of off) token.setAttribute('data-cut', '')
      line.toggleAttribute('data-cutting', off.length > 0)
    }
    mark()
    if (typeof ResizeObserver === 'undefined') return
    // What the pill has room for changes with the edge it sits on, not with the line it holds itself to.
    const observer = new ResizeObserver(mark)
    observer.observe(edgeOf(line) ?? line)
    return () => observer.disconnect()
  })
  // Focus follows what was pressed into what it became.
  const handed = useRef(false)
  const toggle = (next: boolean) => {
    handed.current = true
    setOpen(next)
  }
  useEffect(() => {
    if (!handed.current) return
    handed.current = false
    ;(open ? head : pill).current?.focus({ preventScroll: true })
  }, [open])
  // Escape folds it back, but from a field, whose Escape is its own.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (event.target instanceof Element && event.target.closest('textarea, input, select, [contenteditable="true"]') !== null) return
      event.preventDefault()
      handed.current = true
      setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  if (rows.length === 0) return null
  const name = branch == null ? t.merging : t.into
  const named = branch == null ? name : `${name} ${branch}`
  const said = (row: MergingRow) => (later(row) && row.state === 'waiting' ? t.later : t.state[row.state])
  const nameWords = (
    <>
      {name}
      {branch != null && <span className={s.mono}> {branch}</span>}
    </>
  )

  return (
    <EdgeMorph step={String(open)}>
      {open ? (
        <section className={cx(s.card, leaving && s.going, className)} aria-label={named} data-m-ghost="">
          <span className={s.surface} data-m-box={own} aria-hidden="true" />
          <button ref={head} type="button" className={s.head} aria-expanded aria-controls={listId} onClick={() => toggle(false)}>
            <span className={s.name} data-m={`${own}name`}>
              {nameWords}
            </span>
            <span className={s.fold} data-m-in="" aria-hidden="true">
              <Icon name="chevronD" size={12} />
            </span>
          </button>
          <ol id={listId} className={s.rows}>
            {rows.map((row) => {
              const note = trouble(row) ? row.reason : row.once
              const href = row.url === null ? undefined : safeHref(row.url)
              const words = (
                <>
                  <span className={s.rowMark} data-m={`${own}mark-${row.key}`} data-m-at="center">
                    <Mark row={row} />
                  </span>
                  <span className={s.rowName}>
                    <span className={cx(s.number, row.url === null && s.unnumbered)} data-m={`${own}label-${row.key}`}>
                      {row.label}
                    </span>
                    {row.title !== '' && (
                      <span className={s.title} data-m-in="">
                        {row.title}
                      </span>
                    )}
                  </span>
                  <span className={s.state} data-m-in="">
                    {said(row)}
                  </span>
                  {note !== undefined && note !== '' && (
                    <span className={s.note} data-m-in="">
                      {sentence(note)}
                    </span>
                  )}
                </>
              )
              return (
                <li key={row.key} className={tone(row)}>
                  {href === undefined ? (
                    <div className={s.row}>{words}</div>
                  ) : (
                    <a className={cx(s.row, s.link)} href={href} target="_blank" rel="noreferrer" title={`${row.label} ${row.title}`}>
                      {words}
                      <VisuallyHidden> {t.newTab}</VisuallyHidden>
                    </a>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      ) : (
        <button
          ref={pill}
          type="button"
          className={cx(s.pill, leaving && s.going, className)}
          // Read as one: what it is, then each with where it stands.
          aria-label={`${named}: ${rows.map((row) => `${row.label} ${said(row).toLowerCase()}`).join(', ')}`}
          aria-expanded={false}
          onClick={() => toggle(true)}
          data-m-ghost=""
        >
          <span className={s.surface} data-m-box={own} aria-hidden="true" />
          <span className={s.name} data-m={`${own}name`}>
            {nameWords}
          </span>
          <span ref={tokens} className={s.tokens}>
            {rows.map((row) => (
              <span
                key={row.key}
                className={cx(s.token, tone(row), later(row) && s.later)}
                title={row.title === '' ? row.label : `${row.label} ${row.title}`}
              >
                <span className={s.mark} data-m={`${own}mark-${row.key}`} data-m-at="center">
                  <Mark row={row} />
                </span>
                <span className={s.label} data-m={`${own}label-${row.key}`}>
                  {row.label}
                </span>
              </span>
            ))}
          </span>
          <span className={s.more} aria-hidden="true">
            …
          </span>
        </button>
      )}
    </EdgeMorph>
  )
}

/** Why one came back, for the composer's notice line while its pill is folded: the first sent back or in conflict, or nothing. */
export function MergingBack({ rows, text }: { rows: ReadonlyArray<MergingRow>; text?: Partial<MergingPillText> }) {
  const t = textOf(text)
  const back = rows.find((row) => trouble(row) && row.reason !== undefined && row.reason !== '')
  const reason = back?.reason
  if (back === undefined || reason === undefined) return null
  return (
    <div className={s.backLine} data-m-in="" data-m-ghost="parent">
      <span className={s.backWho}>
        {back.label} {back.state === 'sent_back' ? t.sentBack : `${t.state[back.state].toLowerCase()}.`}
      </span>{' '}
      {sentence(reason)}
    </div>
  )
}
