/*
 * A change that waits for another of its task's to merge without building on
 * its code (a task is a conversation plus parts, "Starting and splitting"):
 * both work toward the same branch, and this one, `waits_for` the other's
 * workspace, says so. Its failing checks that the first fixes don't go to
 * its lead or the person; once the first merges, its target is brought in.
 * Null for every other change, as for every one made before.
 */
export const statements: ReadonlyArray<string> = [`ALTER TABLE workspaces ADD COLUMN waits_for TEXT`]
