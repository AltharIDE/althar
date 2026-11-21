import type { ReactNode } from 'react'
import type { LoadGlance } from '@althar/ui'

import type { Places, Worker } from '../data'

/** What the chip draws beside This Mac: this computer's cells, every worker's as a group, or every worker as a bar. */
export type ChipKind = 'mac' | 'groups' | 'bars'

/** What a take draws from, and what it opens. */
export interface Ctx {
  /** Every worker of this home, This Mac first. */
  readonly workers: readonly Worker[]
  /** This computer, among them. */
  readonly here: Worker
  /** This computer's places. */
  readonly places: Places
  readonly load: LoadGlance
  readonly chip: ChipKind
  /** Agents at once on this computer, as the person has it. */
  readonly count: number
  readonly most: number
  readonly setCount: (count: number | null) => void
  /** Agents at once on any worker, by its id. */
  readonly setCountOf: (worker: string, count: number | null) => void
  /** A task, by its id: the lab says which. */
  readonly onOpen: (taskId: string) => void
  /** Something the lab only says it would do. */
  readonly say: (what: string) => void
  /** What the chip opens: 'bar' while open, null while closed. */
  readonly peek: { readonly open: string | null; readonly set: (from: string | null) => void }
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
  /** Settings' Work on this Mac, and each other worker's number. */
  readonly settings: (ctx: Ctx) => ReactNode
}
