import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { refreshMemory } from './memory'

/** Changing the encoder or chunking requires rebuilding the projection. */
export const memoryVectorModel = 'Xenova/all-MiniLM-L6-v2@cb3d680149bf9a3209564e1b27ab3bb355b65707:q8'
export type MemoryEmbed = (texts: readonly string[]) => Promise<readonly (readonly number[])[]>
const visible = `m.state='active' AND i.revision=m.source_revision
 AND (i.user_input_id IS NULL OR EXISTS(SELECT 1 FROM user_inputs u WHERE u.id=i.user_input_id AND u.state NOT IN ('withdrawn','queued')))`
const chunks = (text: string) => {
  const result: string[] = []
  const offsets: number[] = []
  for (let offset = 0; offset < text.length && result.length < 16; offset += 800) {
    result.push(text.slice(offset, offset + 1000))
    offsets.push(offset)
    if (offset + 1000 >= text.length) break
  }
  const truncated = text.length > 13000
  // Keep the conclusion even when a pathological source exceeds the budget.
  if (truncated) {
    result[15] = text.slice(-1000)
    offsets[15] = text.length - 1000
  }
  return { texts: result.length ? result : [''], offsets: offsets.length ? offsets : [0], truncated }
}
const validate = (vectors: readonly (readonly number[])[], count: number) => {
  if (vectors.length !== count || vectors.some((v) => v.length === 0 || v.some((n) => !Number.isFinite(n))))
    throw new Error('Invalid project memory embeddings')
  return vectors
}
const cosine = (a: readonly number[], b: readonly number[]) => {
  if (a.length !== b.length) return 0
  let dot = 0,
    aa = 0,
    bb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    aa += a[i]! ** 2
    bb += b[i]! ** 2
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0
}

/** Model work runs outside transactions. Commit and reads both require the exact current source revision. */
export const semanticMemory = (projectId: string, query: string, embed: MemoryEmbed) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const projectionPending = yield* refreshMemory(projectId)
    const sources = yield* sql.unsafe<{ id: string; text: string; sourceRevision: number }>(
      `SELECT m.id,m.text,m.source_revision FROM project_memory m JOIN thread_items i ON i.id=m.id
       LEFT JOIN project_memory_vectors v ON v.id=m.id
       WHERE m.project_id=? AND ${visible} AND (v.id IS NULL OR v.source_revision<>m.source_revision OR v.model<>?)
       ORDER BY i.created_at,i.sequence,m.id LIMIT 128`,
      [projectId, memoryVectorModel],
    )
    for (const source of sources) {
      const part = chunks(source.text)
      const vectors = yield* Effect.tryPromise(async () => validate(await embed(part.texts), part.texts.length))
      yield* sql`INSERT INTO project_memory_vectors(id,source_revision,model,vectors,truncated)
        SELECT m.id,m.source_revision,${memoryVectorModel},${JSON.stringify(vectors)},${part.truncated ? 1 : 0}
        FROM project_memory m JOIN thread_items i ON i.id=m.id
        WHERE m.id=${source.id} AND m.project_id=${projectId} AND m.source_revision=${source.sourceRevision}
          AND i.revision=m.source_revision AND m.state='active'
          AND (i.user_input_id IS NULL OR EXISTS(SELECT 1 FROM user_inputs u WHERE u.id=i.user_input_id AND u.state NOT IN ('withdrawn','queued')))
        ON CONFLICT(id) DO UPDATE SET source_revision=excluded.source_revision,model=excluded.model,
          vectors=excluded.vectors,truncated=excluded.truncated`
    }
    const available = yield* sql.unsafe<{ id: string }>(
      `SELECT m.id FROM project_memory_vectors v JOIN project_memory m ON m.id=v.id
       JOIN thread_items i ON i.id=m.id WHERE m.project_id=? AND ${visible}
       AND v.source_revision=m.source_revision AND v.model=? LIMIT 1`,
      [projectId, memoryVectorModel],
    )
    if (available.length === 0 && sources.length === 0)
      return { threadIds: [], sourceIds: [], sourceOffsets: {}, sourceRevisions: {}, pending: projectionPending, truncatedSources: 0 }
    const queryTexts =
      query.length <= 1000
        ? [query]
        : [0, Math.floor((query.length - 1000) / 3), Math.floor((2 * (query.length - 1000)) / 3), query.length - 1000].map((offset) =>
            query.slice(offset, offset + 1000),
          )
    const queryVectors = yield* Effect.tryPromise(async () => validate(await embed(queryTexts), queryTexts.length))
    // Revalidate after asynchronous query encoding: a correction or retirement may
    // have invalidated a previously eligible vector while the model was running.
    const rows = yield* sql.unsafe<{ id: string; threadId: string; text: string; sourceRevision: number; vectors: string }>(
      `SELECT m.id,m.text,m.source_revision,i.thread_id,v.vectors FROM project_memory_vectors v JOIN project_memory m ON m.id=v.id
       JOIN thread_items i ON i.id=m.id WHERE m.project_id=? AND ${visible}
       AND v.source_revision=m.source_revision AND v.model=?`,
      [projectId, memoryVectorModel],
    )
    const scores = new Map<string, { score: number; sourceId: string; sourceRevision: number; offset: number }>()
    for (const row of rows) {
      const vectors = JSON.parse(row.vectors) as number[][]
      const offsets = chunks(row.text).offsets
      for (const [index, vector] of vectors.entries()) {
        const score = Math.max(...queryVectors.map((queryVector) => cosine(queryVector, vector)))
        if (score >= 0.3 && score > (scores.get(row.threadId)?.score ?? 0))
          scores.set(row.threadId, { score, sourceId: row.id, sourceRevision: row.sourceRevision, offset: offsets[index] ?? 0 })
      }
    }
    const [remaining] = yield* sql.unsafe<{ count: number }>(
      `SELECT count(*) AS count FROM project_memory m JOIN thread_items i ON i.id=m.id
       LEFT JOIN project_memory_vectors v ON v.id=m.id WHERE m.project_id=? AND ${visible}
       AND (v.id IS NULL OR v.source_revision<>m.source_revision OR v.model<>?)`,
      [projectId, memoryVectorModel],
    )
    const [truncated] = yield* sql.unsafe<{ count: number }>(
      `SELECT count(*) AS count FROM project_memory_vectors v JOIN project_memory m ON m.id=v.id
       JOIN thread_items i ON i.id=m.id WHERE m.project_id=? AND ${visible}
       AND v.source_revision=m.source_revision AND v.model=? AND v.truncated=1`,
      [projectId, memoryVectorModel],
    )
    const selected = [...scores].sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0])).slice(0, 4)
    return {
      threadIds: selected.map(([id]) => id),
      sourceIds: selected.map(([, value]) => value.sourceId),
      sourceOffsets: Object.fromEntries(selected.map(([, value]) => [value.sourceId, value.offset])),
      sourceRevisions: Object.fromEntries(selected.map(([, value]) => [value.sourceId, value.sourceRevision])),
      pending: projectionPending + (remaining?.count ?? 0),
      truncatedSources: truncated?.count ?? 0,
    }
  })
