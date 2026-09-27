import type { ReactNode } from 'react'

import { cx } from '../../lib/cx'
import { SidePanel, SidePanelBody } from '../../primitives/SidePanel/SidePanel'
import s from './Dock.module.css'

/*
 * The dock: one panel beside the board or the conversation, with one thing
 * in it at a time. What you just opened from the board, to decide on or to
 * look at without leaving, or the project's knowledge or artifacts. It stays
 * when you change views. Its head names what it holds; a call's kind is
 * violet, like the call.
 */

export interface DockProps {
  /** What the panel is, for assistive technology. */
  label: string
  /** The head, in a word or two: Knowledge, a task's number, a call's kind. */
  name: string
  /** A line after it: where it came from, and when. */
  sub?: string
  /** It holds a call of yours. */
  call?: boolean
  onClose: () => void
  /** The peek: a CallPeek, an AcceptPeek, a WorkPeek, a ListPeek. */
  children: ReactNode
  className?: string
}

export function Dock({ label, name, sub, call, onClose, children, className }: DockProps) {
  return (
    <SidePanel
      label={label}
      onClose={onClose}
      className={cx(s.dock, className)}
      head={
        <span className={s.head}>
          <span className={cx(s.name, call && s.call)}>{name}</span>
          {sub && <span className={s.sub}>{sub}</span>}
        </span>
      }
    >
      <SidePanelBody className={s.body}>{children}</SidePanelBody>
    </SidePanel>
  )
}

/* ---- What the peeks share ------------------------------------------------ */

/** The peek's title, and the line under it. */
export function PeekHead({ title, lead }: { title: string; lead?: ReactNode }) {
  return (
    <>
      <h2 className={s.title}>{title}</h2>
      {lead && <p className={s.lead}>{lead}</p>}
    </>
  )
}

/** A labelled part of a peek. */
export function PeekSection({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <section className={s.section}>
      <h3 className={s.label}>{label}</h3>
      {children}
    </section>
  )
}

/** The peek's actions, or its last word, at the end. */
export function PeekFoot({ children }: { children: ReactNode }) {
  return <div className={s.foot}>{children}</div>
}

/** Quieter detail under the lead. */
export function PeekDetail({ children }: { children: ReactNode }) {
  return <p className={s.detail}>{children}</p>
}
