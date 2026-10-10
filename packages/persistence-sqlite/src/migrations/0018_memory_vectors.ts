/** Rebuildable local semantic index; model and source revisions are explicit. */
export const statements: ReadonlyArray<string> = [
  `CREATE TABLE project_memory_vectors (
    id TEXT PRIMARY KEY NOT NULL REFERENCES project_memory(id),
    source_revision INTEGER NOT NULL CHECK(source_revision >= 1),
    model TEXT NOT NULL,
    vectors TEXT NOT NULL CHECK(json_valid(vectors)),
    truncated INTEGER NOT NULL CHECK(truncated IN (0,1))
  ) STRICT`,
]
