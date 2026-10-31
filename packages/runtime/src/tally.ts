import { type KindTally, TALLY_DAYS, TallyKind } from '@althar/contracts'
import { SECRET_PLACES } from '@althar/provider-adapters'
import { Clock, Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql'
import { guardStopIn } from './pushGuard'

/*
 * How each kind of ask and refusal went (ADR-071), for the project's rules:
 * over the last `TALLY_DAYS` days, how often a kind asked the person and
 * they allowed it, how often it was refused, and how often the agent then
 * worked around one it wasn't allowed. A kind that mostly gets worked
 * around is one the person can drop.
 *
 * An ask is a permission card (its kind in the card's `counted`); a refusal
 * is a decision the rules or the coordinator made against a request no one
 * was asked about (its kind on the decision), or one the boundary made
 * itself, which no rule saw: git's guard, or the sandbox saying a command
 * couldn't do something there (`stoppedIn`, on the failed call's item).
 * Worked around: the agent's
 * turn went on, and a call it made after the one it wasn't allowed
 * completed, as it does when it finds another way. Read from the record
 * each time; what was decided before kinds were kept isn't counted.
 */

const isKind = Schema.is(TallyKind)

/** Each kind that asked or was refused in a project lately, the most first. */
export const tallyOf = (projectId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const now = yield* Clock.currentTimeMillis
    const since = new Date(now - TALLY_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const rows = yield* sql<{ kind: string; asked: number; allowed: number; refused: number; workedAround: number }>`
      WITH counted AS (
        SELECT json_extract(a.payload, '$.counted') AS kind, 1 AS asked, d.outcome = 'allow' AS allowed, 0 AS refused,
          d.outcome AS outcome, p.provider_session_id AS session, p.tool_call_id AS call
        FROM attention_requests a
        JOIN permission_requests p ON p.id = a.permission_request_id
        LEFT JOIN decisions d ON d.permission_request_id = p.id
        WHERE a.project_id = ${projectId} AND a.kind = 'permission' AND a.created_at >= ${since}
          AND json_extract(a.payload, '$.counted') IS NOT NULL
        UNION ALL
        SELECT d.kind, 0, 0, 1, d.outcome, p.provider_session_id, p.tool_call_id
        FROM decisions d
        JOIN permission_requests p ON p.id = d.permission_request_id
        WHERE d.project_id = ${projectId} AND d.decided_at >= ${since} AND d.outcome = 'reject' AND d.kind IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM attention_requests a WHERE a.permission_request_id = p.id)
        UNION ALL
        SELECT json_extract(i.content, '$.stopped'), 0, 0, 1, 'reject', i.provider_session_id, i.tool_call_id
        FROM thread_items i
        WHERE i.project_id = ${projectId} AND i.kind = 'tool_call' AND i.created_at >= ${since}
          AND json_extract(i.content, '$.stopped') IS NOT NULL
      )
      SELECT kind, sum(asked) AS asked, sum(coalesce(allowed, 0)) AS allowed, sum(refused) AS refused,
        sum(coalesce(outcome, '') <> 'allow' AND EXISTS (
          SELECT 1 FROM thread_items item
          JOIN thread_items later ON later.thread_id = item.thread_id AND later.sequence > item.sequence
            AND later.delivery_id = item.delivery_id AND later.kind = 'tool_call'
          WHERE item.provider_session_id = counted.session AND item.tool_call_id = counted.call
            AND json_extract(later.content, '$.status') = 'completed'
        )) AS worked_around
      FROM counted
      GROUP BY kind
      ORDER BY asked + refused DESC, kind`
    return rows.flatMap((row): ReadonlyArray<KindTally> =>
      isKind(row.kind)
        ? [{ kind: row.kind, asked: row.asked, allowed: row.allowed, refused: row.refused, workedAround: row.workedAround }]
        : [],
    )
  })

/** What a sandbox says when it stops a command: macOS's, and a read-only bind on Linux (bubblewrap). */
const REFUSED_THERE = /operation not permitted|read-only file system/i

/** Where the person keeps keys, as a path a refusal names. */
const KEPT_KEYS = new RegExp(`/(?:${SECRET_PLACES.map((place) => place.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:/|\\b)`)

/**
 * What the boundary refused a command, from what it printed: the kind git's
 * guard names, whether the command then failed or went on; or, where a
 * sandbox holds the session and the command failed saying it couldn't,
 * reading where keys are kept or writing outside. A command that went on
 * printing that has no mark of the sandbox's to tell it from one that
 * printed a log or a file saying it, so only the guard's mark counts there.
 */
export const stoppedIn = (printed: string, call: { readonly sandboxed: boolean; readonly failed: boolean }): TallyKind | undefined => {
  const guarded = guardStopIn(printed)
  if (guarded !== undefined) return guarded
  if (!call.sandboxed || !call.failed || !REFUSED_THERE.test(printed)) return undefined
  return KEPT_KEYS.test(printed) ? 'credentials' : 'outside'
}
