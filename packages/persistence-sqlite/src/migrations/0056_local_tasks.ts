import { at, vocabulary, word } from './0001_initial/columns'

/*
 * A task works Local, in the person's own checkout, or in a worktree of its
 * own, as before (ADR-086): the project's rules say where new tasks start,
 * and each plan where its task does. A workspace's `kind` is which it is: a
 * `checkout` is the repository's clone on this device, held by one task at a
 * time, which Althar never removes. It is null for a worktree, as SQLite adds
 * a column referencing a vocabulary only where it may be null.
 * `returns_to` is what the checkout was on when the task took it (a branch,
 * or a commit where it had none), and `returned_at` when it went back to it,
 * or was left where the person had put it.
 */
export const statements: ReadonlyArray<string> = [
  ...vocabulary('works_in', ['worktree', 'checkout']),
  `ALTER TABLE workspaces ADD COLUMN ${word('kind', 'works_in', { nullable: true })}`,
  'ALTER TABLE workspaces ADD COLUMN returns_to TEXT',
  `ALTER TABLE workspaces ADD COLUMN ${at('returned_at', { nullable: true })}`,
]
