import type { ReactNode } from 'react'

import type { Brand } from '../../foundations/brands/brands'
import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import s from './Arrived.module.css'

export interface ArrivedText {
  /** What happened, when no verb is given. */
  verb: string
  /** The note's name. */
  label: (from: string | undefined, verb: string, where: string) => string
}

export const arrivedText: ArrivedText = {
  verb: 'commented on',
  label: (from, verb, where) => `${from ? `${from} ` : ''}${verb} ${where}`,
}

export interface ArrivedProps {
  /** Who wrote it. */
  from?: string
  /** What they did: commented on, moved, approved. */
  verb?: string
  /** Where: PR 1206. */
  where: string
  at?: string
  /** The service it came from. Without one, a generic glyph. */
  mark?: Brand
  children?: ReactNode
  /** A quiet line under it: what became of it, and what the person can do. */
  foot?: ReactNode
  text?: Partial<ArrivedText>
}

/**
 * Something the agent was listening for, arrived from outside: a comment on
 * its pull request, a change to its issue. Written by someone else, so it
 * reads as a quoted note, not as either side of the conversation.
 */
export function Arrived({ from, verb, where, at, mark, children, foot, text }: ArrivedProps) {
  const t = { ...arrivedText, ...text }
  const did = verb ?? t.verb
  return (
    <article className={s.arrived} aria-label={t.label(from, did, where)}>
      <div className={s.head}>
        <span className={s.glyph}>{mark ? <BrandMark brand={mark} size={12} /> : <Icon name="globe" size={12} />}</span>
        {from && <b>{from}</b>}
        <span>
          {did} {where}
        </span>
        {at && <span className={s.at}>{at}</span>}
      </div>
      {children && <blockquote className={s.body}>{children}</blockquote>}
      {foot && <div className={s.foot}>{foot}</div>}
    </article>
  )
}
