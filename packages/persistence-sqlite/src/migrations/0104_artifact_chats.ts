/*
 * An artifact's own chat (ADR-104, "Talking to an artifact"): a chat on Scratch that is an artifact's rather than an aside,
 * listed nowhere as a task, and the canvas it is about; none while it draws a new artifact's first version.
 */
export const statements: ReadonlyArray<string> = [
  `ALTER TABLE tasks ADD COLUMN artifact_chat INTEGER NOT NULL DEFAULT 0 CHECK (artifact_chat IN (0, 1))`,
  `ALTER TABLE tasks ADD COLUMN artifact_canvas_id TEXT REFERENCES canvases (id) ON DELETE SET NULL`,
  `CREATE INDEX tasks_by_artifact ON tasks (artifact_canvas_id) WHERE artifact_canvas_id IS NOT NULL`,
]
