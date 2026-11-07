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
  /**
   * When it resets, in the consumer's words, for every window: "resets 14:00 · in 2h 10m", or "reset at 14:00 · not read
   * since" where it has reset and no one has read it again, or that the provider gave no time.
   */
  resets?: string
  /** It has reset since it was read: how much of it is used no one has said yet, so no figure or bar, and never an empty limit. */
  unread?: boolean
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
  /**
   * Why no work can start on it, though numbers of its accounts are saved:
   * Signed out. Its figure then counts for nothing: it is said in place of
   * one, and the gauge and the peek's level go by the agents that can run.
   */
  stopped?: string
  /**
   * Why it has no figure, though work can start on it: every window read of
   * it has reset since, and how much of them is used no one has said yet. Not
   * read since reset. Said in place of a figure, as `stopped` is, with each
   * account's age and why it wasn't read again in the detail.
   */
  unread?: string
  /**
   * Its plan is signed in and can run, but nothing reads how much of it is
   * left (OpenCode Go without an OpenCode Console sign-in): Connected. Said
   * in place of a figure, with why in the detail.
   */
  connected?: string
  /** A sign-in that stops it is put right from the row: a button beside it, which the peek's `onSignIn` answers. */
  signIn?: boolean
}

/** The agent with least room that work can start on, of those with a figure: the figure that counts. */
export const firstRunning = (agents: readonly PlanAgent[]): PlanAgent | undefined =>
  agents.find((agent) => agent.stopped === undefined && agent.unread === undefined && agent.connected === undefined)

/** Under this share left, the gauge is in full ink. */
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
