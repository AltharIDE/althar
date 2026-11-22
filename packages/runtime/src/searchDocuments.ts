import type { SearchDocument } from '@althar/contracts'
import { Database } from '@althar/persistence-sqlite'
import { Effect } from 'effect'
import { SqlClient, type Statement } from 'effect/sql'
import { phaseRead, phasesNow } from './Search'

/* Read the local record, never a provider or a command per keystroke. Pages keep
 * transfers small and yield between reads; no task-search backfill is needed.
 * A fresh collection replaces the last whole collection, so deletions disappear
 * too. Only public conversation text is included, never thoughts or tool input. */
/** The latest passages the index keeps, across the profile: a long history stays a bounded read and a bounded copy in the window. */
export const SAID_KEPT = 5000
const PASSAGE_BATCH = 128
const PASSAGE_KINDS = "('user_message', 'agent_message', 'step_result', 'arrival')"

export const searchDocuments = Effect.fn('Search.documents')(function* (
  after = '',
  working: ReadonlySet<string> = new Set(),
  kept = SAID_KEPT,
) {
  const sql = yield* SqlClient.SqlClient
  const reader = yield* Database.ReadLane
  // IDs sort by kind, then by their original id. Read only the kinds that can still fit this page, and bound each
  // before constructing the next: the old UNION materialized and sorted the whole catalog on every page.
  const rows: SearchDocument[] = []
  const read = <A>(query: Statement.Statement<A>) => Effect.andThen(Effect.yieldNow, reader.read(query, 'background'))
  const cursor = (prefix: string) => (after < prefix ? '' : after.startsWith(prefix) ? after.slice(prefix.length) : null)
  const room = () => 201 - rows.length
  const conversation = cursor('conversation:')
  if (conversation !== null && room() > 0)
    rows.push(
      ...(yield* read(sql<SearchDocument>`
      SELECT 'conversation:' || t.id AS id, 'conversation' AS kind, t.project_id, t.id AS thread_id, NULL AS task_id, NULL AS item_id,
        p.name || '’s conversation' AS title, '' AS body, '' AS ref, NULL AS url, t.created_at AS changed_at, '' AS state
      FROM threads t JOIN projects p ON p.id = t.project_id
      WHERE t.kind = 'coordinator' AND p.archived_at IS NULL AND t.id > ${conversation}
      ORDER BY t.id LIMIT ${room()}`)),
    )
  const link = cursor('link:')
  if (link !== null && room() > 0)
    rows.push(
      ...(yield* read(sql<SearchDocument>`
      SELECT 'link:' || l.id AS id, CASE l.kind WHEN 'change' THEN 'pull' ELSE 'issue' END AS kind,
        l.project_id, t.id AS thread_id, l.task_id, NULL AS item_id, coalesce(json_extract(l.snapshot, '$.title'), k.title) AS title,
        coalesce(json_extract(l.snapshot, '$.body'), '') AS body, l.key AS ref, l.url, l.updated_at AS changed_at,
        CASE WHEN l.kind = 'issue' THEN coalesce(json_extract(l.snapshot, '$.status.name'), '')
          WHEN json_extract(l.snapshot, '$.state') = 'open' AND json_extract(l.snapshot, '$.draft') THEN 'draft'
          ELSE coalesce(json_extract(l.snapshot, '$.state'), '') END AS state
      FROM external_links l JOIN tasks k ON k.id = l.task_id JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
        JOIN projects p ON p.id = l.project_id
      WHERE l.kind IN ('change', 'issue') AND p.archived_at IS NULL AND l.id > ${link}
        AND coalesce(json_extract(l.snapshot, '$.title'), k.title) != ''
      ORDER BY l.id LIMIT ${room()}`)),
    )
  const note = cursor('note:')
  if (note !== null && room() > 0)
    rows.push(
      ...(yield* read(sql<SearchDocument>`
      SELECT 'note:' || n.id AS id, 'note' AS kind, n.project_id, t.id AS thread_id, NULL AS task_id, NULL AS item_id,
        n.body AS title, n.body, '' AS ref, NULL AS url, n.created_at AS changed_at, '' AS state
      FROM project_notes n LEFT JOIN threads t ON t.project_id = n.project_id AND t.kind = 'coordinator'
        JOIN projects p ON p.id = n.project_id
      WHERE n.dropped_at IS NULL AND p.archived_at IS NULL AND n.body != '' AND n.id > ${note}
      ORDER BY n.id LIMIT ${room()}`)),
    )
  const said = cursor('said:')
  if (said !== null && kept > 0 && room() > 0) {
    const [bounds] = yield* read(sql<{ earliest: string | null; latest: string | null }>`
      SELECT
        (SELECT id FROM thread_items WHERE kind IN ${sql.unsafe(PASSAGE_KINDS)} ORDER BY id DESC LIMIT 1 OFFSET ${kept - 1}) AS earliest,
        (SELECT id FROM thread_items WHERE kind IN ${sql.unsafe(PASSAGE_KINDS)} ORDER BY id DESC LIMIT 1) AS latest`)
    const latest = bounds?.latest ?? ''
    let from = said
    let remaining = kept
    while (from < latest && room() > 0 && remaining > 0) {
      // Seek through the narrow index first. Even when recent passages are mostly hidden or empty,
      // each statement opens and formats at most one batch of records before yielding.
      const batch = yield* read(sql<({ id: null } | SearchDocument) & { scannedThrough: string | null; scanned: number }>`
      WITH batch AS MATERIALIZED (
        SELECT id FROM thread_items WHERE kind IN ${sql.unsafe(PASSAGE_KINDS)}
          AND id > ${from} AND id >= ${bounds?.earliest ?? ''} AND id <= ${latest}
        ORDER BY id LIMIT ${Math.min(PASSAGE_BATCH, remaining)}
      ), passages AS MATERIALIZED (
        SELECT 'said:' || i.id AS id, 'said' AS kind, i.project_id, t.id AS thread_id, t.task_id, i.id AS item_id,
          trim(coalesce(json_extract(i.content, '$.text'), json_extract(i.content, '$.summary'), '') || char(10) ||
            coalesce((SELECT group_concat(coalesce(json_extract(f.value, '$.title') || ' ', '') || json_extract(f.value, '$.claim'), char(10))
              FROM json_each(i.content, '$.findings') f), ''), char(10)) AS title,
          coalesce(json_extract(i.content, '$.built'), '') AS body, coalesce(k.title, 'Conversation') AS ref, NULL AS url,
          i.created_at AS changed_at, '' AS state
        FROM batch JOIN thread_items i ON i.id = batch.id
          JOIN threads t ON t.id = i.thread_id AND t.kind IN ('task', 'coordinator')
          LEFT JOIN tasks k ON k.id = t.task_id LEFT JOIN user_inputs u ON u.id = i.user_input_id
          JOIN projects p ON p.id = i.project_id
        WHERE p.archived_at IS NULL AND (i.kind != 'user_message' OR u.state IN ('queued', 'delivered'))
      )
      SELECT scan.*, passages.*
      FROM (SELECT max(id) AS scanned_through, count(*) AS scanned FROM batch) scan
        LEFT JOIN passages ON passages.title != ''
      ORDER BY passages.id LIMIT ${room()}`)
      const first = batch[0]
      if (first?.scannedThrough == null) break
      from = first.scannedThrough
      remaining -= first.scanned
      for (const { scannedThrough: _, scanned: _count, ...passage } of batch) {
        if (passage.id !== null) rows.push(passage)
      }
      if (first.scanned < PASSAGE_BATCH) break
    }
  }
  const task = cursor('task:')
  if (task !== null && room() > 0)
    rows.push(
      ...(yield* read(sql<SearchDocument>`
      SELECT 'task:' || k.id AS id, 'task' AS kind, k.project_id, t.id AS thread_id, k.id AS task_id,
        NULL AS item_id, k.title, coalesce(k.request, k.description, '') AS body, k.slug AS ref, NULL AS url,
        coalesce((SELECT max(h.created_at) FROM thread_items h WHERE h.thread_id = t.id AND h.created_at > k.created_at), k.created_at) AS changed_at,
        k.state
      FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task' JOIN projects p ON p.id = k.project_id
      WHERE p.archived_at IS NULL AND k.title != '' AND k.id > ${task}
      ORDER BY k.id LIMIT ${room()}`)),
    )
  const documents = rows.slice(0, 200)
  const ids = documents.filter((one) => one.kind === 'task').map((one) => one.taskId!)
  if (ids.length > 0) {
    const phase = phaseRead(sql)
    const phaseNow = yield* phasesNow()
    const states = yield* read(sql<Parameters<typeof phaseNow>[0]>`
      SELECT k.id AS task_id, ${phase.columns} FROM tasks k
      LEFT JOIN threads ch ON ch.id = (SELECT h.id FROM threads h WHERE h.project_id = k.project_id AND h.kind = 'coordinator' LIMIT 1)
      LEFT JOIN task_plans p ON p.id = (SELECT id FROM task_plans WHERE task_id = k.id AND state IN ('proposed', 'accepted') ORDER BY proposed_at DESC LIMIT 1)
      LEFT JOIN runs n ON n.id = (SELECT id FROM runs WHERE task_id = k.id ORDER BY created_at DESC LIMIT 1)
      WHERE k.id IN ${sql.in(ids)}`)
    const stateByTask = new Map(states.map((one) => [one.taskId, one]))
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i]!
      const state = doc.taskId === null ? undefined : stateByTask.get(doc.taskId)
      if (doc.kind === 'task' && state !== undefined) {
        const now = phaseNow(state, working)
        documents[i] = { ...doc, state: now === 'settled' ? state.state : now }
      }
    }
  }
  return { documents, next: rows.length > 200 ? documents.at(-1)!.id : null }
})
