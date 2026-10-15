import type { Brand } from '../../foundations/brands/brands'
import { MemoryPressure, unreachable } from '../../foundations/vocabulary'

/*
 * What a readout of this computer's load is given, measured and formatted
 * by the consumer: the whole of it, Althar's work's part, and each piece of
 * that work's share. And how it is drawn in steps, held still through small
 * changes.
 */

/** One piece of Althar's work, and its share of this computer: a task's agents and runs, a project's coordinator, or a run of its default branch. */
export interface LoadRow {
  id: string
  /** What it is, as the person knows it: the task's title, or the project's coordinator. */
  title: string
  /** The project it is in. */
  project: string
  /** The agent leading it, by name; none for a run. */
  agent?: string
  mark?: Brand
  /** Its share of all the CPU, 0 to 1. */
  cpu: number
  /** The memory it holds, formatted: 1.8 GB. */
  memory: string
  /** How many processes it is, with everything it started. */
  processes: number
}

/** A reading of the CPU, 0 to 1: all of it, and Althar's work's part. */
export interface LoadPoint {
  cpu: number
  work: number
}

export interface LoadGlance {
  /** All the CPU in use, 0 to 1, across every core. */
  cpu: number
  /** Althar's work's part of `cpu`; null where it can't be known. */
  work: number | null
  /** Memory in use, 0 to 1, without what the system keeps as cache. */
  memory: number
  /** Althar's work's part of `memory`; null where it can't be known. */
  workMemory: number | null
  /** Memory in use and all of it, formatted: 21.4 GB, 32 GB. */
  memoryUsed: string
  memoryTotal: string
  /** Null where the system doesn't say. */
  pressure: MemoryPressure | null
  /** Althar's work, most CPU first; empty when none runs, null where it can't be known. */
  rows: readonly LoadRow[] | null
  /** The last readings, oldest first, the last of them this one. */
  history: readonly LoadPoint[]
}

/** How loaded it is in a word, for the peek's head. */
export enum LoadLevel {
  Quiet = 'quiet',
  Busy = 'busy',
  Full = 'full',
}

/** From here the CPU counts as full; from BUSY, as busy. */
const FULL = 0.9
const BUSY = 0.45

const clamp = (n: number) => Math.min(1, Math.max(0, n))

/** Whether memory is short enough to say: a Mac compressing it or moving it to disk. */
export const strained = (pressure: MemoryPressure | null): pressure is MemoryPressure.Warning | MemoryPressure.Critical => {
  switch (pressure) {
    case null:
    case MemoryPressure.Normal:
      return false
    case MemoryPressure.Warning:
    case MemoryPressure.Critical:
      return true
    default:
      return unreachable(pressure)
  }
}

export const levelOf = (load: Pick<LoadGlance, 'cpu' | 'pressure'>): LoadLevel => {
  if (load.cpu >= FULL || strained(load.pressure)) return LoadLevel.Full
  return load.cpu >= BUSY ? LoadLevel.Busy : LoadLevel.Quiet
}

/** A share, 0 to 1, as a whole percent. */
export const percent = (share: number) => Math.round(clamp(share) * 100)

/** How many steps a meter has. */
export const STEPS = 5

/** How far past the middle between two steps a share must go to change step: a fifth of a step, four points of the load in five steps. */
const MARGIN = 0.2

/**
 * How many of `of` steps a share lights, held at `held` until the share is
 * well past the next step or well under it: a load sitting on the line
 * between two steps doesn't flick between them.
 */
export const heldSteps = (share: number, of: number, held: number | null): number => {
  const exact = clamp(share) * of
  return held !== null && Math.abs(exact - held) < 0.5 + MARGIN ? held : Math.round(exact)
}
