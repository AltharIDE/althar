import { useEffect, useRef, type ReactNode } from 'react'

import { cx } from '../../lib/cx'
import { IconButton } from '../IconButton/IconButton'
import s from './SidePanel.module.css'

/*
 * A panel beside the thread, not over it: a document at reading width, a
 * step's own thread. Focus moves to it when it opens. Escape closes it,
 * heard before anything behind it, and focus goes back to where it was.
 */

export interface SidePanelText {
  close: string
  closeTitle: string
}

export const sidePanelText: SidePanelText = { close: 'Close the panel', closeTitle: 'Close  esc' }

export interface SidePanelProps {
  /** The panel's name, for assistive technology. */
  label: string
  /** The head's content, from the left. */
  head: ReactNode
  /** Actions at the right of the head, before Close. */
  actions?: ReactNode
  onClose: () => void
  /** What is under the head: a SidePanelBody, and anything around it. */
  children: ReactNode
  className?: string
  headClassName?: string
  text?: Partial<SidePanelText>
}

export function SidePanel({ label, head, actions, onClose, children, className, headClassName, text }: SidePanelProps) {
  const t = { ...sidePanelText, ...text }
  const panel = useRef<HTMLElement>(null)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  }, [onClose])
  useEffect(() => {
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panel.current?.focus()
    /* bubbling, last: a menu or a form inside takes its own Escape first and marks it handled */
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.stopPropagation()
      close.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      back?.focus()
    }
  }, [])
  return (
    <aside ref={panel} className={cx(s.panel, className)} aria-label={label} tabIndex={-1}>
      <div className={cx(s.head, headClassName)}>
        {head}
        <span className={s.actions}>
          {actions}
          <IconButton icon="close" label={t.close} size="small" onClick={onClose} title={t.closeTitle} />
        </span>
      </div>
      {children}
    </aside>
  )
}

/** The panel's scrolling body. */
export function SidePanelBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx(s.body, className)}>{children}</div>
}

/** The panel's title, first in its head. */
export function SidePanelTitle({ children }: { children: ReactNode }) {
  return <h2 className={s.title}>{children}</h2>
}
