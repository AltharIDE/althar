import { Tooltip as T } from 'radix-ui'
import { createContext, useContext, type ReactElement, type ReactNode } from 'react'

import { cx } from '../../lib/cx'
import { radixSide, type OverlayAlign, type OverlayPlacement } from '../../lib/overlay'
import { Kbd } from '../Kbd/Kbd'
import s from './HoverCard.module.css'

const Provided = createContext(false)

export interface HoverCardProviderProps {
  children: ReactNode
  /** How long a pointer rests before the first card opens, in ms. */
  delay?: number
}

/**
 * Put once around an app, so moving from one card to the next skips the
 * delay. A HoverCard outside one brings its own, so it still works alone.
 */
export function HoverCardProvider({ children, delay = 160 }: HoverCardProviderProps) {
  return (
    <T.Provider delayDuration={delay} skipDelayDuration={300}>
      <Provided.Provider value>{children}</Provided.Provider>
    </T.Provider>
  )
}

function Provide({ children }: { children: ReactNode }) {
  return useContext(Provided) ? children : <HoverCardProvider>{children}</HoverCardProvider>
}

export interface HoverCardProps {
  /** What the card describes. It must be focusable, accept a ref and spread its props. */
  children: ReactElement
  /** The detail. It is read as the trigger's description, so keep it to text. */
  card: ReactNode
  placement?: OverlayPlacement
  align?: OverlayAlign
  width?: number
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
}

/**
 * Detail that appears while you point at something or focus it: the context
 * ring's numbers, where a citation comes from. Built on Radix's tooltip, not
 * its hover card, because it must open for the keyboard too. Per WCAG 1.4.13
 * it can be pointed at without vanishing, stays until you leave, and Escape
 * hides it. Nothing inside is interactive; anything you would act on belongs
 * in a Popover.
 */
export function HoverCard({
  children,
  card,
  placement = 'above',
  align = 'start',
  width,
  open,
  defaultOpen,
  onOpenChange,
  className,
}: HoverCardProps) {
  return (
    <Provide>
      <T.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
        <T.Trigger asChild>{children}</T.Trigger>
        <T.Portal>
          <T.Content
            side={radixSide(placement)}
            align={align}
            sideOffset={6}
            collisionPadding={8}
            className={cx('ch-root', s.card, className)}
            style={width ? { width } : undefined}
          >
            {card}
          </T.Content>
        </T.Portal>
      </T.Root>
    </Provide>
  )
}

export interface TooltipProps {
  /** The control it names. It must be focusable, accept a ref and spread its props. */
  children: ReactElement
  /** What the control does, in a few words. */
  label: ReactNode
  /** Its shortcut, shown after the label; the consumer binds it. */
  kbd?: string
  placement?: OverlayPlacement
  align?: OverlayAlign
}

/** A control's name, and its shortcut, on hover or focus: for controls that show only a glyph. Unlike a title attribute, the keyboard sees it too. */
export function Tooltip({ children, label, kbd, placement = 'above', align = 'start' }: TooltipProps) {
  return (
    <HoverCard
      placement={placement}
      align={align}
      className={s.tip}
      card={
        <>
          {label}
          {kbd && <Kbd>{kbd}</Kbd>}
        </>
      }
    >
      {children}
    </HoverCard>
  )
}
