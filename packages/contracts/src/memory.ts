import { Schema } from 'effect'

/** Learned evidence is attributed project history, never instructions or permission. */
export const MemoryState = Schema.Literals(['active', 'retired'])
export type MemoryState = typeof MemoryState.Type
export const MemoryEntry = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  threadId: Schema.String,
  taskId: Schema.NullOr(Schema.String),
  taskTitle: Schema.NullOr(Schema.String),
  sessionId: Schema.NullOr(Schema.String),
  agentId: Schema.NullOr(Schema.String),
  kind: Schema.String,
  text: Schema.String,
  createdAt: Schema.String,
  sourceRevision: Schema.Int,
  revision: Schema.Int,
  state: MemoryState,
  bases: Schema.Array(
    Schema.Struct({ repository: Schema.String, ref: Schema.String, commit: Schema.NullOr(Schema.String), branch: Schema.String }),
  ),
})
export type MemoryEntry = typeof MemoryEntry.Type
export const MemoryDetail = Schema.Struct({
  ...MemoryEntry.fields,
  source: Schema.Struct({
    kind: Schema.String,
    text: Schema.String,
    revision: Schema.Int,
    truncated: Schema.Boolean,
    offset: Schema.Int,
    nextOffset: Schema.NullOr(Schema.Int),
  }),
  history: Schema.Array(Schema.Struct({ sourceRevision: Schema.Int, text: Schema.String, recordedAt: Schema.String })),
  historyTruncated: Schema.Boolean,
  relatedUpdates: Schema.Array(MemoryEntry),
  contextNotice: Schema.String,
})
export type MemoryDetail = typeof MemoryDetail.Type
export const MemorySearch = Schema.Struct({ entries: Schema.Array(MemoryEntry), pending: Schema.Int })
export type MemorySearch = typeof MemorySearch.Type
