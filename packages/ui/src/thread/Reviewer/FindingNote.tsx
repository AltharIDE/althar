import { useEffect, useRef, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Markdown } from '../Markdown/Markdown'
import s from './FindingNote.module.css'
import type { FindingWeight } from './Reviewer'

/** What became of a finding: open still, fixed by the lead, or kept as it is with the lead's reason. */
export type NotedFindingState = 'open' | 'fixed' | 'set_aside'

/** A review's finding, as a note in the code: how much it matters, what, and what the lead did about it. */
export interface NotedFinding {
  readonly id: string
  readonly weight: FindingWeight
  /** What is wrong in a line, as the reviewer titled it; null from a reviewer that gave none. */
  readonly title: string | null
  /** What is wrong, in full, as markdown. */
  readonly claim: string
  readonly state: NotedFindingState
  /** The lead's words on it: what changed, or why it stays. */
  readonly reason: string | null
  /** The commit the lead said fixed it. */
  readonly commit: string | null
}

export interface FindingNoteText {
  weight: Record<FindingWeight, string>
  fixed: string
  kept: string
  more: string
  less: string
}

export const findingNoteText: FindingNoteText = {
  weight: { blocking: 'Blocking', major: 'Major', minor: 'Minor', nit: 'Nit' },
  fixed: 'Fixed',
  kept: 'Kept',
  more: 'More',
  less: 'Less',
}

/** Past this, a claim shows its first lines until opened. */
const LONG = 280

/**
 * A finding's head and body: its title over the whole claim; with none, the
 * claim's first sentence over the rest, so nothing is said twice.
 */
export const findingHead = (finding: Pick<NotedFinding, 'title' | 'claim'>): { readonly head: string; readonly body: string } => {
  if (finding.title !== null && finding.title.trim() !== '') return { head: finding.title, body: finding.claim }
  const claim = finding.claim.trim()
  const end = /^[^\n]*?[.!?](?=\s|$)/.exec(claim)?.[0] ?? claim.split('\n')[0] ?? claim
  return { head: end, body: claim.slice(end.length).trim() }
}

export const heavyWeight = (weight: FindingWeight) => weight === 'blocking' || weight === 'major'

/** The nearest box around `from` that scrolls up and down. */
const scrollerOf = (from: HTMLElement): HTMLElement | null => {
  for (let box = from.parentElement; box !== null; box = box.parentElement) {
    const { overflowY } = getComputedStyle(box)
    if ((overflowY === 'auto' || overflowY === 'scroll') && box.scrollHeight > box.clientHeight) return box
  }
  return null
}

export interface FindingNoteProps {
  finding: NotedFinding
  /** The one you're on: shown whole, brought into view, marked. */
  current?: boolean
  /** Makes it the one you're on. */
  onPick?: (id: string) => void
  text?: Partial<FindingNoteText>
  className?: string
}

/** A review's finding where it points, under its line: what is wrong in a line, the reviewer's words under it, and what the lead did. */
export function FindingNote({ finding, current = false, onPick, text, className }: FindingNoteProps) {
  const t = { ...findingNoteText, ...text }
  const { head, body } = findingHead(finding)
  const long = body.length > LONG
  const [opened, setOpened] = useState(false)
  const whole = opened || current || !long
  const ref = useRef<HTMLElement>(null)
  // The one you're on comes into view once drawn: only the code's own scroll moves, never the window.
  useEffect(() => {
    if (!current) return
    const frame = requestAnimationFrame(() => {
      const note = ref.current
      const box = note === null ? null : scrollerOf(note)
      if (note === null || box === null) return
      const at = note.getBoundingClientRect()
      const view = box.getBoundingClientRect()
      box.scrollTop += at.top - view.top - Math.max(48, (view.height - at.height) / 3)
    })
    return () => cancelAnimationFrame(frame)
  }, [current])
  const pick = onPick === undefined || current ? undefined : () => onPick(finding.id)
  return (
    <article
      ref={ref}
      className={cx(s.note, className)}
      data-current={current}
      data-state={finding.state}
      aria-current={current ? 'true' : undefined}
    >
      <header className={s.head}>
        <span className={heavyWeight(finding.weight) && finding.state === 'open' ? s.heavy : s.weight}>{t.weight[finding.weight]}</span>
        {pick === undefined ? (
          <span className={s.title}>{head}</span>
        ) : (
          <button type="button" className={cx(s.title, s.pick)} onClick={pick}>
            {head}
          </button>
        )}
        {finding.state === 'fixed' && (
          <span className={s.state}>
            <Icon name="check" size={12} />
            {t.fixed}
          </span>
        )}
        {finding.state === 'set_aside' && <span className={s.state}>{t.kept}</span>}
      </header>
      {body !== '' && (
        <div className={whole ? s.body : s.shut}>
          <Markdown source={body} />
        </div>
      )}
      {long && !current && (
        <LinkButton
          className={s.more}
          onClick={(event) => {
            event.stopPropagation()
            setOpened(!opened)
          }}
        >
          {opened ? t.less : t.more}
        </LinkButton>
      )}
      {finding.state !== 'open' && (finding.reason !== null || finding.commit !== null) && (
        <p className={s.answer}>
          {finding.reason}
          {finding.commit !== null && <code className={s.commit}>{finding.commit.slice(0, 7)}</code>}
        </p>
      )}
    </article>
  )
}
