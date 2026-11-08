/*
 * A task a lead starts records the task it was started from (ADR-097: leads
 * start tasks). The board card says "started by" it, and its parent's thread
 * has a line linking to it. Null for every task the person or the
 * coordinator started, and for all made before.
 */
export const statements: ReadonlyArray<string> = [
  'ALTER TABLE tasks ADD COLUMN parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL',
  'CREATE INDEX tasks_parent ON tasks(parent_task_id) WHERE parent_task_id IS NOT NULL',
]
