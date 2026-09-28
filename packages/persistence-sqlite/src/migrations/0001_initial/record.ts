import { at, index, json, oneOf, ref, table } from './columns'

const aggregates = [
  'project',
  'task',
  'task_plan',
  'run',
  'workflow_execution',
  'node',
  'node_attempt',
  'thread',
  'provider_session',
  'permission_request',
  'attention_request',
  'change_set',
  'agent_installation',
  'account_status',
]

/**
 * The operational record, the client change feed, and command receipts
 * (docs/architecture/07). They are kept apart: the record is what people may
 * inspect, the feed only tells clients what to refresh, and receipts make a
 * retried command return its first result.
 */
export const record: ReadonlyArray<string> = [
  table('record_events', [
    'sequence INTEGER PRIMARY KEY AUTOINCREMENT',
    "id TEXT NOT NULL UNIQUE CHECK (substr(id, 1, 4) = 'evt_' AND length(id) = 36)",
    oneOf('aggregate_type', aggregates),
    'aggregate_id TEXT NOT NULL',
    'aggregate_revision INTEGER NOT NULL CHECK (aggregate_revision >= 1)',
    "type TEXT NOT NULL CHECK (type GLOB '[a-z]*.[a-z]*' AND type NOT GLOB '*[^a-z_.]*')",
    json('payload', { empty: '{}' }),
    ref('actor_id', 'actors'),
    "command_id TEXT CHECK (substr(command_id, 1, 4) = 'cmd_')",
    at('occurred_at'),
  ]),

  table('change_log', [
    'cursor INTEGER PRIMARY KEY AUTOINCREMENT',
    oneOf('aggregate_type', aggregates),
    'aggregate_id TEXT NOT NULL',
    'revision INTEGER NOT NULL CHECK (revision >= 1)',
    at('changed_at'),
  ]),

  table('command_receipts', [
    "command_id TEXT PRIMARY KEY NOT NULL CHECK (substr(command_id, 1, 4) = 'cmd_' AND length(command_id) = 36)",
    'command_type TEXT NOT NULL',
    'schema_version INTEGER NOT NULL CHECK (schema_version >= 1)',
    "payload_digest TEXT NOT NULL CHECK (length(payload_digest) = 64 AND payload_digest NOT GLOB '*[^0-9a-f]*')",
    ref('actor_id', 'actors'),
    ref('device_id', 'devices'),
    'aggregate_id TEXT',
    json('result'),
    at('received_at'),
    at('completed_at'),
  ]),

  index('record_events_by_aggregate', 'record_events (aggregate_type, aggregate_id, sequence)'),
]
