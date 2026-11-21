import type { ReactNode } from 'react'
import type { LoadGlance } from '@althar/ui'

import type { Places, Waiting } from '../data'

/** What a take draws from, and what it can do in the lab. */
export interface Ctx {
  places: Places
  load: LoadGlance
  /** What waits for an agent, in every project. */
  waiting: readonly Waiting[]
  most: number
  /** The person's own number; null goes back to the default. */
  setCount: (n: number | null) => void
  /** Opens a task, from a row. */
  onOpen: (id: string) => void
  /** Says in the lab's bar what a press would do. */
  say: (what: string) => void
  /** The meter's popover. */
  peek: { open: boolean; set: (open: boolean) => void }
  /** The quick settings. */
  quick: { open: boolean; set: (open: boolean) => void }
}

/** A take: what sits in the bar and what it opens, and the slider in the quick settings and in Settings. */
export interface Take {
  key: string
  kbd: string
  label: string
  idea: string
  bar: (ctx: Ctx) => ReactNode
  slider: (ctx: Ctx, compact: boolean) => ReactNode
}
