/*
 * What a project brought in from other tools (docs/decisions/workspaces-and-runs.md, "Bringing in other tools' work"): one
 * row for each worktree, setup and conversation, by its key (a worktree's folder, a setup's tool and repository, a
 * conversation's agent and session), so bringing it in again finds it and makes nothing twice. A worktree another tool
 * made is a task's workspace in place: `made_by` names that tool, and Althar never removes or sets up a folder it didn't make.
 */
export const statements: ReadonlyArray<string> = [
  'CREATE TABLE vocab_other_tool (word TEXT PRIMARY KEY NOT NULL) STRICT',
  `INSERT INTO vocab_other_tool (word) VALUES ('conductor'), ('orca'), ('t_three_code'), ('paradev'), ('cursor'), ('codex'), ('claude_code'), ('hand')`,
  'CREATE TABLE vocab_brought_kind (word TEXT PRIMARY KEY NOT NULL) STRICT',
  `INSERT INTO vocab_brought_kind (word) VALUES ('worktree'), ('setup'), ('conversation')`,
  'ALTER TABLE workspaces ADD COLUMN made_by TEXT REFERENCES vocab_other_tool (word)',
  `CREATE TABLE brought_in (
    project_id TEXT NOT NULL REFERENCES projects (id),
    key TEXT NOT NULL CHECK (length(key) > 0),
    kind TEXT NOT NULL REFERENCES vocab_brought_kind (word),
    tool TEXT NOT NULL REFERENCES vocab_other_tool (word),
    task_id TEXT REFERENCES tasks (id),
    binding_id TEXT REFERENCES repository_bindings (id),
    created_at TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
    PRIMARY KEY (project_id, key),
    CHECK ((kind = 'setup') = (task_id IS NULL))
  ) STRICT`,
  'CREATE INDEX brought_in_task ON brought_in (task_id) WHERE task_id IS NOT NULL',
]
