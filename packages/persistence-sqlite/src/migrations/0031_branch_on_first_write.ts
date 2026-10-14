import { at } from './0001_initial/columns'

/*
 * A plain task's worktree starts with no branch (DEV-96, ADR-035): detached
 * at the commit it starts from, its branch's name planned in `branch` as any
 * task's is. Althar makes that branch where its lead first changes the
 * repository, and says when here. Null until then; every worktree made
 * before this was made on its branch, so it was branched as it was made.
 */
export const statements: ReadonlyArray<string> = [
  `ALTER TABLE workspaces ADD COLUMN ${at('branched_at', { nullable: true })}`,
  'UPDATE workspaces SET branched_at = created_at',
]
