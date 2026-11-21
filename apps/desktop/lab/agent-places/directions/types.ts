import type { ReactNode } from 'react'
import type { LoadGlance } from '@althar/ui'

import type { Places } from '../data'

/** What a take draws from, and what it opens. */
export interface Ctx {
  readonly places: Places
  readonly load: LoadGlance
  /** Agents at once, as the person has it. */
  readonly count: number
  readonly most: number
  readonly setCount: (count: number | null) => void
  /** A task, by its id: the lab says which. */
  readonly onOpen: (taskId: string) => void
  /** What the chip opens: 'bar' while open, null while closed. */
  readonly mac: { readonly open: string | null; readonly set: (from: string | null) => void }
  /** The quick settings, from the gear. */
  readonly quick: { readonly open: boolean; readonly set: (open: boolean) => void }
}

export interface Direction {
  /** In the page's address: ?d=. */
  readonly key: string
  /** Its key on the lab's bar. */
  readonly kbd: string
  readonly label: string
  /** What it is, in a line, for the lab's bar. */
  readonly idea: string
  /** The window's bar, before the gear. */
  readonly bar: (ctx: Ctx) => ReactNode
  /** Agents at once, in the quick settings' sheet. */
  readonly quick: (ctx: Ctx) => ReactNode
  /** Agents at once, in Settings' Work on this Mac. */
  readonly settings: (ctx: Ctx) => ReactNode
}
