/*
 * Where an agent's sandbox may leave a placeholder that wasn't there before its
 * process started (DEV-286, sandboxLeftovers.ts): a row a path and process,
 * recorded before the process starts, settled and removed once it has ended.
 */
export const statements: ReadonlyArray<string> = [
  `CREATE TABLE sandbox_places (
    path TEXT NOT NULL,
    process_id TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
    PRIMARY KEY (path, process_id)
  ) STRICT`,
  'CREATE INDEX sandbox_places_by_process ON sandbox_places (process_id)',
]
