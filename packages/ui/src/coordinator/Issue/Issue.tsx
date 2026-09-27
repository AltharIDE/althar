import { useState } from 'react'

import type { Brand } from '../../foundations/brands/brands'
import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import type { IssuePriority, IssueStatus } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { PriorityGlyph, StatusGlyph } from './glyphs'
import s from './Issue.module.css'
import { Pixels } from './Pixels'

/*
 * An issue, unfurled where its link was pasted. It reads as coming from
 * outside: the tracker's mark and name above the title, its own status and
 * priority below. Linear's card is the one place Linear's colour is used.
 */

export interface IssueText {
  /** For the link, after the title: where it opens. */
  opensIn: (source: string) => string
  unread: string
  connect: (source: string) => string
}

export const issueText: IssueText = {
  opensIn: (source) => `, opens in ${source} in a new tab`,
  unread: 'Couldn’t read this issue',
  connect: (source) => `Connect ${source}`,
}

interface IssueBase {
  /** The tracker's mark. */
  mark: Brand
  /** The tracker's name: Linear. */
  source: string
  /** The issue's key: MER-231. */
  id: string
  /** linear: Linear's colours and a field of squares. plain: ink, for any other tracker. */
  tone?: 'linear' | 'plain'
  text?: Partial<IssueText>
}

export interface IssueProps extends IssueBase {
  title: string
  href: string
  /** Its workflow state, in the tracker's words. */
  status?: { state: IssueStatus; label: string }
  priority?: { level: IssuePriority; label: string }
  /** Anything else in a line: due date, team. */
  meta?: string
}

export function Issue({ mark, source, id, tone = 'plain', title, href, status, priority, meta, text }: IssueProps) {
  const t = { ...issueText, ...text }
  /* the field of squares moves only while you point at the card or focus it */
  const [live, setLive] = useState(false)
  const on = () => setLive(true)
  const off = () => setLive(false)
  return (
    <a
      className={cx(s.issue, s[tone])}
      href={href}
      target="_blank"
      rel="noreferrer"
      onPointerEnter={on}
      onPointerLeave={off}
      onFocus={on}
      onBlur={off}
    >
      {tone === 'linear' && <Pixels className={s.pixels} playing={live} />}
      <span className={s.logo}>
        <BrandMark brand={mark} size={16} />
      </span>
      <span className={s.main}>
        <span className={s.top}>
          <b>{source}</b>
          <span className={s.id}>{id}</span>
        </span>
        <span className={s.title}>
          {title}
          <VisuallyHidden>{t.opensIn(source)}</VisuallyHidden>
        </span>
        {(status || priority || meta) && (
          <span className={s.meta}>
            {status && (
              <span className={s.glyphed}>
                <StatusGlyph status={status.state} />
                {status.label}
              </span>
            )}
            {priority && (
              <span className={s.glyphed}>
                <PriorityGlyph priority={priority.level} />
                {priority.label}
              </span>
            )}
            {meta && <span>{meta}</span>}
          </span>
        )}
      </span>
      <Icon name="external" size={12} className={s.go} />
    </a>
  )
}

export interface IssueUnreadProps extends IssueBase {
  /** Why it could not be read. */
  reason: string
  /** Connect the tracker. Without it, no button. */
  onConnect?: () => void
}

/** A link to an issue the tracker would not let us read: what went wrong, and how to fix it. */
export function IssueUnread({ mark, source, id, reason, onConnect, text }: IssueUnreadProps) {
  const t = { ...issueText, ...text }
  return (
    <span className={cx(s.issue, s.unread)}>
      <span className={s.logo}>
        <BrandMark brand={mark} size={16} />
      </span>
      <span className={s.main}>
        <span className={s.top}>
          <b>{source}</b>
          <span className={s.id}>{id}</span>
        </span>
        <span className={s.title}>{t.unread}</span>
        <span className={s.meta}>
          <span>{reason}</span>
        </span>
      </span>
      {onConnect && (
        <Button className={s.fix} onClick={onConnect}>
          {t.connect(source)}
        </Button>
      )}
    </span>
  )
}

export interface FromProps {
  mark?: Brand
  id: string
  /** Draw the mark in Linear's colour. */
  linear?: boolean
}

/** Where a task came from, inline: the tracker's mark and the issue's key. */
export function From({ mark, id, linear }: FromProps) {
  return (
    <span className={s.from}>
      {mark && <BrandMark brand={mark} size={11} className={linear ? s.fromLinear : undefined} />}
      <span className={s.fromId}>{id}</span>
    </span>
  )
}
