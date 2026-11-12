import type { SessionEvent } from '@althar/provider-adapters'

/*
 * Where a turn's time went (a task is a conversation plus parts, "Where a
 * turn's time goes"): waiting for a place among the agents at work here,
 * starting its session or handing it over, and the agent's own work, of
 * which the tools it ran are a part. Kept on its delivery as it ends
 * (`turn_deliveries.timings`), in milliseconds, so "why is it slow" has an
 * answer for every turn.
 */

/** How a session began, where a turn was its first: started for the work, or handed over to a fresh one. */
export type Starting = 'start' | 'handover'

export interface TurnTimings {
  /** Waiting for a place among the agents at work here (Busy.ts). */
  readonly place: number
  /** Starting its session, or handing it over, and its folder's setup where it waited for it; only a session's first turn counts it. */
  readonly session: number
  readonly starting: Starting | null
  /** The agent's own work, from the prompt going out to the turn's end: the tools it ran are a part of it. */
  readonly work: number
  /** The tools it ran, counted once where several ran at once. */
  readonly tools: number
  /**
   * Getting the turn ready, from its input being taken to its prompt going out: the coordinator's copies brought up to date,
   * its news read, the turn recorded. Absent for a turn from before Althar kept it.
   */
  readonly ready?: number
  /** Of `ready`, bringing the coordinator's copies of the repositories up to date; absent for a lead's turn. */
  readonly copies?: number
  /** From the prompt going out to the agent's first word, thought or call: the model's own wait. Absent where it said nothing. */
  readonly first?: number
  /** In a task of several changes, how many commits the turn made in each that it committed to, by name; absent otherwise. */
  readonly changes?: ReadonlyArray<{ readonly name: string; readonly commits: number }>
}

const ended = (status: string | undefined) => status === 'completed' || status === 'failed'

/**
 * The time a turn's tools ran, counted once where several ran at once: a
 * call is open from the first word of it to the update that says it
 * completed or failed, and the clock runs while any is open.
 */
export const toolClock = () => {
  const open = new Set<string>()
  let since: number | null = null
  let total = 0
  return {
    heard(event: SessionEvent, now: number): void {
      if (event._tag !== 'ToolCall' && event._tag !== 'ToolCallUpdate') return
      if (ended(event.status)) {
        // One that arrives already ended took no time we saw.
        if (!open.delete(event.toolCallId)) return
        if (open.size === 0 && since !== null) {
          total += Math.max(0, now - since)
          since = null
        }
        return
      }
      if (event._tag === 'ToolCallUpdate' && !open.has(event.toolCallId) && event.status === undefined) return
      if (open.size === 0) since = now
      open.add(event.toolCallId)
    },
    /** What they ran for, up to `now` for those still open as the turn ends. */
    total(now: number): number {
      return since === null ? total : total + Math.max(0, now - since)
    },
  }
}

const whole = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0)

/** A delivery's timings as the store keeps them; null for a turn before they were kept, or that hasn't ended. */
export const timingsFrom = (json: string | null): TurnTimings | null => {
  if (json === null) return null
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const starting = record.starting === 'start' || record.starting === 'handover' ? record.starting : null
  const work = whole(record.work)
  return {
    place: whole(record.place),
    session: whole(record.session),
    starting,
    work,
    tools: Math.min(work, whole(record.tools)),
    ...(Array.isArray(record.changes) ? { changes: changesFrom(record.changes) } : {}),
    ...(typeof record.ready === 'number' ? { ready: whole(record.ready) } : {}),
    ...(typeof record.copies === 'number' ? { copies: whole(record.copies) } : {}),
    ...(typeof record.first === 'number' ? { first: Math.min(work, whole(record.first)) } : {}),
  }
}

/** Where a turn's commits went, as kept: each change by name, with a count above none. */
const changesFrom = (list: ReadonlyArray<unknown>) =>
  list.flatMap((one) => {
    if (typeof one !== 'object' || one === null) return []
    const { name, commits } = one as Record<string, unknown>
    return typeof name === 'string' && whole(commits) > 0 ? [{ name, commits: whole(commits) }] : []
  })
