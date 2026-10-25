import type { Brand } from '../../foundations/brands/brands'

/*
 * Plan usage as the bar's gauge and its peek draw it, in the consumer's
 * words: each agent by the account work would start on, the one with the most
 * room, and that account's tightest window; then, opened, every account and
 * window. The consumer ranks the agents, least room first, and words the
 * times and windows.
 */

/** One window of an account, as the share left. */
export interface PlanWindow {
  id: string
  /** The window, as a row names it: 5 hours, Week, Opus week. */
  label: string
  /** 0 to 100. */
  left: number
  /** When it resets, as the consumer words a time: 14:00, Mon 09:00. */
  until: string | null
}

export interface PlanAccount {
  id: string
  /** Named only where the agent has several accounts. */
  name: string | null
  /** How old its numbers are, only where they are old: read 2 hours ago. */
  age: string | null
  /** Why its numbers are missing or old, in a sentence. */
  fault: string | null
  windows: readonly PlanWindow[]
}

/** An agent, by the account work on it would start on: its room is that account's tightest window. */
export interface PlanAgent {
  id: string
  name: string
  brand?: Brand
  /** 0 to 100. */
  left: number
  /** The window that figure is of, as a sentence names it: five-hour limit, weekly Opus limit. */
  limit: string
  until: string | null
  /** That account's name, where the agent has several. */
  account: string | null
  /** Every account read, tightest first. */
  accounts: readonly PlanAccount[]
}

/** An agent Althar reads no usage for, and why, in the runtime's words. */
export interface PlanSilent {
  name: string
  why: string
}

/** Under this share left, the bar says who and until when beside the gauge, as the load meter says memory running short. */
export const SAY_UNDER = 10

/** How many of the gauge's five steps a share left lights: the share used, a step lit as soon as it is begun. */
export const stepsUsed = (left: number, steps: number): number =>
  Math.min(steps, Math.max(0, Math.ceil(((100 - left) / 100) * steps - 0.001)))

/** How far a plan window has run down: the share left, deeper in ink as it goes. */
export enum UsageTone {
  /** More than half is left. */
  Plenty = 'plenty',
  Half = 'half',
  Low = 'low',
  Critical = 'critical',
  Last = 'last',
}

/** The tone of a window with `left` percent of it left. */
export const usageTone = (left: number): UsageTone => {
  if (left <= 5) return UsageTone.Last
  if (left <= 10) return UsageTone.Critical
  if (left <= 25) return UsageTone.Low
  if (left <= 50) return UsageTone.Half
  return UsageTone.Plenty
}
