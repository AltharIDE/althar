import { EvidenceGallery, GalleryUpdate, type PictureReport, updateScreenshots, viewOfKey } from '@althar/contracts'
import { Effect, Option, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { evidenceOf, keptViewsIn } from './evidence'
import { quickIn } from './kinds'

const decodeUpdate = Schema.decodeUnknownOption(GalleryUpdate)
export const galleryUpdateIn = (value: unknown): GalleryUpdate | undefined => Option.getOrUndefined(decodeUpdate(value))

/**
 * The same durable collection serves the window, the lead and PR posting.
 * Only reports after the checkpoint are read. Old reports replay their old
 * selection, so migration does not resurrect discarded prototype directions.
 * The transaction serializes checkpoint reads and writes on the store's writer.
 */
export const evidenceGallery = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const [task] = yield* sql<{ quick: number; changed: number; since: string | null }>`
        SELECT ${sql.unsafe(quickIn('k'))} AS quick,
          EXISTS (SELECT 1 FROM external_links l WHERE l.task_id = k.id AND l.kind = 'change') AS changed,
          (SELECT e.occurred_at FROM record_events e WHERE e.aggregate_type = 'task' AND e.aggregate_id = k.id
            AND e.type = 'task.made_change' ORDER BY e.sequence DESC LIMIT 1) AS since
        FROM threads t JOIN tasks k ON k.id = t.task_id WHERE t.id = ${threadId}`
        const options = { change: task?.quick !== 1 || task?.changed === 1, since: task?.since ?? null }
        const scope = JSON.stringify(options)
        const [checkpoint] = yield* sql<{ scope: string; revision: number; handoff: number; shots: string }>`
        SELECT scope, through_sequence AS revision, handoff, shots FROM evidence_galleries WHERE thread_id = ${threadId}`
        const existing = checkpoint?.scope === scope ? checkpoint : undefined
        let revision = existing?.revision ?? 0
        let handoff = existing?.handoff ?? 0
        let shots: EvidenceGallery['shots'] = existing === undefined ? [] : JSON.parse(existing.shots)
        const rows = yield* sql<{ id: string; sequence: number; createdAt: string; content: string }>`
        SELECT id, sequence, created_at, content FROM thread_items
        WHERE thread_id = ${threadId} AND kind = 'step_result' AND sequence > ${revision} ORDER BY sequence`
        for (const row of rows) {
          const content = JSON.parse(row.content) as Record<string, unknown>
          if (content.step === 'implement' || content.step === 'settle') {
            handoff = row.sequence
            const report: PictureReport = {
              id: row.id,
              sequence: row.sequence,
              createdAt: row.createdAt,
              evidence: evidenceOf(content.evidence),
              ...keptViewsIn(content.keptViews),
              gallery: galleryUpdateIn(content.gallery),
            }
            shots = updateScreenshots(shots, report, options)
          }
          revision = row.sequence
        }
        if (existing === undefined || revision !== existing.revision)
          yield* sql`
          INSERT INTO evidence_galleries (thread_id, scope, through_sequence, handoff, shots)
          VALUES (${threadId}, ${scope}, ${revision}, ${handoff}, ${JSON.stringify(shots)})
          ON CONFLICT (thread_id) DO UPDATE SET scope = excluded.scope, through_sequence = excluded.through_sequence, handoff = excluded.handoff, shots = excluded.shots`
        return { revision, shots: shots.map((shot) => ({ ...shot, earlier: (shot.sequence ?? handoff) < handoff })) }
      }),
    )
  })

/** Destructive collection edits must be based on the collection the lead actually read. */
export const galleryEditProblem = (current: EvidenceGallery, update: GalleryUpdate, expected: number | undefined): string | null => {
  const remove = update.remove ?? []
  const invalidate = update.invalidate ?? []
  if ((update.mode === 'replace' || remove.length > 0 || invalidate.length > 0) && expected === undefined)
    return 'Read the collection with read_gallery first, then give its revision in expected_gallery_revision when removing, invalidating or replacing views.'
  if (expected !== undefined && expected !== current.revision)
    return 'The visual collection changed since you read it. Call read_gallery again and apply your edit to its current revision.'
  const known = new Set(current.shots.map((shot) => viewOfKey(shot.key)))
  for (const view of [...remove, ...invalidate])
    if (!known.has(view)) return `There is no view named “${view}” in the visual collection. Call read_gallery for its current view IDs.`
  if (remove.some((view) => invalidate.includes(view))) return 'A view cannot be removed and invalidated in the same handoff.'
  return null
}
