/*
 * ADR-081: the open pull requests of a project's repositories that no task
 * follows, kept for news only. What was last read of each (its state, head
 * and checks) is what the next read is compared with, so a restart tells
 * nothing twice and a rerun at the same head still comes as news. It keeps
 * no title and no words of anyone's: only facts.
 */
export const statements: ReadonlyArray<string> = [
  "INSERT INTO vocab_aggregate_type (word) VALUES ('followed_pull')",
  `CREATE TABLE followed_pulls (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id),
    connection_id TEXT NOT NULL REFERENCES connections(id),
    product TEXT NOT NULL REFERENCES vocab_connection_product(word),
    repository TEXT NOT NULL,
    number INTEGER NOT NULL CHECK (number >= 1),
    url TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('open', 'merged', 'closed')),
    head_sha TEXT,
    from_fork INTEGER NOT NULL DEFAULT 0 CHECK (from_fork IN (0, 1)),
    -- Open before Althar first looked at its repository: its first checks are read without news.
    baseline INTEGER NOT NULL DEFAULT 0 CHECK (baseline IN (0, 1)),
    checks_sha TEXT,
    checks_outcome TEXT CHECK (checks_outcome IN ('passed', 'failed', 'running')),
    checks_revision INTEGER NOT NULL DEFAULT 0 CHECK (checks_revision >= 0),
    failed_at TEXT,
    checks_read_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    UNIQUE (project_id, connection_id, repository, number)
  ) STRICT`,
  'CREATE INDEX followed_pulls_open ON followed_pulls(project_id, state)',
]
