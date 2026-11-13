/** A task's visual collection is an incremental projection, independent of conversation pagination. */
export const statements: ReadonlyArray<string> = [
  `CREATE TABLE evidence_galleries (
    thread_id TEXT PRIMARY KEY REFERENCES threads (id) ON DELETE CASCADE,
    scope TEXT NOT NULL,
    through_sequence INTEGER NOT NULL CHECK (through_sequence >= 0),
    handoff INTEGER NOT NULL CHECK (handoff >= 0),
    shots TEXT NOT NULL CHECK (json_valid(shots))
  ) STRICT`,
  `CREATE INDEX thread_items_gallery_reports ON thread_items (thread_id, sequence) WHERE kind = 'step_result'`,
]
