import { Schema } from 'effect'

export const NudgeKind = Schema.Literals(['call', 'stopped', 'ready'])
export type NudgeKind = typeof NudgeKind.Type

/** Advisory notifications plus current badge/work state. Durable asks themselves remain in the home and its change feed. */
export const AttentionEvent = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Nudge'),
    kind: NudgeKind,
    key: Schema.String,
    title: Schema.String,
    body: Schema.String,
    threadId: Schema.String,
  }),
  Schema.Struct({ _tag: Schema.Literal('Waiting'), count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) }),
  Schema.Struct({ _tag: Schema.Literal('Working'), working: Schema.Boolean }),
])
export type AttentionEvent = typeof AttentionEvent.Type
