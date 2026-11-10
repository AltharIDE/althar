/*
 * A project's canvases (ADR-104): what its agents draw for the person to look
 * at and iterate on, each with a version for every time one was published,
 * kept in the artifact store as a manifest of files by digest. The working
 * copies agents edit in their own folders are recorded, so a copy with edits
 * is never overwritten; and the comments the person sent on them, with who
 * sent them, the version they were made on, and who answered them.
 */
const at = (column: string) =>
  `${column} TEXT NOT NULL CHECK (${column} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')`

export const statements: ReadonlyArray<string> = [
  "INSERT INTO vocab_thread_item_kind (word) VALUES ('canvas')",
  "INSERT INTO vocab_artifact_kind (word) VALUES ('canvas')",
  "INSERT INTO vocab_aggregate_type (word) VALUES ('canvas')",
  `CREATE TABLE canvases (
    id TEXT PRIMARY KEY NOT NULL CHECK (substr(id, 1, 4) = 'cnv_' AND length(id) = 36 AND substr(id, 5) NOT GLOB '*[^0-9a-f]*'),
    project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60 AND name NOT GLOB '*[^a-z0-9-]*'),
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
    kind TEXT NOT NULL CHECK (kind IN ('markdown', 'mermaid', 'svg', 'picture', 'html')),
    group_name TEXT CHECK (group_name IS NULL OR (length(group_name) BETWEEN 1 AND 60 AND group_name NOT GLOB '*[^a-z0-9-]*')),
    created_by_actor_id TEXT NOT NULL REFERENCES actors (id),
    ${at('created_at')},
    archived_at TEXT,
    archived_by_actor_id TEXT REFERENCES actors (id),
    UNIQUE (project_id, name),
    UNIQUE (id, project_id)
  ) STRICT`,
  `CREATE TABLE canvas_versions (
    canvas_id TEXT NOT NULL REFERENCES canvases (id) ON DELETE CASCADE,
    number INTEGER NOT NULL CHECK (number >= 1),
    base INTEGER CHECK (base IS NULL OR (base >= 1 AND base < number)),
    manifest TEXT NOT NULL CHECK (length(manifest) = 64 AND manifest NOT GLOB '*[^0-9a-f]*'),
    entry TEXT NOT NULL,
    entry_sha256 TEXT NOT NULL CHECK (length(entry_sha256) = 64 AND entry_sha256 NOT GLOB '*[^0-9a-f]*'),
    kind TEXT NOT NULL CHECK (kind IN ('markdown', 'mermaid', 'svg', 'picture', 'html')),
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
  `CREATE TABLE canvas_copies (
    folder TEXT NOT NULL,
    path TEXT NOT NULL,
    canvas_id TEXT NOT NULL REFERENCES canvases (id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK (version >= 1),
    manifest TEXT NOT NULL CHECK (length(manifest) = 64 AND manifest NOT GLOB '*[^0-9a-f]*'),
    thread_id TEXT NOT NULL REFERENCES threads (id) ON DELETE CASCADE,
    task_id TEXT REFERENCES tasks (id) ON DELETE SET NULL,
    ${at('updated_at')},
    PRIMARY KEY (folder, path)
  ) STRICT`,
  `CREATE TABLE canvas_comments (
    id TEXT PRIMARY KEY NOT NULL CHECK (substr(id, 1, 4) = 'ccm_' AND length(id) = 36 AND substr(id, 5) NOT GLOB '*[^0-9a-f]*'),
    canvas_id TEXT NOT NULL REFERENCES canvases (id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK (version >= 1),
    anchor TEXT NOT NULL CHECK (json_valid(anchor)),
    body TEXT NOT NULL,
    author_actor_id TEXT NOT NULL REFERENCES actors (id),
    user_input_id TEXT NOT NULL REFERENCES user_inputs (id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL REFERENCES threads (id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 1),
    ${at('created_at')},
    UNIQUE (user_input_id, position)
  ) STRICT`,
  `CREATE TABLE canvas_resolutions (
    comment_id TEXT NOT NULL REFERENCES canvas_comments (id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL CHECK (sequence >= 1),
    resolved INTEGER NOT NULL CHECK (resolved IN (0, 1)),
    by_version INTEGER CHECK (by_version IS NULL OR by_version >= 1),
    note TEXT,
    actor_id TEXT NOT NULL REFERENCES actors (id),
    session_id TEXT,
    ${at('created_at')},
    PRIMARY KEY (comment_id, sequence)
  ) STRICT`,
  'CREATE INDEX canvases_by_project ON canvases (project_id, archived_at)',
  'CREATE INDEX canvas_copies_by_canvas ON canvas_copies (canvas_id)',
  'CREATE INDEX canvas_comments_by_canvas ON canvas_comments (canvas_id, version)',
]
