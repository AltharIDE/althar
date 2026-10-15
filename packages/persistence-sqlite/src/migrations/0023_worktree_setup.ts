/*
 * A task's worktree is set up by Althar as it is made, before its lead starts
 * (ADR-023): the setup kept for its repository, else the install its lockfile
 * names. How that went is kept on its workspace, as JSON: when it ended, what
 * ran (null for nothing), its exit code, and the end of what it printed. Null
 * until it has run, so a worktree made again is set up again. And a thread
 * item for it, in the task's thread, which Althar keeps current.
 *
 * Worktrees whose task already had a lead were set up by that lead: they are
 * marked so, with nothing run, rather than set up again.
 */
export const statements: ReadonlyArray<string> = [
  'ALTER TABLE workspaces ADD COLUMN setup TEXT CHECK (json_valid(setup))',
  "INSERT INTO vocab_thread_item_kind (word) VALUES ('setup')",
  `UPDATE workspaces SET setup = json_object('at', created_at, 'command', NULL, 'code', NULL, 'timedOut', json('false'), 'last', NULL)
    WHERE state = 'ready' AND task_id IN (
      SELECT t.task_id FROM threads t JOIN provider_sessions s ON s.thread_id = t.id WHERE t.kind = 'task')`,
]
