/*
 * An errand kept from a press of the person's in the window, Merge when
 * checks pass, rather than from a message of theirs in a turn: its
 * `message_id` names the press (`press:<command id>`), which no user input
 * holds, so it no longer has to be one. A resumed errand's message still is.
 * SQLite can't drop a foreign key in place, so the table is rebuilt (its
 * documented procedure; foreign keys are off while migrations run, and
 * checked after), every row kept as it was.
 */
export const statements: ReadonlyArray<string> = [
  `CREATE TABLE errands_new (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id),
    thread_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    words TEXT NOT NULL,
    resume_message_id TEXT,
    resume_words TEXT,
    paused_after_sequence INTEGER,
    state TEXT NOT NULL CHECK (state IN ('open', 'paused', 'done', 'cancelled')),
    reason TEXT,
    created_at TEXT NOT NULL,
    news_at TEXT NOT NULL,
    reminded_at TEXT,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    FOREIGN KEY (thread_id, project_id) REFERENCES threads(id, project_id),
    FOREIGN KEY (resume_message_id, project_id) REFERENCES user_inputs(id, project_id),
    UNIQUE(id, project_id)
  ) STRICT`,
  `INSERT INTO errands_new (id, project_id, thread_id, message_id, words, resume_message_id, resume_words, paused_after_sequence,
      state, reason, created_at, news_at, reminded_at, revision)
    SELECT id, project_id, thread_id, message_id, words, resume_message_id, resume_words, paused_after_sequence,
      state, reason, created_at, news_at, reminded_at, revision FROM errands`,
  'DROP TABLE errands',
  'ALTER TABLE errands_new RENAME TO errands',
  'CREATE INDEX errands_open ON errands(project_id, state)',
]
