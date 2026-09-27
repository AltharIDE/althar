import { Tooltip as T } from 'radix-ui'
import type { ReactElement, ReactNode } from 'react'

import { cx } from '../../lib/cx'
import { side, type Align, type Placement } from '../Popover/Popover'
import s from './HoverCard.module.css'

export interface HoverCardProps {
  /** What the card describes. It must be focusable, accept a ref and spread its props. */
  children: ReactElement
  /** The detail. It is read as the trigger's description, so keep it to text. */
  card: ReactNode
  placement?: Placement
  align?: Align
  width?: number
  defaultOpen?: boolean
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
export function HoverCard({ children, card, placement = 'above', align = 'start', width, defaultOpen, className }: HoverCardProps) {
  return (
    <T.Provider delayDuration={160} skipDelayDuration={300}>
      <T.Root defaultOpen={defaultOpen}>
        <T.Trigger asChild>{children}</T.Trigger>
        <T.Portal>
          <T.Content
            side={side(placement)}
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
    </T.Provider>
  )
}
