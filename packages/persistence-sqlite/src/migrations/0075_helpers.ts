/*
 * Helpers (ADR-087, as "a task is a conversation plus parts" amends it): a
 * session a task's lead starts in the background, on any agent, in a step
 * thread of the task's own (`thread_id`), working in the worktree of the
 * change it was handed (`workspace_id`), the only one writing there until it
 * reports. Its last message comes back to the lead as a new turn (`result`).
 *
 * `state`: `working` until its turn ends, then `done`; `stopped` where the
 * lead or the person stopped it, `failed` where it couldn't start.
 */
export const statements: ReadonlyArray<string> = [
  `CREATE TABLE helpers (
    id TEXT PRIMARY KEY NOT NULL,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL,
    workspace_id TEXT,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
    brief TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    model TEXT,
    state TEXT NOT NULL CHECK (state IN ('working', 'done', 'stopped', 'failed')),
    result TEXT,
    started_at TEXT NOT NULL CHECK (started_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
    ended_at TEXT CHECK (ended_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
  ) STRICT`,
  `CREATE INDEX helpers_by_task ON helpers (task_id)`,
  `CREATE UNIQUE INDEX helpers_by_thread ON helpers (thread_id)`,
]
