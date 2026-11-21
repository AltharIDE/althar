import type { ReactNode } from 'react'
import type { LoadGlance } from '@althar/ui'

import type { Places } from '../data'

/** What a direction draws from, and what it opens. */
export interface Ctx {
  readonly places: Places
  readonly load: LoadGlance
  /** Agents at once, as the person has it. */
  readonly count: number
  readonly most: number
  readonly setCount: (count: number | null) => void
  /** A task, by its id: the lab says which. */
  readonly onOpen: (taskId: string) => void
  /** This Mac's view, by what opened it: the bar, Up next, a banner; null while closed. */
  readonly mac: { readonly open: string | null; readonly set: (from: string | null) => void }
  /** The quick settings, from the gear. */
  readonly quick: { readonly open: boolean; readonly set: (open: boolean) => void }
}

export interface Direction {
  /** In the page's address: ?d=. */
  readonly key: string
  /** Its key on the lab's bar; without one, it's reached only by its address. */
  readonly kbd?: string
  readonly label: string
  /** What it is, in a line, for the lab's bar. */
  readonly idea: string
  /** The window's bar, before the gear. */
  readonly bar: (ctx: Ctx) => ReactNode
  /** Up next's take: in the lane's heading or at the top of its body; null keeps nothing there. */
  readonly upNext: { readonly where: 'head' | 'body'; readonly draw: (ctx: Ctx) => ReactNode } | null
  /** Agents at once, in the quick settings' sheet. */
  readonly quick: (ctx: Ctx) => ReactNode
  /** Agents at once, in Settings' Work on this Mac. */
  readonly settings: (ctx: Ctx) => ReactNode
}
