/*
 * A task may be attached to a pull request it didn't open (ADR-045): one
 * opened by hand, or by an earlier try on another repository, such as a
 * fork's before its pull requests went upstream. Its change set then comes
 * from no run: the person or the coordinator attached it, perhaps to a task
 * only drafted, with none yet. So a change set's run may be null. SQLite
 * can't drop a NOT NULL in place, so the table is rebuilt (its documented
 * procedure; foreign keys are off while migrations run, and checked after).
 */
export const statements: ReadonlyArray<string> = [
  `CREATE TABLE change_sets_new (
  id TEXT PRIMARY KEY NOT NULL CHECK (substr(id, 1, 4) = 'chg_' AND length(id) = 36 AND substr(id, 5) NOT GLOB '*[^0-9a-f]*'),
  project_id TEXT NOT NULL REFERENCES projects (id),
  task_id TEXT NOT NULL,
  run_id TEXT,
  state TEXT NOT NULL REFERENCES vocab_change_set_state (word),
  created_at TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  FOREIGN KEY (task_id, project_id) REFERENCES tasks (id, project_id),
  FOREIGN KEY (run_id, project_id) REFERENCES runs (id, project_id),
  UNIQUE (id, project_id)
) STRICT`,
  'INSERT INTO change_sets_new SELECT * FROM change_sets',
  'DROP TABLE change_sets',
  'ALTER TABLE change_sets_new RENAME TO change_sets',
  'CREATE INDEX change_sets_by_task ON change_sets (task_id)',
]
