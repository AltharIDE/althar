import { Schema } from 'effect'

/** Git can switch branches before the workspace transaction commits. Its journal keeps unpublished work across retries. */
export const ShipBranchMove = Schema.Struct({
  fromBranch: Schema.String,
  fromHead: Schema.String,
  branch: Schema.String,
  /** A complete branch retaining the recovered tail, independent of a replacement branch that may not exist yet. */
  recoveryBranch: Schema.optional(Schema.String),
  /** The new branch starts here; copied source commits are distinguished from later work after this point. */
  onto: Schema.optional(Schema.String),
  /** Source commits copied in order; later matching patches still belong to the new work after this sequence. */
  copies: Schema.optional(Schema.Array(Schema.String)),
  /** Later commits recovered from an interrupted branch, replayed locally after the accepted publication boundary. */
  carry: Schema.optional(Schema.Array(Schema.String)),
})
