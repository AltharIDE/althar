import { Dialog as D } from 'radix-ui'
import { type FormEvent, type ReactNode, useState } from 'react'

import { cx } from '../../lib/cx'
import { IconButton } from '../IconButton/IconButton'
import s from './Dialog.module.css'

/*
 * A short modal question over the window: a title, a line or two on what
 * happens, what it needs, and its buttons, the one that does it last. Built
 * on Radix's dialog, which keeps focus inside and closes on Escape or a
 * click outside. Mount it to open it; closing gives focus back to what had it
 * as it opened, where that is still on the page. With `onSubmit` it is a
 * form: Enter in a field submits it. One that steps through pages of its
 * own, as a walk in to a service does, has a way back before its title,
 * which Escape takes first, and its pages bring their own buttons.
 */

export interface DialogText {
  back: string
}

export const dialogText: DialogText = { back: 'Back' }

export interface DialogProps {
  title: string
  /** What happens, under the title; the dialog's description. */
  description?: ReactNode
  children?: ReactNode
  /** Its buttons, the one that does it last. Without them, what is in it brings its own. */
  actions?: ReactNode
  /** Escape, a click outside, or the person's Cancel. */
  onClose: () => void
  /** A step back, for a dialog that steps through pages of its own: a round chevron before its title, and what Escape does instead of closing it. */
  onBack?: () => void
  /** Something in it is under way: a press outside doesn't close it. Escape still does, or steps back. */
  holding?: boolean
  /** Makes it a form, submitted by Enter in a field or a submit button. */
  onSubmit?: () => void
  width?: number
  /** A form longer than a question, such as Report a problem: it sits higher, and may take more of the window. */
  tall?: boolean
  className?: string
  text?: Partial<DialogText>
}

export function Dialog({
  title,
  description,
  children,
  actions,
  onClose,
  onBack,
  holding = false,
  onSubmit,
  width = 420,
  tall = false,
  className,
  text,
}: DialogProps) {
  const t = { ...dialogText, ...text }
  // What had focus as it opened: it has no trigger of Radix's to give focus back to, so it gives it back here.
  const [opener] = useState(() => (typeof document === 'undefined' ? null : document.activeElement))
  const heading = <D.Title className={s.title}>{title}</D.Title>
  const body = (
    <>
      {onBack === undefined ? (
        heading
      ) : (
        <div className={s.head}>
          <IconButton icon="chevronL" label={t.back} size="small" className={s.back} onClick={onBack} />
          {heading}
        </div>
      )}
      {description != null && <D.Description className={s.description}>{description}</D.Description>}
      {children != null && <div className={s.body}>{children}</div>}
      {actions != null && <div className={s.actions}>{actions}</div>}
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
          className={cx('ch-root', s.dialog, tall && s.tall, className)}
          style={{ width: `min(${width}px, calc(100vw - 32px))` }}
          {...(description == null ? { 'aria-describedby': undefined } : {})}
          onEscapeKeyDown={(event) => {
            // A step back before it closes.
            if (onBack === undefined) return
            event.preventDefault()
            onBack()
          }}
          onInteractOutside={holding ? (event) => event.preventDefault() : undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
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
