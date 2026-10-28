import { Popover as P } from 'radix-ui'
import { type PointerEvent, type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react'

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
  /** A press or focus outside, before it closes the panel: prevent the default to keep it open while something in it is under way. */
  onInteractOutside?: (e: Event) => void
  /**
   * Opens too while a pointer rests on its button, and stays while the
   * pointer is over the button or the panel: detail you glance at, with an
   * action or two in it. The keyboard opens it as any popover; one opened by
   * pointing leaves focus where it was.
   */
  hover?: boolean
  className?: string
}

/** How long a pointer rests on the button before a hover popover opens, and how long it may be away before it closes, in ms. */
const HOVER_OPEN = 160
const HOVER_CLOSE = 240

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
  onInteractOutside,
  hover = false,
  className,
}: PopoverProps) {
  const [own, setOwn] = useState(defaultOpen ?? false)
  const shown = open ?? own
  const change = (next: boolean) => {
    if (open === undefined) setOwn(next)
    onOpenChange?.(next)
  }
  // Pointing opens and closes it after a moment; one it opened leaves focus where it was.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pointed = useRef(false)
  // Whether focus went into the panel: one only pointed at gives none back as it closes, so typing elsewhere goes on.
  const tookFocus = useRef(false)
  useEffect(() => () => clearTimeout(timer.current), [])
  const mouse = (e: PointerEvent) => hover && e.pointerType !== 'touch'
  const enter = (e: PointerEvent) => {
    if (!mouse(e)) return
    clearTimeout(timer.current)
    if (!shown)
      timer.current = setTimeout(() => {
        pointed.current = true
        change(true)
      }, HOVER_OPEN)
  }
  const leave = (e: PointerEvent) => {
    if (!mouse(e)) return
    clearTimeout(timer.current)
    // Only what pointing opened closes when the pointer goes: one pressed or opened from the keyboard stays.
    if (shown && !pointed.current) return
    timer.current = setTimeout(() => change(false), HOVER_CLOSE)
  }
  return (
    <P.Root
      open={shown}
      onOpenChange={(next) => {
        clearTimeout(timer.current)
        pointed.current = false
        change(next)
      }}
    >
      <P.Trigger
        asChild
        onPointerEnter={enter}
        onPointerLeave={leave}
        onClick={(e) => {
          // Pressed while it shows from pointing, it stays: the press keeps what the pointer opened, rather than closing it.
          if (!hover || !shown || !pointed.current) return
          e.preventDefault()
          pointed.current = false
          clearTimeout(timer.current)
        }}
      >
        {trigger}
      </P.Trigger>
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
          onInteractOutside={onInteractOutside}
          onPointerEnter={(e) => mouse(e) && clearTimeout(timer.current)}
          onPointerLeave={leave}
          onCloseAutoFocus={(e) => {
            if (!tookFocus.current) e.preventDefault()
            tookFocus.current = false
          }}
          onOpenAutoFocus={(e) => {
            // Opened by pointing, focus stays where it was: the panel is only being looked at.
            if (pointed.current) return e.preventDefault()
            tookFocus.current = true
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
