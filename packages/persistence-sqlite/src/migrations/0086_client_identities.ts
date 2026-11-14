/** Stable home identity, revocable client keys, and durable API command admission. */
const timestamp = "'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'"
export const statements = [
  `ALTER TABLE change_log ADD COLUMN checkpoint TEXT CHECK (checkpoint IS NULL OR (length(checkpoint) = 32 AND checkpoint NOT GLOB '*[^0-9a-f]*'))`,
  `UPDATE change_log SET checkpoint = lower(hex(randomblob(16)))`,
  `CREATE UNIQUE INDEX change_log_checkpoints ON change_log(checkpoint)`,
  `CREATE TRIGGER change_log_checkpoint AFTER INSERT ON change_log WHEN NEW.checkpoint IS NULL
    BEGIN UPDATE change_log SET checkpoint = lower(hex(randomblob(16))) WHERE cursor = NEW.cursor; END`,
  `CREATE TABLE runtime_homes (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    id TEXT NOT NULL UNIQUE CHECK (substr(id, 1, 5) = 'home_' AND length(id) = 37 AND substr(id, 6) NOT GLOB '*[^0-9a-f]*'),
    device_id TEXT NOT NULL REFERENCES devices(id),
    person_id TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL CHECK (created_at GLOB ${timestamp})
  ) STRICT`,
  `CREATE TABLE client_devices (
    device_id TEXT PRIMARY KEY REFERENCES devices(id),
    actor_id TEXT NOT NULL REFERENCES actors(id),
    public_key TEXT NOT NULL UNIQUE CHECK (length(public_key) = 43),
    role TEXT NOT NULL CHECK (role IN ('paired_device', 'socket')),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    created_at TEXT NOT NULL CHECK (created_at GLOB ${timestamp}),
    revoked_at TEXT CHECK (revoked_at GLOB ${timestamp})
  ) STRICT`,
  `CREATE INDEX client_devices_by_actor ON client_devices(actor_id, device_id)`,
  `CREATE INDEX client_devices_active ON client_devices(device_id) WHERE revoked_at IS NULL`,
  `CREATE TABLE api_commands (
    actor_id TEXT NOT NULL REFERENCES actors(id),
    command_id TEXT NOT NULL CHECK (substr(command_id, 1, 4) = 'cmd_' AND length(command_id) = 36 AND substr(command_id, 5) NOT GLOB '*[^0-9a-f]*'),
    home_id TEXT NOT NULL REFERENCES runtime_homes(id),
    device_id TEXT NOT NULL REFERENCES devices(id),
    role TEXT NOT NULL CHECK (role IN ('window', 'paired_device', 'socket', 'internal')),
    method TEXT NOT NULL,
    request_digest TEXT NOT NULL CHECK (length(request_digest) = 64 AND request_digest NOT GLOB '*[^0-9a-f]*'),
    runtime_instance_id TEXT NOT NULL REFERENCES runtime_instances(id),
    state TEXT NOT NULL CHECK (state IN ('pending', 'succeeded', 'failed', 'uncertain')),
    result TEXT CHECK (result IS NULL OR json_valid(result)),
    error TEXT CHECK (error IS NULL OR json_valid(error)),
    received_at TEXT NOT NULL CHECK (received_at GLOB ${timestamp}),
    completed_at TEXT CHECK (completed_at GLOB ${timestamp}),
    PRIMARY KEY(actor_id, command_id),
    CHECK ((state = 'succeeded') = (result IS NOT NULL)),
    CHECK ((state IN ('failed', 'uncertain')) = (error IS NOT NULL)),
    CHECK ((state = 'pending') = (completed_at IS NULL))
  ) STRICT`,
  `CREATE INDEX api_commands_pending ON api_commands(runtime_instance_id) WHERE state = 'pending'`,
]
