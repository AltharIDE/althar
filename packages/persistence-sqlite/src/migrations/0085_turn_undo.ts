/** Chat rewind keeps the original record and durable file recovery checkpoints. */
export const statements: ReadonlyArray<string> = [
  `ALTER TABLE turn_deliveries ADD COLUMN checkpoints TEXT CHECK (json_valid(checkpoints))`,
  `ALTER TABLE turn_deliveries ADD COLUMN undone_at TEXT`,
  `ALTER TABLE thread_items ADD COLUMN undone_at TEXT`,
  `ALTER TABLE threads ADD COLUMN conversation_version INTEGER NOT NULL DEFAULT 1 CHECK (conversation_version >= 1)`,
  `CREATE TABLE turn_undo_recoveries (
    command_id TEXT PRIMARY KEY NOT NULL,
    thread_id TEXT NOT NULL REFERENCES threads(id),
    plans TEXT NOT NULL CHECK (json_valid(plans)),
    state TEXT NOT NULL CHECK (state IN ('prepared', 'completed', 'recovered'))
  ) STRICT`,
]
