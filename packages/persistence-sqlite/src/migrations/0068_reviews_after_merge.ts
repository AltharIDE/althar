/*
 * A review a small change's merge promised, before it starts (README section
 * 6): the task it reads, and why its last try didn't start where it didn't.
 * Kept from the moment the merge is heard, so one that failed, or a launch
 * that stopped before it began, is tried again until the review exists.
 */
export const statements: ReadonlyArray<string> = [
  `CREATE TABLE reviews_after_merge (
    task_id TEXT PRIMARY KEY NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT`,
]
