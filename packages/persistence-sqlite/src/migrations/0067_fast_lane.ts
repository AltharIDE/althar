/*
 * The fast lane's two thread items (README section 6 and 7, 6 November):
 * a small change's card, which says what the one-step path skipped and keeps
 * each step with its time, and the line Auto leaves when it moves a task's
 * lead to a lighter model because the plan is nearly out. Beside them, the
 * model a person kept for a task, which Auto keeps to: one row a task, removed
 * when they undo the move.
 */
export const statements: ReadonlyArray<string> = [
  "INSERT INTO vocab_thread_item_kind (word) VALUES ('small_change')",
  "INSERT INTO vocab_thread_item_kind (word) VALUES ('model_move')",
  `CREATE TABLE task_model_keeps (
    task_id TEXT PRIMARY KEY NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    -- The agent the person kept the task's lead on, and the model it kept.
    agent_id TEXT NOT NULL,
    model TEXT NOT NULL,
    kept_at TEXT NOT NULL
  ) STRICT`,
]
