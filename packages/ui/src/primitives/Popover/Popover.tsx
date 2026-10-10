import { Popover as P } from 'radix-ui'
import type { ReactElement, ReactNode } from 'react'

import { cx } from '../../lib/cx'
import { radixSide, type OverlayAlign, type OverlayPlacement } from '../../lib/overlay'
import s from './Popover.module.css'

/*
 * Positioned overlays are built on Radix: it keeps them on screen (they flip
 * to the other side and shift along it at the viewport's edge), portals them
 * out of scrolling and clipped containers, and manages focus. The look is
 * ours, from the module.
 */

export type { OverlayAlign, OverlayPlacement } from '../../lib/overlay'

export interface PopoverProps {
  /** The button that opens it. It must accept a ref and spread its props onto a button. */
  trigger: ReactElement
  /** What the popover is, for assistive technology. */
  label: string
  children: ReactNode
  placement?: OverlayPlacement
  align?: OverlayAlign
  width?: number
  /** Inner padding. Off when the content lays out its own rows. */
  padded?: boolean
  /** Where focus goes on opening: the first control, or the panel itself when the first control is not the likely next step. */
  initialFocus?: 'first' | 'panel'
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** Escape, before it closes the panel: prevent the default to take a step back inside it instead, out of a form it opened. */
  onEscapeKeyDown?: (e: KeyboardEvent) => void
  className?: string
}

/**
 * A panel a button opens beside itself: detail, a short form, a list of
 * things with their own actions. A non-modal dialog. Focus moves into it
 * when it opens; Escape closes it and puts focus back on the button, unless
 * focus is in something marked `data-own-escape`, which handles that Escape.
 */
export function Popover({
  trigger,
  label,
  children,
  placement = 'below',
  align = 'start',
  width,
  padded = true,
  initialFocus = 'first',
  open,
  defaultOpen,
  onOpenChange,
  onEscapeKeyDown,
  className,
}: PopoverProps) {
  return (
    <P.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content
          aria-label={label}
          side={radixSide(placement)}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={cx('ch-root', s.panel, padded && s.padded, className)}
          style={width ? { width } : undefined}
          onEscapeKeyDown={(e) => {
            /* a field inside that is marked data-own-escape takes the first Escape itself */
            if (e.target instanceof Element && e.target.closest('[data-own-escape]')) e.preventDefault()
            onEscapeKeyDown?.(e)
          }}
          onOpenAutoFocus={(e) => {
            if (initialFocus !== 'panel') return
            e.preventDefault()
            if (e.currentTarget instanceof HTMLElement) e.currentTarget.focus()
          }}
        >
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  )
}

/** Wraps a button inside a Popover so pressing it also closes the popover. The button must accept a ref and spread its props. */
export function PopoverClose({ children }: { children: ReactElement }) {
  return <P.Close asChild>{children}</P.Close>
}
