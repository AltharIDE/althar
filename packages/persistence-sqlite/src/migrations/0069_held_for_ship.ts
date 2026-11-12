/*
 * A task's branch held for Ship (a task is a conversation plus parts, "A
 * tweak waits for Ship"): what the person's turns with its lead commit after
 * its plan stays on the branch, and nothing pushes it but Ship, which runs
 * the review first. `workspaces.held_at` is when the hold began, at the end
 * of the first such turn that left commits past where Althar last pushed;
 * null while nothing waits. Ship clears it once the commits are up.
 *
 * `turn_deliveries.heads` is what a turn the person's words began found:
 * each of the task's worktrees' head, by workspace, as JSON. Its end
 * compares against it, so a turn that committed holds the branch, after a
 * restart too; null for every other turn.
 *
 * Additive: every workspace made before holds nothing, so its commits go up
 * as they did; and a build before this one reads past the columns.
 */
export const statements: ReadonlyArray<string> = [
  `ALTER TABLE workspaces ADD COLUMN held_at TEXT CHECK (held_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')`,
  'ALTER TABLE turn_deliveries ADD COLUMN heads TEXT CHECK (json_valid(heads))',
]
