import type { ReactNode } from 'react'
import type { LoadGlance } from '@althar/ui'

import type { Pov, Runners, Waiting, Worker } from './data'

/** What the window, the bar and Settings draw from, and what they can do in the lab. */
export interface Ctx {
  /** On this computer's own home, or connected to studio. */
  pov: Pov
  /** The home's workers, the home first. */
  workers: readonly Worker[]
  /** The window's home: This Mac, or studio. */
  home: Worker
  /** This Mac: one of the home's workers, or not (on studio, unless lent). */
  mac: Worker
  /** The home's load, as the bar's meter reads it. */
  load: LoadGlance
  /** Any worker's. */
  loadOf: (worker: Worker) => LoadGlance
  /** What waits for an agent, on every board. */
  waiting: readonly Waiting[]
  most: number
  /** A worker's own number; null goes back to its default. */
  setCount: (worker: string, n: number | null) => void
  /** Whether a worker takes new tasks. */
  taking: (worker: string) => boolean
  setTaking: (worker: string, on: boolean) => void
  /** On studio or in the cloud: This Mac runs the home's tasks too. */
  lent: boolean
  setLent: (on: boolean) => void
  /** The home's cloud runners, where it uses them. */
  runners: Runners | null
  /** Their number; null goes back to the suggestion. */
  setRunners: (n: number | null) => void
  setAuto: (on: boolean) => void
  setLimit: (limit: number | null) => void
  /** Opens a task, from a row. */
  onOpen: (id: string) => void
  /** Says in the lab's bar what a press would do. */
  say: (what: string) => void
  /** The home's popover, from the meter. */
  peek: { open: boolean; set: (open: boolean) => void }
  /** The quick settings. */
  quick: { open: boolean; set: (open: boolean) => void }
  /** Opens Settings, on a computer where one is given. */
  settings: (worker?: string) => void
  /** Opens Add a computer. */
  add: () => void
}

/** A section of Settings, drawn: its name, its line, what is in it. */
export interface Page {
  title: string
  lede?: string
  body: ReactNode
}

/** Where Settings is: the section open, and the worker opened in it, where one is. */
export interface Place {
  section: string
  worker: string | null
}

/** How a take tells the computers apart: a word over each name, headings over groups, or a picture of each. */
export type Label = 'words' | 'sections' | 'pictures'

/** A take on Computers: B's modules, each told apart its own way. */
export interface Take {
  key: string
  kbd: string
  label: string
  idea: string
  style: Label
}
