import { Option, Schema } from 'effect'

/*
 * A repository's recorded setup (ADR-023, Setups.ts), as its binding's column
 * keeps it: read where it is replayed, shown, and where a lead's sandbox lets
 * its commands through from the start (sandboxReach.ts).
 */

/** A repository's setup as a lead recorded it, or the person changed it: what Althar replays in each new task's worktree. */
export const Recorded = Schema.Struct({
  /** Ignored files and folders to copy from the person's checkout, from the repository's root. */
  copy: Schema.Array(Schema.String),
  /** The commands that get it ready, run one after another from the repository's folder, until one fails. */
  commands: Schema.Array(Schema.String),
  /** When it was recorded. */
  at: Schema.String,
  /** The task whose lead recorded it; null for the person's. */
  taskId: Schema.NullOr(Schema.String),
})
export type Recorded = typeof Recorded.Type

const decodeRecorded = Schema.decodeUnknownOption(Schema.fromJsonString(Recorded))

/** A binding's recorded setup, as its column keeps it; null for none, or one that can't be read. */
export const recordedOf = (json: string | null): Recorded | null => (json === null ? null : Option.getOrNull(decodeRecorded(json)))
