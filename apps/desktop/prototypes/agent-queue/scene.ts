import { createContext, useContext } from 'react'

import type { BoardTask, Queued } from '@althar/contracts'

/*
 * What every piece of a page knows: which direction it is drawn in, and the
 * work on the board, so the kit's row, card and dock can find their task by
 * its slug or branch. Waiting work carries what the runtime would add to
 * `Queued` for it: its place in line (Busy's queue is oldest first), whether
 * it is under way already, and the step it carries on with.
 */

export type Direction = 'today' | 'a' | 'b' | 'c' | 'd' | 'e'

export interface InLine extends Queued {
  /** Its place in line, from 1. */
  readonly place: number
  /** Under way already: a turn of a task that has started waits, not its first step. */
  readonly started: boolean
  /** The step it is on, by name: Implement. */
  readonly step: string
  /** The page's direction, so the app's words (plain functions) can speak in it. */
  readonly direction: Direction
  /** On the home: how many of the project's waiting work hasn't started, and how many is under way. */
  readonly fresh?: number
  readonly under?: number
}

export const lineOf = (task: { readonly queued: Queued | null }): InLine | null => task.queued as InLine | null

export interface Scene {
  readonly direction: Direction
  readonly tasks: ReadonlyArray<BoardTask>
  /** Up next, in the order the board shows it, by slug. */
  readonly next: ReadonlyArray<string>
  /** What just started, as the board shows it. */
  readonly fresh?: string
  /** The row whose tip is held open, for a picture of what pointing at it says. */
  readonly tip?: string
}

export const SceneContext = createContext<Scene>({ direction: 'today', tasks: [], next: [] })

export const useScene = () => useContext(SceneContext)
