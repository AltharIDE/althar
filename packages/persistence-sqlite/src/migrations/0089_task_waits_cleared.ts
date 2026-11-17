/*
 * Tasks wait for their blockers: a task it waits for that merged is cleared
 * once, and stays cleared, though it opens again for follow-up work. A
 * trigger marks it as the task is done, whichever way it got there.
 */
export const statements: ReadonlyArray<string> = [
  'ALTER TABLE task_waits ADD COLUMN cleared_at TEXT',
  `UPDATE task_waits SET cleared_at = created_at WHERE EXISTS (SELECT 1 FROM tasks b WHERE b.id = task_waits.on_task_id AND b.state = 'done')`,
  `CREATE TRIGGER task_waits_cleared AFTER UPDATE OF state ON tasks WHEN NEW.state = 'done' BEGIN
    UPDATE task_waits SET cleared_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE on_task_id = NEW.id AND cleared_at IS NULL;
  END`,
]
