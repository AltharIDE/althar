/*
 * Chats on Scratch, and presets (a task is a conversation plus parts).
 *
 * `tasks.shelf`: `scratch` for a chat, a task with a conversation and a copy
 * of the default branch and nothing else, which sits on Scratch, off the
 * board's lanes, until it takes a worktree or an output, or the person moves
 * it; null for a task on the board, as every task made before is.
 *
 * `presets`: a named set of a task's starting parts, the person's, in
 * Althar's settings: built in (`builtin`, which the person can't remove), or
 * saved from a task, kept to that project where `project_id` says.
 * `parts` is JSON: its workspace, Checked by and when, its ending, where it
 * sits, its lead and reviewer, and a few lines of brief.
 */
export const statements: ReadonlyArray<string> = [
  `ALTER TABLE tasks ADD COLUMN shelf TEXT CHECK (shelf IN ('scratch'))`,
  `CREATE TABLE presets (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
    parts TEXT NOT NULL CHECK (json_valid(parts)),
    builtin INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0, 1)),
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    from_task_id TEXT,
    created_at TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
    updated_at TEXT NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
  ) STRICT`,
  `CREATE UNIQUE INDEX presets_by_name ON presets (coalesce(project_id, ''), lower(name))`,
]
