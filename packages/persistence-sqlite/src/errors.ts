import { Schema } from 'effect'

/** The row was changed by someone else since the caller read it. */
export class RevisionConflict extends Schema.TaggedError<RevisionConflict>()('RevisionConflict', {
  table: Schema.String,
  id: Schema.String,
  expected: Schema.Int,
  actual: Schema.Int,
}) {}

export class RowNotFound extends Schema.TaggedError<RowNotFound>()('RowNotFound', {
  table: Schema.String,
  id: Schema.String,
}) {}

/** A command id arrived again with a different command. Retries must repeat the command exactly. */
export class CommandIdReused extends Schema.TaggedError<CommandIdReused>()('CommandIdReused', {
  commandId: Schema.String,
}) {}
