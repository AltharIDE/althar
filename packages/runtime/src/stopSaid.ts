import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/*
 * What a stopped task's card says of its stop, as stop_task recorded it: who
 * stopped it (the coordinator, or a lead, by its task), why, and the task its
 * work went on in, where it was folded into another.
 */

/** A string field of a fact's payload, or empty. */
const said = (payload: string, key: string): string => {
  try {
    const value: unknown = (JSON.parse(payload) as Record<string, unknown> | null)?.[key]
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}

/** Whether a stop fact only says why, or where its work went, of a task stopped already. */
const noted = (payload: string): boolean => {
  try {
    return (JSON.parse(payload) as Record<string, unknown> | null)?.['noted'] === true
  } catch {
    return false
  }
}

/** A task as a stopped card names it: its title and its thread. */
const namedTask = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ title: string; threadId: string }>`
      SELECT k.title, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task' WHERE k.id = ${taskId}`
    return row
  })

/**
 * Who stopped a task, why, and where its work went on, as stop_task recorded it (TaskActions): its stops since its run was
 * suspended at `since`, those said again on a task stopped already included: who from the latest, a reason or a fold from
 * the latest that says one. A lead's stop recorded before it named its
 * task names the task that started this one, whose lead it almost always is. Nothing where nothing is on record.
 */
export const stopSaid = (taskId: string, since: number | null, parentId: string | null) =>
  Effect.gen(function* () {
    if (since === null) return {}
    const sql = yield* SqlClient.SqlClient
    const stops = yield* sql<{ payload: string }>`
      SELECT payload FROM record_events
      WHERE aggregate_type = 'task' AND aggregate_id = ${taskId} AND type IN ('task.moved', 'task.moved_on_word')
        AND json_extract(payload, '$.move') = 'stop' AND sequence > ${since}
      ORDER BY sequence`
    if (stops.length === 0) return {}
    // Who is the stop itself; a reason or a fold said after it, on a task stopped already, never changes who stopped it, and
    // stands until a later one says another.
    const stop = stops.findLast((one) => !noted(one.payload))
    const last = (key: string) => stops.reduceRight((found, one) => found || said(one.payload, key), '')
    const role = stop === undefined ? '' : said(stop.payload, 'by')
    const why = last('why').trim()
    const from = (stop === undefined ? '' : said(stop.payload, 'from')) || (role === 'lead' ? parentId : null)
    const into = last('into')
    const lead = role === 'lead' && from !== null && from !== '' ? yield* namedTask(from) : undefined
    const went = into === '' ? undefined : yield* namedTask(into)
    return {
      ...(role === 'lead' ? { who: 'lead' as const } : role === 'coordinator' ? { who: 'coordinator' as const } : {}),
      ...(lead === undefined ? {} : { lead }),
      ...(why === '' ? {} : { why }),
      ...(went === undefined ? {} : { into: went }),
    }
  })

/** A task's latest run, suspended: when its latest attempt ended, and who suspended it, by the fact that says so. */
export const suspendedOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ endedAt: string | null; actorId: string | null; sequence: number | null; kind: string | null }>`
      SELECT
        (SELECT a.ended_at FROM run_attempts a WHERE a.run_id = r.id ORDER BY a.attempt_number DESC LIMIT 1) AS ended_at,
        e.actor_id, e.sequence, (SELECT kind FROM actors WHERE id = e.actor_id) AS kind
      FROM runs r LEFT JOIN record_events e ON e.sequence = (
        SELECT sequence FROM record_events WHERE aggregate_type = 'run' AND aggregate_id = r.id AND type = 'run.suspended'
        ORDER BY sequence DESC LIMIT 1)
      WHERE r.task_id = ${taskId} ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1`
    return row
  })
