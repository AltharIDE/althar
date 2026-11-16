/*
 * Tasks wait for their blockers: a task names the tasks it waits for, and its
 * plan starts by itself once they have all merged. One row for each task it
 * waits for, in the order they were named (`created_at`); a row goes when it
 * stops waiting for that task, or either task goes.
 */
export const statements: ReadonlyArray<string> = [
  `CREATE TABLE task_waits (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (task_id, on_task_id),
    CHECK (task_id <> on_task_id)
  ) STRICT`,
  'CREATE INDEX task_waits_on ON task_waits(on_task_id)',
]
