export const statements: ReadonlyArray<string> = [
  "ALTER TABLE tasks ADD COLUMN execution_worker_id TEXT CHECK (substr(execution_worker_id, 1, 4) = 'wrk_' AND length(execution_worker_id) = 36 AND substr(execution_worker_id, 5) NOT GLOB '*[^0-9a-f]*')",
]
