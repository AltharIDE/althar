import { Schema } from 'effect'

import { OpenUnion } from './open'

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

/** An attention event as a client hears it: one of a type a newer home sends and this client doesn't know is `Unknown`, passed over. */
export const HeardAttention = OpenUnion('_tag', AttentionEvent.members, 'Unknown')
export type HeardAttention = typeof HeardAttention.Type

/** Whether a client knows the attention event it heard. */
export const isKnownAttention = (event: HeardAttention): event is AttentionEvent => event._tag !== 'Unknown'
