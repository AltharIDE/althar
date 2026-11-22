/*
 * A canvas of boards (ADR-104): designs laid side by side on pages, each
 * board a page or a picture of the canvas at the size its agent gave it,
 * drawn from its entry, `canvas.json`. It is a kind of its own, `boards`,
 * beside documents, diagrams, drawings, pictures and pages. SQLite can't
 * change a CHECK in place, so the canvases and their versions are rebuilt
 * (its documented procedure; foreign keys are off while migrations run, and
 * checked after), every row kept as it was.
 */
const at = (column: string) =>
  `${column} TEXT NOT NULL CHECK (${column} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')`

const KINDS = "('markdown', 'mermaid', 'svg', 'picture', 'html', 'boards')"

export const statements: ReadonlyArray<string> = [
  `CREATE TABLE canvases_new (
    id TEXT PRIMARY KEY NOT NULL CHECK (substr(id, 1, 4) = 'cnv_' AND length(id) = 36 AND substr(id, 5) NOT GLOB '*[^0-9a-f]*'),
    project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60 AND name NOT GLOB '*[^a-z0-9-]*'),
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
    kind TEXT NOT NULL CHECK (kind IN ${KINDS}),
    group_name TEXT CHECK (group_name IS NULL OR (length(group_name) BETWEEN 1 AND 60 AND group_name NOT GLOB '*[^a-z0-9-]*')),
    created_by_actor_id TEXT NOT NULL REFERENCES actors (id),
    ${at('created_at')},
    archived_at TEXT,
    archived_by_actor_id TEXT REFERENCES actors (id),
    UNIQUE (project_id, name),
    UNIQUE (id, project_id)
  ) STRICT`,
  `INSERT INTO canvases_new (id, project_id, name, title, kind, group_name, created_by_actor_id, created_at, archived_at, archived_by_actor_id)
    SELECT id, project_id, name, title, kind, group_name, created_by_actor_id, created_at, archived_at, archived_by_actor_id FROM canvases`,
  'DROP TABLE canvases',
  'ALTER TABLE canvases_new RENAME TO canvases',
  'CREATE INDEX canvases_by_project ON canvases (project_id, archived_at)',
  `CREATE TABLE canvas_versions_new (
    canvas_id TEXT NOT NULL REFERENCES canvases (id) ON DELETE CASCADE,
    number INTEGER NOT NULL CHECK (number >= 1),
    base INTEGER CHECK (base IS NULL OR (base >= 1 AND base < number)),
    manifest TEXT NOT NULL CHECK (length(manifest) = 64 AND manifest NOT GLOB '*[^0-9a-f]*'),
    entry TEXT NOT NULL,
    entry_sha256 TEXT NOT NULL CHECK (length(entry_sha256) = 64 AND entry_sha256 NOT GLOB '*[^0-9a-f]*'),
    kind TEXT NOT NULL CHECK (kind IN ${KINDS}),
    title TEXT NOT NULL,
    note TEXT,
    files INTEGER NOT NULL CHECK (files >= 1),
    bytes INTEGER NOT NULL CHECK (bytes >= 0),
    actor_id TEXT NOT NULL REFERENCES actors (id),
    thread_id TEXT NOT NULL REFERENCES threads (id) ON DELETE CASCADE,
    task_id TEXT REFERENCES tasks (id) ON DELETE SET NULL,
    session_id TEXT,
    ${at('created_at')},
    PRIMARY KEY (canvas_id, number)
  ) STRICT`,
  `INSERT INTO canvas_versions_new (canvas_id, number, base, manifest, entry, entry_sha256, kind, title, note, files, bytes, actor_id, thread_id, task_id, session_id, created_at)
    SELECT canvas_id, number, base, manifest, entry, entry_sha256, kind, title, note, files, bytes, actor_id, thread_id, task_id, session_id, created_at FROM canvas_versions`,
  'DROP TABLE canvas_versions',
  'ALTER TABLE canvas_versions_new RENAME TO canvas_versions',
]
