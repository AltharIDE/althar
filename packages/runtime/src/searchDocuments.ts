import type { SearchDocument } from '@althar/contracts'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'
import { phaseRead, phasesNow } from './Search'

/* Read the local record, never a provider or a command per keystroke. Pages keep
 * transfers small and yield between reads; no task-search backfill is needed.
 * A fresh collection replaces the last whole collection, so deletions disappear
 * too. Only public conversation text is included, never thoughts or tool input. */
/** The latest passages the index keeps, across the profile: a long history stays a bounded read and a bounded copy in the window. */
export const SAID_KEPT = 5000

export const searchDocuments = Effect.fn('Search.documents')(function* (
  after = '',
  working: ReadonlySet<string> = new Set(),
  kept = SAID_KEPT,
) {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<SearchDocument>`
    WITH documents AS (
      SELECT 'task:' || k.id AS id, 'task' AS kind, k.project_id, t.id AS thread_id, k.id AS task_id,
        NULL AS item_id, k.title, coalesce(k.request, k.description, '') AS body,
        k.slug AS ref, NULL AS url,
        coalesce((SELECT max(h.created_at) FROM thread_items h WHERE h.thread_id = t.id AND h.created_at > k.created_at), k.created_at) AS changed_at,
        k.state
      FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
      UNION ALL
      SELECT 'link:' || l.id, CASE l.kind WHEN 'change' THEN 'pull' ELSE 'issue' END,
        l.project_id, t.id, l.task_id, NULL, coalesce(json_extract(l.snapshot, '$.title'), k.title),
        coalesce(json_extract(l.snapshot, '$.body'), ''), l.key, l.url, l.updated_at,
        CASE WHEN l.kind = 'issue' THEN coalesce(json_extract(l.snapshot, '$.status.name'), '')
          WHEN json_extract(l.snapshot, '$.state') = 'open' AND json_extract(l.snapshot, '$.draft') THEN 'draft'
          ELSE coalesce(json_extract(l.snapshot, '$.state'), '') END
      FROM external_links l JOIN tasks k ON k.id = l.task_id
        JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
      WHERE l.kind IN ('change', 'issue')
      UNION ALL
      SELECT 'note:' || n.id, 'note', n.project_id, t.id, NULL, NULL, n.body, n.body, '', NULL, n.created_at, ''
      FROM project_notes n LEFT JOIN threads t ON t.project_id = n.project_id AND t.kind = 'coordinator'
      WHERE n.dropped_at IS NULL
      UNION ALL
      SELECT 'conversation:' || t.id, 'conversation', t.project_id, t.id, NULL, NULL,
        p.name || '’s conversation', '', '', NULL, t.created_at, ''
      FROM threads t JOIN projects p ON p.id = t.project_id WHERE t.kind = 'coordinator'
      UNION ALL
      SELECT 'said:' || i.id, 'said', i.project_id, t.id, t.task_id, i.id,
        trim(coalesce(json_extract(i.content, '$.text'), json_extract(i.content, '$.summary'), '') || char(10) ||
          coalesce((SELECT group_concat(coalesce(json_extract(f.value, '$.title') || ' ', '') || json_extract(f.value, '$.claim'), char(10))
            FROM json_each(i.content, '$.findings') f), ''), char(10)),
        coalesce(json_extract(i.content, '$.built'), ''), coalesce(k.title, 'Conversation'), NULL, i.created_at, ''
      FROM thread_items i JOIN threads t ON t.id = i.thread_id AND t.kind IN ('task', 'coordinator')
        LEFT JOIN tasks k ON k.id = t.task_id
        LEFT JOIN user_inputs u ON u.id = i.user_input_id
      WHERE i.kind IN ('user_message', 'agent_message', 'step_result', 'arrival')
        AND i.id IN (SELECT n.id FROM thread_items n WHERE n.kind IN ('user_message', 'agent_message', 'step_result', 'arrival') ORDER BY n.id DESC LIMIT ${kept})
        AND (i.kind != 'user_message' OR u.state IN ('queued', 'delivered'))
    )
    SELECT d.* FROM documents d JOIN projects p ON p.id = d.project_id
    WHERE p.archived_at IS NULL AND d.id > ${after} AND d.title != ''
    ORDER BY d.id LIMIT 201`
  const documents = rows.slice(0, 200)
  const ids = documents.filter((one) => one.kind === 'task').map((one) => one.taskId!)
  if (ids.length > 0) {
    const phase = phaseRead(sql)
    const phaseNow = yield* phasesNow()
    const states = yield* sql<Parameters<typeof phaseNow>[0]>`
      SELECT k.id AS task_id, ${phase.columns} FROM tasks k
      LEFT JOIN threads ch ON ch.id = (SELECT h.id FROM threads h WHERE h.project_id = k.project_id AND h.kind = 'coordinator' LIMIT 1)
      LEFT JOIN task_plans p ON p.id = (SELECT id FROM task_plans WHERE task_id = k.id AND state IN ('proposed', 'accepted') ORDER BY proposed_at DESC LIMIT 1)
      LEFT JOIN runs n ON n.id = (SELECT id FROM runs WHERE task_id = k.id ORDER BY created_at DESC LIMIT 1)
      WHERE k.id IN ${sql.in(ids)}`
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i]!
      const state = states.find((one) => one.taskId === doc.taskId)
      if (doc.kind === 'task' && state !== undefined) {
        const now = phaseNow(state, working)
        documents[i] = { ...doc, state: now === 'settled' ? state.state : now }
      }
    }
  }
  return { documents, next: rows.length > 200 ? documents.at(-1)!.id : null }
})
