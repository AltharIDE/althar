import { Collapsible as C } from 'radix-ui'
import { createContext, useContext, useState, type ReactElement, type ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { useControlled } from '../../lib/controlled'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import type { Rhythm } from '../../lib/rhythm'
import s from './Fold.module.css'

/*
 * Everything that opens, opens the same way: the height eases out from the
 * row, and the content settles a few pixels as it fades in. Built on Radix's
 * Collapsible, which wires the trigger to the panel. What is inside is not
 * rendered until the first time it opens, so a long thread of closed tool
 * calls costs nothing; after that it stays mounted so it can animate back,
 * and is inert while closed, out of the tab order and hidden from assistive
 * technology.
 */

/** Props for anything that opens and closes: uncontrolled from `defaultOpen`, or driven by `open` and `onOpenChange`. */
export interface Disclosable {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

interface OpenState {
  open: boolean
  /** It has been open at least once, so its content exists. */
  shown: boolean
}

const Open = createContext<OpenState>({ open: false, shown: false })

export type DisclosureProps = RootProps<
  'div',
  Disclosable & {
    children: ReactNode
    /** Its content is still arriving (aria-busy). */
    busy?: boolean
    /** How it spaces itself in a thread. */
    rhythm?: Rhythm
  }
>

/** One thing that opens: a trigger and its Fold, anywhere inside. The element carries data-state="open" or "closed". */
export function Disclosure({ open, defaultOpen = false, onOpenChange, children, busy, rhythm, ...rest }: DisclosureProps) {
  const [isOpen, setOpen] = useControlled(open, defaultOpen, onOpenChange)
  const [shown, setShown] = useState(isOpen)
  if (isOpen && !shown) setShown(true)
  return (
    <C.Root open={isOpen} onOpenChange={setOpen} aria-busy={busy || undefined} data-rhythm={rhythm} {...rest}>
      <Open.Provider value={{ open: isOpen, shown }}>{children}</Open.Provider>
    </C.Root>
  )
}

/** The button that opens it. It must be a button that accepts a ref and spreads its props. */
export function DisclosureTrigger({ children }: { children: ReactElement }) {
  return <C.Trigger asChild>{children}</C.Trigger>
}

/** Whether the Disclosure around this is open. */
export const useOpen = () => useContext(Open).open

export interface FoldProps {
  className?: string
  /** Rows inside keep their hover background past the column edge. Off for sheets that are flush. */
  bleed?: boolean
  /** Render the content even before it first opens: for content a find-in-page should reach. */
  eager?: boolean
  children: ReactNode
}

export function Fold({ className, bleed = true, eager = false, children }: FoldProps) {
  const { open, shown } = useContext(Open)
  return (
    <C.Content forceMount className={cx(s.fold, className)} inert={!open}>
      <div className={cx(s.inner, bleed && s.bleed)}>{shown || eager ? children : null}</div>
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
