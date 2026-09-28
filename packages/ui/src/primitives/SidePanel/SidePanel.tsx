import { useEffect, useRef, type ReactNode } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Heading, type HeadingLevel } from '../Heading/Heading'
import { IconButton } from '../IconButton/IconButton'
import s from './SidePanel.module.css'

/*
 * A panel beside the thread, not over it: a document at reading width, a
 * step's own thread. Focus moves to it when it opens. Escape closes it while
 * focus is inside it, after anything inside (a menu, a form) has had the
 * Escape first; focus then goes back to where it was.
 */

export interface SidePanelText {
  close: string
  /** The key that closes it, shown in Close's tooltip. */
  closeKey: string
}

export const sidePanelText: SidePanelText = { close: 'Close the panel', closeKey: 'esc' }

export type SidePanelProps = RootProps<
  'aside',
  {
    /** The panel's name, for assistive technology. */
    label: string
    /** The head's content, from the left. */
    head: ReactNode
    /** Actions at the right of the head, before Close. */
    actions?: ReactNode
    onClose: () => void
    /** What is under the head: a SidePanelBody, and anything around it. */
    children: ReactNode
    headClassName?: string
    text?: Partial<SidePanelText>
  }
>

export function SidePanel({ label, head, actions, onClose, children, className, headClassName, text, onKeyDown, ...rest }: SidePanelProps) {
  const t = { ...sidePanelText, ...text }
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panel.current?.focus()
    return () => back?.focus()
  }, [])
  return (
    <aside
      ref={panel}
      className={cx(s.panel, className)}
      aria-label={label}
      tabIndex={-1}
      {...rest}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        /* last: a menu or a form inside takes its own Escape first and marks it handled */
        if (e.key !== 'Escape' || e.defaultPrevented) return
        e.preventDefault()
        onClose()
      }}
    >
      <div className={cx(s.head, headClassName)}>
        {head}
        <span className={s.actions}>
          {actions}
          <IconButton icon="close" label={t.close} kbd={t.closeKey} tooltip="below" size="small" onClick={onClose} />
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
export function SidePanelTitle({ children, level = 2 }: { children: ReactNode; level?: HeadingLevel }) {
  return (
    <Heading level={level} className={s.title}>
      {children}
    </Heading>
  )
}
