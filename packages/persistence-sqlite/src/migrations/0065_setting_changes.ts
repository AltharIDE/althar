/*
 * ADR-097: the coordinator and leads change settings as the person can. Each
 * change is kept with what it changed, before and after, who made it (the
 * coordinator, or a task's lead) and the person's words it acted on, beside
 * its line in that agent's thread, so Undo can put it back and Settings can
 * say who changed a setting last. One that loosens what asks and that no
 * message of the person's asked for waits as a card (`asked`) until they
 * press it.
 */
export const statements: ReadonlyArray<string> = [
  "INSERT INTO vocab_aggregate_type (word) VALUES ('setting')",
  "INSERT INTO vocab_thread_item_kind (word) VALUES ('setting')",
  `CREATE TABLE setting_changes (
    id TEXT PRIMARY KEY NOT NULL,
    -- Null for Althar's own settings.
    project_id TEXT REFERENCES projects(id),
    section TEXT NOT NULL,
    -- What the change sets, in the shape change_settings takes it, and each setting's value before and after.
    change TEXT NOT NULL,
    before TEXT NOT NULL,
    after TEXT NOT NULL,
    by_kind TEXT NOT NULL CHECK (by_kind IN ('coordinator', 'lead')),
    by_task_id TEXT REFERENCES tasks(id),
    thread_id TEXT NOT NULL REFERENCES threads(id),
    item_id TEXT,
    words TEXT,
    loosens INTEGER NOT NULL DEFAULT 0 CHECK (loosens IN (0, 1)),
    state TEXT NOT NULL CHECK (state IN ('asked', 'done', 'undone', 'declined', 'moot')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
  ) STRICT`,
  'CREATE INDEX setting_changes_by_project ON setting_changes(project_id, state, created_at)',
]
