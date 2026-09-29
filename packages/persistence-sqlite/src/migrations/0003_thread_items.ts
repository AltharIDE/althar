/*
 * Thread items join the change feed as their own aggregate, so a client
 * refetches the one item that changed, such as a tool call finishing.
 *
 * A tool call's id is unique within the agent session that made it, not
 * within the thread: a thread outlives its sessions when the agent is
 * switched, and two agents may use the same ids.
 *
 * A process recorded as launching may never get a pid: the launch failed, or
 * the runtime stopped before it. Its state is then `unknown`, which the
 * processes table now allows without a pid. SQLite can't change a CHECK in
 * place, so the table is rebuilt (its documented procedure; foreign keys are
 * off while migrations run, and checked after).
 */
export const statements: ReadonlyArray<string> = [
  "INSERT INTO vocab_aggregate_type (word) VALUES ('thread_item')",
  'DROP INDEX one_item_per_tool_call',
  'CREATE UNIQUE INDEX one_item_per_tool_call ON thread_items (provider_session_id, tool_call_id) WHERE tool_call_id IS NOT NULL',
  `CREATE TABLE processes_new (
  id TEXT PRIMARY KEY NOT NULL CHECK (substr(id, 1, 5) = 'proc_' AND length(id) = 37 AND substr(id, 6) NOT GLOB '*[^0-9a-f]*'),
  project_id TEXT REFERENCES projects (id),
  device_id TEXT NOT NULL REFERENCES devices (id),
  runtime_instance_id TEXT NOT NULL REFERENCES runtime_instances (id),
  provider_session_id TEXT,
  run_attempt_id TEXT,
  node_attempt_id TEXT,
  purpose TEXT NOT NULL REFERENCES vocab_process_purpose (word),
  executable TEXT NOT NULL,
  executable_version TEXT,
  pid INTEGER CHECK (pid > 0),
  process_group_id INTEGER CHECK (process_group_id > 0),
  os_started_at TEXT CHECK (os_started_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  args_redacted TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(args_redacted)),
  environment_digest TEXT,
  controller_generation INTEGER CHECK (controller_generation >= 1),
  state TEXT NOT NULL REFERENCES vocab_process_state (word),
  launched_at TEXT NOT NULL CHECK (launched_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  ended_at TEXT CHECK (ended_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  exit_code INTEGER,
  signal TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  CHECK (state IN ('launching', 'unknown') OR pid IS NOT NULL),
  CHECK ((provider_session_id IS NULL AND run_attempt_id IS NULL AND node_attempt_id IS NULL) OR project_id IS NOT NULL),
  FOREIGN KEY (provider_session_id, project_id) REFERENCES provider_sessions (id, project_id),
  FOREIGN KEY (run_attempt_id, project_id) REFERENCES run_attempts (id, project_id),
  FOREIGN KEY (node_attempt_id, project_id) REFERENCES node_attempts (id, project_id)
) STRICT`,
  'INSERT INTO processes_new SELECT * FROM processes',
  'DROP TABLE processes',
  'ALTER TABLE processes_new RENAME TO processes',
  'CREATE INDEX processes_by_session ON processes (provider_session_id)',
  "CREATE INDEX processes_live ON processes (runtime_instance_id) WHERE state IN ('launching', 'running')",
]
