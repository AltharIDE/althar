import type { ReactNode } from 'react'
import type { LoadGlance } from '@althar/ui'

import type { Places, Waiting, Worker } from '../data'

/** What the meter draws in the bar: an AGENTS gauge beside CPU and MEM; a cell a place, a group a computer; one track, a part a computer. */
export type BarKind = 'gauges' | 'cells' | 'track'

/**
 * Althar Cloud, offered where work that any computer could take has waited a while: to set up where none is linked,
 * its cap to raise once the month is spent, or more at once where it is full too. Null where nothing waits that it
 * could take.
 */
export type Offer =
  | { readonly kind: 'setup'; readonly waiting: readonly Waiting[] }
  | { readonly kind: 'raise'; readonly waiting: readonly Waiting[]; readonly resets: string }
  | { readonly kind: 'more'; readonly waiting: readonly Waiting[]; readonly month: string }
  | null

/** What a take draws from, and what it opens. */
export interface Ctx {
  /** Every computer this home's agents work on, This Mac first, and Althar Cloud where it is linked. */
  readonly workers: readonly Worker[]
  /** This computer, among them. */
  readonly here: Worker
  /** This computer's places. */
  readonly places: Places
  /** This computer's load, as the meter reads it today. */
  readonly load: LoadGlance
  readonly bar: BarKind
  /** What waits to start, in every project. */
  readonly waiting: readonly Waiting[]
  readonly offer: Offer
  /** Agents at once on this computer, as the person has it. */
  readonly count: number
  readonly most: number
  readonly setCount: (count: number | null) => void
  /** Agents at once on any computer, by its id. */
  readonly setCountOf: (worker: string, count: number | null) => void
  /** A task, by its id: the lab says which. */
  readonly onOpen: (taskId: string) => void
  /** Something the lab only says it would do. */
  readonly say: (what: string) => void
  /** What the meter opens. */
  readonly peek: { readonly open: boolean; readonly set: (open: boolean) => void }
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
  /** Settings' Work on this Mac. */
  readonly settings: (ctx: Ctx) => ReactNode
}
