import { Clock, Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { RuntimeConfig } from './Config'

/**
 * A recorded push's checks may still be registering. This belongs to the
 * pushed head, whoever pushed it, rather than to whether its task is still
 * in Althar's hands. Repeated reads never extend the wait.
 */
export const checksAppearing = (taskId: string, url: string, head: string, knownChecks = false, wait?: Duration.Duration) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ pushedAt: string | null; hasChecks: number; unreadable: number }>`
      SELECT (SELECT min(p.observed_at) FROM observations p
        WHERE p.subject_type = 'external_link' AND p.subject_id = l.id AND p.kind = 'pushed'
          AND json_extract(p.payload, '$.sha') = ${head}) AS pushed_at,
        EXISTS (SELECT 1 FROM external_links e JOIN observations c ON c.subject_type = 'external_link' AND c.subject_id = e.id
          AND c.kind = 'checks' WHERE e.project_id = l.project_id AND e.kind = 'change'
            AND json_extract(e.snapshot, '$.repository') = json_extract(l.snapshot, '$.repository')) AS has_checks,
        EXISTS (SELECT 1 FROM observations u WHERE u.subject_type = 'external_link' AND u.subject_id = l.id
          AND u.kind = 'checks_unreadable' AND json_extract(u.payload, '$.id') = ${`unreadable:${head}`}) AS unreadable
      FROM external_links l WHERE l.task_id = ${taskId} AND l.url = ${url} AND l.kind = 'change' LIMIT 1`
    if (row?.pushedAt == null || row.unreadable === 1 || (!knownChecks && row.hasChecks !== 1)) return false
    const within = Duration.toMillis(wait ?? (yield* RuntimeConfig).checksAppear ?? Duration.minutes(1))
    return (yield* Clock.currentTimeMillis) - Date.parse(row.pushedAt) < within
  })
