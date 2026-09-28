import { DateTime, Effect, Schema } from 'effect'

/** An instant in UTC as ISO 8601 with milliseconds, such as `2026-09-28T20:34:23.123Z`. Stored as text, it sorts in time order. */
export const Timestamp = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)).pipe(
  Schema.brand('Timestamp'),
)
export type Timestamp = typeof Timestamp.Type

/** The current instant from the Effect clock. */
export const now: Effect.Effect<Timestamp> = Effect.map(DateTime.now, (instant) => Timestamp.make(DateTime.formatIso(instant)))
