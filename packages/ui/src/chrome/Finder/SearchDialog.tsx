import { Dialog } from 'radix-ui'
import { type CSSProperties, type ReactNode, type RefObject, useState } from 'react'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'

/** Shortcut-opened palette: Radix traps focus; the field owns Escape's steps. */
export function SearchDialog({
  title,
  onClose,
  box,
  scrim,
  className,
  overlayClassName,
  style,
  children,
}: {
  title: string
  onClose: () => void
  box: RefObject<HTMLDivElement | null>
  scrim: RefObject<HTMLDivElement | null>
  className: string
  overlayClassName: string
  style: CSSProperties
  children: ReactNode
}) {
  const [opener] = useState(() => document.activeElement)
  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay ref={scrim} className={overlayClassName} />
        <Dialog.Content
          data-search=""
          ref={box}
          className={className}
          style={style}
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
          }}
        >
          <VisuallyHidden>
            <Dialog.Title>{title}</Dialog.Title>
          </VisuallyHidden>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
