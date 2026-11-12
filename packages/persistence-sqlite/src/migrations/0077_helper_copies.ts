/*
 * A helper given no change works in a copy of its own (ADR-087, task 6): a
 * snapshot of its lead's worktree checked out apart, `copy_path`, from
 * `snapshot`. What it changes there is thrown away with the copy, unless it
 * `writes`: then it is kept as a commit on `kept_ref`, never pushed, for its
 * lead to bring in with git. Null, and 0, for a helper handed a change, which
 * works in that change's worktree, as for every one started before.
 */
export const statements: ReadonlyArray<string> = [
  `ALTER TABLE helpers ADD COLUMN copy_path TEXT`,
  `ALTER TABLE helpers ADD COLUMN snapshot TEXT`,
  `ALTER TABLE helpers ADD COLUMN writes INTEGER NOT NULL DEFAULT 0 CHECK (writes IN (0, 1))`,
  `ALTER TABLE helpers ADD COLUMN kept_ref TEXT`,
]
