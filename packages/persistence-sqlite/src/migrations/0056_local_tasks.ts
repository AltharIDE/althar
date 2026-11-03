import { at } from './0001_initial/columns'

/*
 * A task works Local, in the person's own checkout, or in a worktree of its
 * own, as before (ADR-086). `projects.works_in` is where new tasks start,
 * the coordinator choosing per task. A workspace's `kind` says which it is:
 * a `checkout` is the repository's clone on this device, held by one task at
 * a time, which Althar never removes; `returns_to` is the branch it was on
 * when the task took it (a commit, where it had none), and `returned_at`
 * when it went back to it, as the task was settled. Words are checked here,
 * not by a vocabulary's table: SQLite adds a column referencing one only
 * where it may be null.
 */
export const statements: ReadonlyArray<string> = [
  "ALTER TABLE projects ADD COLUMN works_in TEXT NOT NULL DEFAULT 'worktree' CHECK (works_in IN ('worktree', 'checkout'))",
  "ALTER TABLE workspaces ADD COLUMN kind TEXT NOT NULL DEFAULT 'worktree' CHECK (kind IN ('worktree', 'checkout'))",
  'ALTER TABLE workspaces ADD COLUMN returns_to TEXT',
  `ALTER TABLE workspaces ADD COLUMN ${at('returned_at', { nullable: true })}`,
]
