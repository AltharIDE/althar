/* Where a project saves its canvases, and each canvas's requested and last published places. */
export const statements: ReadonlyArray<string> = [
  `CREATE TABLE artifacts_homes (
    project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    repository_id TEXT NOT NULL,
    folder TEXT NOT NULL,
    how TEXT NOT NULL CHECK (how IN ('pr', 'main')),
    follow INTEGER NOT NULL CHECK (follow IN (0, 1)),
    FOREIGN KEY (repository_id, project_id) REFERENCES repository_bindings (id, project_id) ON DELETE CASCADE
  ) STRICT`,
  `CREATE TABLE canvas_saves (
    canvas_id TEXT PRIMARY KEY NOT NULL REFERENCES canvases (id) ON DELETE CASCADE,
    repository_id TEXT NOT NULL REFERENCES repository_bindings (id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    how TEXT NOT NULL CHECK (how IN ('pr', 'main')),
    follow INTEGER NOT NULL CHECK (follow IN (0, 1)),
    tracking TEXT NOT NULL,
    request TEXT NOT NULL,
    next_version INTEGER NOT NULL CHECK (next_version >= 1),
    through_version INTEGER NOT NULL CHECK (through_version >= 1),
    published TEXT CHECK (published IS NULL OR json_valid(published)),
    state TEXT NOT NULL CHECK (state IN ('saving', 'saved', 'failed')),
    problem TEXT
  ) STRICT`,
]
