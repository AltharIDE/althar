/* The dirty queue belongs to the store, so edits and removals reach search even
 * after a crash. Each source has a stable id and can be filled in small pages. */
const sources = [
  [
    'task',
    'tasks',
    `SELECT k.id AS source_id, k.project_id, t.id AS thread_id, k.id AS task_id, NULL AS item_id,
      k.title, coalesce(k.request, k.description, '') AS body, k.slug AS ref, NULL AS url, k.created_at AS changed_at, k.state
    FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'`,
  ],
  [
    'link',
    'external_links',
    `SELECT l.id AS source_id, l.project_id, t.id AS thread_id, l.task_id, NULL AS item_id,
      coalesce(json_extract(l.snapshot, '$.title'), k.title) AS title, coalesce(json_extract(l.snapshot, '$.body'), '') AS body,
      l.key AS ref, l.url, l.updated_at AS changed_at,
      CASE WHEN l.kind = 'issue' THEN coalesce(json_extract(l.snapshot, '$.status.name'), '')
        WHEN json_extract(l.snapshot, '$.state') = 'open' AND json_extract(l.snapshot, '$.draft') THEN 'draft'
        ELSE coalesce(json_extract(l.snapshot, '$.state'), '') END AS state,
      CASE l.kind WHEN 'change' THEN 'pull' ELSE 'issue' END AS kind
    FROM external_links l JOIN tasks k ON k.id = l.task_id JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
    WHERE l.kind IN ('change', 'issue')`,
  ],
  [
    'note',
    'project_notes',
    `SELECT n.id AS source_id, n.project_id, t.id AS thread_id, NULL AS task_id, NULL AS item_id,
      n.body AS title, n.body, '' AS ref, NULL AS url, n.created_at AS changed_at, '' AS state
    FROM project_notes n LEFT JOIN threads t ON t.project_id = n.project_id AND t.kind = 'coordinator'
    WHERE n.dropped_at IS NULL`,
  ],
  [
    'conversation',
    'threads',
    `SELECT t.id AS source_id, t.project_id, t.id AS thread_id, NULL AS task_id, NULL AS item_id,
      p.name || '’s conversation' AS title, '' AS body, '' AS ref, NULL AS url, t.created_at AS changed_at, '' AS state
    FROM threads t JOIN projects p ON p.id = t.project_id WHERE t.kind = 'coordinator'`,
  ],
  [
    'said',
    'thread_items',
    `SELECT i.id AS source_id, i.project_id, t.id AS thread_id, t.task_id, i.id AS item_id,
      trim(coalesce(json_extract(i.content, '$.text'), json_extract(i.content, '$.summary'), '') || char(10) ||
        coalesce((SELECT group_concat(coalesce(json_extract(f.value, '$.title') || ' ', '') || json_extract(f.value, '$.claim'), char(10))
          FROM json_each(i.content, '$.findings') f), ''), char(10)) AS title,
      coalesce(json_extract(i.content, '$.built'), '') AS body, coalesce(k.title, 'Conversation') AS ref,
      NULL AS url, i.created_at AS changed_at, '' AS state
    FROM thread_items i JOIN threads t ON t.id = i.thread_id AND t.kind IN ('task', 'coordinator')
      LEFT JOIN tasks k ON k.id = t.task_id LEFT JOIN user_inputs u ON u.id = i.user_input_id
    WHERE i.undone_at IS NULL AND i.kind IN ('user_message', 'agent_message', 'step_result', 'arrival')
      AND (i.kind != 'user_message' OR u.state IN ('queued', 'delivered'))`,
  ],
] as const

const publicKinds = "('user_message', 'agent_message', 'step_result', 'arrival')"
const mark = (source: string, id: string) =>
  `INSERT INTO finder_dirty(source, source_id) VALUES ('${source}', ${id}) ON CONFLICT(source, source_id) DO NOTHING;`

export const statements: ReadonlyArray<string> = [
  `CREATE TABLE finder_dirty (source TEXT NOT NULL, source_id TEXT NOT NULL, UNIQUE(source, source_id)) STRICT`,
  `CREATE TABLE finder_progress (source TEXT PRIMARY KEY, after_id TEXT NOT NULL, done INTEGER NOT NULL) STRICT`,
  `CREATE TABLE finder_rows (
    id INTEGER PRIMARY KEY, source TEXT NOT NULL, source_id TEXT NOT NULL, kind TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, thread_id TEXT, task_id TEXT, item_id TEXT,
    title TEXT NOT NULL, body TEXT NOT NULL, ref TEXT NOT NULL, url TEXT, changed_at TEXT NOT NULL, state TEXT NOT NULL,
    UNIQUE(source, source_id)
  ) STRICT`,
  `CREATE TABLE board_card_views (
    task_id TEXT PRIMARY KEY NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    view TEXT NOT NULL CHECK (json_valid(view))
  ) STRICT`,
  'CREATE INDEX finder_rows_project ON finder_rows(project_id, changed_at DESC, id DESC)',
  'CREATE INDEX finder_rows_recent ON finder_rows(kind, changed_at DESC, id DESC)',
  `CREATE VIRTUAL TABLE finder_match USING fts5(title, body, ref, content='finder_rows', content_rowid='id', prefix='2 3 4')`,
  `CREATE TRIGGER finder_rows_added AFTER INSERT ON finder_rows BEGIN
    INSERT INTO finder_match(rowid, title, body, ref) VALUES (new.id, new.title, new.body, new.ref);
  END`,
  `CREATE TRIGGER finder_rows_removed AFTER DELETE ON finder_rows BEGIN
    INSERT INTO finder_match(finder_match, rowid, title, body, ref) VALUES ('delete', old.id, old.title, old.body, old.ref);
  END`,
  ...sources.flatMap(([key, table, query]) => [
    `CREATE VIEW finder_${key}_source AS ${query}`,
    ...(['INSERT', 'UPDATE', 'DELETE'] as const).map((event) => {
      const row = event === 'DELETE' ? 'old' : 'new'
      const condition =
        key === 'said' ? ` WHEN ${row}.kind IN ${publicKinds}${event === 'UPDATE' ? ` OR old.kind IN ${publicKinds}` : ''}` : ''
      return `CREATE TRIGGER finder_${key}_${event.toLowerCase()} AFTER ${event} ON ${table}${condition} BEGIN
        ${mark(key, `${row}.id`)}
      END`
    }),
  ]),
  `CREATE TRIGGER finder_input_state AFTER UPDATE OF state ON user_inputs WHEN new.state != old.state BEGIN
    INSERT INTO finder_dirty (source, source_id) SELECT 'said', id FROM thread_items WHERE user_input_id = new.id
      ON CONFLICT(source, source_id) DO NOTHING;
  END`,
  `CREATE TRIGGER finder_task_thread AFTER INSERT ON threads WHEN new.kind = 'task' BEGIN
    ${mark('task', 'new.task_id')}
  END`,
  `CREATE TRIGGER finder_project_name AFTER UPDATE OF name ON projects WHEN new.name != old.name BEGIN
    INSERT INTO finder_dirty (source, source_id) SELECT 'conversation', id FROM threads WHERE project_id = new.id AND kind = 'coordinator'
      ON CONFLICT(source, source_id) DO NOTHING;
  END`,
  `CREATE TRIGGER finder_task_title AFTER UPDATE OF title ON tasks WHEN new.title != old.title BEGIN
    INSERT INTO finder_dirty (source, source_id) SELECT 'link', id FROM external_links WHERE task_id = new.id
      ON CONFLICT(source, source_id) DO NOTHING;
  END`,
]
