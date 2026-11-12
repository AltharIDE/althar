/*
 * A task holds as many changes as it needs (a task is a conversation plus
 * parts, "A task holds as many changes as it needs"), and reviews any number
 * of pull requests: each change being worked on has a worktree of its own,
 * in each repository it touches, and each pull request reviewed a copy at
 * its head beside them. So a task has as many workspaces in a repository on
 * a computer as it has changes there, and copies besides.
 *
 * Today's key, one workspace per task and repository on a computer, becomes
 * two unique indexes: one for the task's own workspaces (`reviewing` null),
 * by branch, so each change has its row; and one per pull request reviewed.
 * Two, since a null never clashes in a plain unique key. SQLite can't drop a
 * table's UNIQUE in place, so the table is rebuilt (its documented
 * procedure; foreign keys are off while migrations run, and checked after).
 *
 * What is new on it:
 * - `name`: a change's name, a few words, where the task has several; null
 *   for its first, which the task's title names.
 * - `reviewing`: the pull request a copy is at, by its address; null for the
 *   task's own workspaces.
 * - `state` gains `away`: a change whose folder another of the task's took,
 *   as its lead switched branch there; its branch and pull request stay.
 * - `moving_to`: a move between a worktree and Local that waits for the
 *   person's checkout (`worktree` or `checkout`), until it is made or
 *   called off; null otherwise.
 * - `kind`, now its own vocabulary (worktree, checkout, copy) rather than
 *   where a task works, gains `copy`, for a checkout detached at a commit made from now
 *   on, which keeps nothing. Rows already copies, a review's (its access
 *   read) and a quick task's that hasn't branched, keep their kind, as
 *   setting up and clearing folders read it, and are told by what they say
 *   already; a review's gets the pull request it reviews as `reviewing`.
 */
export const statements: ReadonlyArray<string> = [
  'CREATE TABLE vocab_workspace_kind (word TEXT PRIMARY KEY NOT NULL) STRICT',
  "INSERT INTO vocab_workspace_kind (word) VALUES ('worktree'), ('checkout'), ('copy')",
  // A change whose folder another change of the task took, as its lead switched branch there: no folder until it is worked on again.
  "INSERT INTO vocab_workspace_state (word) VALUES ('away')",
  `CREATE TABLE workspaces_new (
  id TEXT PRIMARY KEY NOT NULL CHECK (substr(id, 1, 3) = 'ws_' AND length(id) = 35 AND substr(id, 4) NOT GLOB '*[^0-9a-f]*'),
  project_id TEXT NOT NULL REFERENCES projects (id),
  task_id TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  device_id TEXT NOT NULL REFERENCES devices (id),
  access TEXT NOT NULL REFERENCES vocab_repository_access (word),
  path TEXT NOT NULL,
  base_ref TEXT NOT NULL,
  base_commit TEXT CHECK (length(base_commit) IN (40, 64) AND base_commit NOT GLOB '*[^0-9a-f]*'),
  branch TEXT NOT NULL,
  state TEXT NOT NULL REFERENCES vocab_workspace_state (word),
  created_at TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  cleaned_at TEXT CHECK (cleaned_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  setup TEXT CHECK (json_valid(setup)),
  branched_at TEXT CHECK (branched_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  kind TEXT REFERENCES vocab_workspace_kind (word),
  returns_to TEXT,
  returned_at TEXT CHECK (returned_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  toward TEXT,
  held_at TEXT CHECK (held_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  name TEXT,
  reviewing TEXT,
  moving_to TEXT CHECK (moving_to IN ('worktree', 'checkout')),
  FOREIGN KEY (task_id, project_id) REFERENCES tasks (id, project_id),
  FOREIGN KEY (binding_id, project_id) REFERENCES repository_bindings (id, project_id),
  UNIQUE (id, project_id)
) STRICT`,
  `INSERT INTO workspaces_new (id, project_id, task_id, binding_id, device_id, access, path, base_ref, base_commit, branch, state,
    created_at, cleaned_at, revision, setup, branched_at, kind, returns_to, returned_at, toward, held_at)
  SELECT id, project_id, task_id, binding_id, device_id, access, path, base_ref, base_commit, branch, state,
    created_at, cleaned_at, revision, setup, branched_at, kind, returns_to, returned_at, toward, held_at FROM workspaces`,
  'DROP TABLE workspaces',
  'ALTER TABLE workspaces_new RENAME TO workspaces',
  // A review's copy is at the pull request it reviews.
  `UPDATE workspaces SET reviewing = (
    SELECT x.url FROM external_links x WHERE x.task_id = workspaces.task_id AND x.kind = 'review' ORDER BY x.created_at LIMIT 1)
  WHERE access = 'read'`,
  `CREATE UNIQUE INDEX workspaces_one_per_branch ON workspaces (task_id, binding_id, device_id, branch) WHERE reviewing IS NULL`,
  `CREATE UNIQUE INDEX workspaces_one_per_review ON workspaces (task_id, binding_id, device_id, reviewing) WHERE reviewing IS NOT NULL`,
  'CREATE INDEX workspaces_by_task ON workspaces (task_id)',
]
