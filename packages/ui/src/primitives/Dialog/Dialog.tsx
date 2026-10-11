import { Dialog as D } from 'radix-ui'
import { type FormEvent, type ReactNode, useState } from 'react'

import { cx } from '../../lib/cx'
import s from './Dialog.module.css'

/*
 * A short modal question over the window: a title, a line or two on what
 * happens, what it needs, and its buttons, the one that does it last. Built
 * on Radix's dialog, which keeps focus inside and closes on Escape or a
 * click outside. Mount it to open it; unmounted, it gives focus back to what
 * had it as it opened, where that is still there. With `onSubmit` it is a
 * form: Enter in a field submits it.
 */

export interface DialogProps {
  title: string
  /** What happens, under the title; the dialog's description. */
  description?: ReactNode
  children?: ReactNode
  /** Its buttons, the one that does it last. */
  actions: ReactNode
  /** Escape, a click outside, or the person's Cancel. */
  onClose: () => void
  /** Makes it a form, submitted by Enter in a field or a submit button. */
  onSubmit?: () => void
  width?: number
  className?: string
}

export function Dialog({ title, description, children, actions, onClose, onSubmit, width = 420, className }: DialogProps) {
  // It has no trigger of Radix's to go back to: what had focus as it opened is where focus goes again.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null))
  const body = (
    <>
      <D.Title className={s.title}>{title}</D.Title>
      {description != null && <D.Description className={s.description}>{description}</D.Description>}
      {children != null && <div className={s.body}>{children}</div>}
      <div className={s.actions}>{actions}</div>
    </>
  )
  return (
    <D.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <D.Portal>
        <D.Overlay className={s.overlay} />
        <D.Content
          className={cx('ch-root', s.dialog, className)}
          style={{ width: `min(${width}px, calc(100vw - 32px))` }}
          {...(description == null ? { 'aria-describedby': undefined } : {})}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (opener?.isConnected === true) opener.focus()
          }}
          asChild={onSubmit !== undefined}
        >
          {onSubmit === undefined ? (
            body
          ) : (
            <form
              onSubmit={(event: FormEvent) => {
                event.preventDefault()
                onSubmit()
              }}
            >
              {body}
            </form>
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
