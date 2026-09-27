import { Collapsible as C } from 'radix-ui'
import { createContext, useContext, type ReactElement, type ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { useControlled } from '../../lib/controlled'
import { cx } from '../../lib/cx'
import s from './Fold.module.css'
import type { Rhythm } from '../../lib/rhythm'

/*
 * Everything that opens, opens the same way: the height eases out from the
 * row, and the content settles a few pixels as it fades in. Built on Radix's
 * Collapsible, which wires the trigger to the panel. The panel stays mounted
 * so it can animate back, and is inert while closed, so it is out of the tab
 * order and hidden from assistive technology.
 */

/** Props for anything that opens and closes: uncontrolled from `defaultOpen`, or driven by `open` and `onOpenChange`. */
export interface Disclosable {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

const Open = createContext(false)

export interface DisclosureProps extends Disclosable {
  children: ReactNode
  className?: string
  /** Its content is still arriving (aria-busy). */
  busy?: boolean
  /** How it spaces itself in a thread. */
  rhythm?: Rhythm
}

/** One thing that opens: a trigger and its Fold, anywhere inside. The element carries data-state="open" or "closed". */
export function Disclosure({ open, defaultOpen = false, onOpenChange, children, className, busy, rhythm }: DisclosureProps) {
  const [isOpen, setOpen] = useControlled(open, defaultOpen, onOpenChange)
  return (
    <C.Root open={isOpen} onOpenChange={setOpen} className={className} aria-busy={busy || undefined} data-rhythm={rhythm}>
      <Open.Provider value={isOpen}>{children}</Open.Provider>
    </C.Root>
  )
}

/** The button that opens it. It must be a button that accepts a ref and spreads its props. */
export function DisclosureTrigger({ children }: { children: ReactElement }) {
  return <C.Trigger asChild>{children}</C.Trigger>
}

/** Whether the Disclosure around this is open. */
export const useOpen = () => useContext(Open)

export interface FoldProps {
  className?: string
  /** Rows inside keep their hover background past the column edge. Off for sheets that are flush. */
  bleed?: boolean
  children: ReactNode
}

export function Fold({ className, bleed = true, children }: FoldProps) {
  const open = useOpen()
  return (
    <C.Content forceMount className={cx(s.fold, className)} inert={!open}>
      <div className={cx(s.inner, bleed && s.bleed)}>{children}</div>
    </C.Content>
  )
}

/** The fold's look, for panels another primitive owns (an Accordion item). They carry data-state like a Fold. */
export const foldClass = { fold: s.fold, inner: s.inner, bleed: s.bleed }

/** The chevron that says a row opens. It turns when open: its Disclosure's state, unless told. */
export function Caret({ open, className }: { open?: boolean; className?: string }) {
  const inside = useOpen()
  return <Icon name="chevronD" size={10} className={cx(s.caret, (open ?? inside) && s.caretOpen, className)} />
}
