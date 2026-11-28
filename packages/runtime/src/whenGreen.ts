import { Clock, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { CALLED_OFF, PRESSED, pressSubject } from './Errands'

/** How long a press on its way to the merge line is said to wait without its errand kept yet. */
export const PRESS_ON_ITS_WAY = 10 * 60_000
/**
 * Merge when checks pass, as an open pull request's card shows it: waiting while a merge errand of the line's waits on
 * it, however it was asked for; sent back where a press's came back without merging, with why, until the next press.
 */
export const whenGreenOf = (url: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [open] = yield* sql<{ head: string | null; messageId: string }>`
      SELECT s.head, e.message_id FROM errands e JOIN errand_steps s ON s.errand_id = e.id
      WHERE s.tool = 'merge_pull_request' AND lower(s.target) = ${url.toLowerCase()} AND e.state = 'open' AND s.state = 'waiting'
      ORDER BY e.created_at DESC, e.rowid DESC LIMIT 1`
    const [said] = yield* sql<{ payload: string; observedAt: string }>`
      SELECT payload, observed_at FROM observations WHERE subject_type = 'merge_line' AND subject_id = ${pressSubject(url)}
        AND kind = 'press' ORDER BY rowid DESC LIMIT 1`
    const last =
      said === undefined
        ? undefined
        : (JSON.parse(said.payload) as { press?: string | null; state?: string; reason?: string; errand?: string })
    const press = last?.press == null ? {} : { press: last.press }
    // Waiting, said to the person's latest press of it, which may have joined an errand kept before (its own or an agent's).
    if (open !== undefined)
      return {
        state: 'waiting' as const,
        ...(open.head === null ? {} : { head: open.head }),
        ...(last?.state === 'asked' && last.press != null
          ? { press: last.press }
          : open.messageId.startsWith(PRESSED)
            ? { press: open.messageId.slice(PRESSED.length) }
            : {}),
      }
    if (last?.state === 'asked') {
      // The errand the press kept, or joined (another press's, or an agent's): ended, its end is the press's, said to it.
      const [ended] = yield* sql<{ state: string; reason: string | null }>`
        SELECT state, reason FROM errands
        WHERE id = ${last.errand ?? ''} OR (${last.press ?? null} IS NOT NULL AND message_id = ${`${PRESSED}${last.press ?? ''}`})
        ORDER BY created_at DESC, rowid DESC LIMIT 1`
      if (ended !== undefined)
        return (ended.state === 'cancelled' || ended.state === 'paused') && ended.reason !== null && ended.reason !== CALLED_OFF
          ? { state: 'sent_back' as const, reason: ended.reason, ...press }
          : undefined
      // A press on its way to the line, kept only so long: one a restart cut short is no longer said to wait.
      if ((yield* Clock.currentTimeMillis) - Date.parse(said?.observedAt ?? '') < PRESS_ON_ITS_WAY)
        return { state: 'waiting' as const, ...press }
    }
    if (last?.state === 'sent_back' && typeof last.reason === 'string')
      return { state: 'sent_back' as const, reason: last.reason, ...press }
    return undefined
  })
