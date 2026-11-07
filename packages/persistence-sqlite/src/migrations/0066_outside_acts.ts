/*
 * ADR-097: what agents did outside their worktrees, across a project, for the
 * board's While you were away: a merge, a post, an issue moved, tasks
 * started. Each with its task (none for the coordinator's own), when, how it
 * is taken back (a revert, or undone through the same host or tracker, with
 * what that needs), why it can't be now, and how taking it back went. Kept
 * once for what it acted on (`source`). And when each person last looked at
 * a project's list, and the last act they saw then, which it starts after.
 */
export const statements: ReadonlyArray<string> = [
  "INSERT INTO vocab_aggregate_type (word) VALUES ('outside_act')",
  `CREATE TABLE outside_acts (
    id TEXT PRIMARY KEY NOT NULL CHECK (substr(id, 1, 4) = 'oac_' AND length(id) = 36 AND substr(id, 5) NOT GLOB '*[^0-9a-f]*'),
    project_id TEXT NOT NULL REFERENCES projects (id),
    -- Null for the coordinator's own.
    task_id TEXT REFERENCES tasks (id) ON DELETE SET NULL,
    thread_id TEXT REFERENCES threads (id),
    kind TEXT NOT NULL CHECK (kind IN ('merge', 'post', 'issue', 'start', 'other')),
    what TEXT NOT NULL,
    -- What it acted on, so the same act is kept once: a pull request's merge, an issue change's entry, a comment.
    source TEXT NOT NULL,
    undo TEXT CHECK (undo IN ('revert', 'undo')),
    -- What taking it back needs: the pull request, the issue and the status it had, the comment.
    undo_with TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(undo_with)),
    cant TEXT,
    state TEXT NOT NULL DEFAULT 'done' CHECK (state IN ('done', 'undoing', 'undone', 'failed')),
    error TEXT,
    undo_task_id TEXT REFERENCES tasks (id) ON DELETE SET NULL,
    done_at TEXT NOT NULL CHECK (done_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
    updated_at TEXT NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    UNIQUE (project_id, source),
    CHECK ((state = 'failed') = (error IS NOT NULL))
  ) STRICT`,
  'CREATE INDEX outside_acts_by_project ON outside_acts (project_id, done_at)',
  `CREATE TABLE away_looks (
    project_id TEXT NOT NULL REFERENCES projects (id),
    actor_id TEXT NOT NULL REFERENCES actors (id),
    looked_at TEXT NOT NULL CHECK (looked_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
    -- The last act they had seen then, by its rowid: the list is what came after it.
    seen INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (project_id, actor_id)
  ) STRICT`,
]
