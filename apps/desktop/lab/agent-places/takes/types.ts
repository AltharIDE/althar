import type { ReactNode } from 'react'
import type { LoadGlance } from '@althar/ui'

import type { Waiting, Worker } from '../data'

/** What a take draws from, and what it can do in the lab. */
export interface Ctx {
  /** The home's workers, this Mac first. */
  workers: readonly Worker[]
  /** This Mac. */
  here: Worker
  /** This Mac's load, as the bar's meter reads it. */
  load: LoadGlance
  /** Any worker's. */
  loadOf: (worker: Worker) => LoadGlance
  /** What waits for an agent, on every board. */
  waiting: readonly Waiting[]
  most: number
  /** A worker's own number; null goes back to its default. */
  setCount: (worker: string, n: number | null) => void
  /** Opens a task, from a row. */
  onOpen: (id: string) => void
  /** Says in the lab's bar what a press would do. */
  say: (what: string) => void
  /** This Mac, the meter's popover. */
  peek: { open: boolean; set: (open: boolean) => void }
  /** The homes chip's menu. */
  homes: { open: boolean; set: (open: boolean) => void }
  /** The quick settings. */
  quick: { open: boolean; set: (open: boolean) => void }
  /** Opens Settings, on a worker's number where one is given. */
  settings: (worker?: string) => void
}

/** What a take opens as the lab loads, and keeps open as the rest changes. */
export type Opens = 'peek' | 'homes' | 'quick'

/** A take: the bar and what it opens, the quick settings' slider and what follows it, and Settings' slider and what follows. */
export interface Take {
  key: string
  kbd: string
  label: string
  idea: string
  opens: Opens
  bar: (ctx: Ctx) => ReactNode
  slider: (ctx: Ctx, compact: boolean) => ReactNode
  /** After the quick settings' slider, on its sheet. */
  quick?: (ctx: Ctx) => ReactNode
  /** After Settings' list, as groups of their own. */
  settings?: (ctx: Ctx) => ReactNode
}
