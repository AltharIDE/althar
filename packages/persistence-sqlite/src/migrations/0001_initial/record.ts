import { at, idCheck, index, json, project, ref, table, word } from './columns'

/**
 * The operational record, the client change feed, and command receipts
 * (docs/architecture/07). They are kept apart: the record is what people may
 * inspect, the feed only tells clients what to refresh, and receipts make a
 * retried command return its first result. The record and the feed carry the
 * project, which is the partition and export boundary in the cloud; rows about
 * a device, such as an agent installation, have none.
 */
export const record: ReadonlyArray<string> = [
  table('record_events', [
    'sequence INTEGER PRIMARY KEY AUTOINCREMENT',
    `id TEXT NOT NULL UNIQUE CHECK (${idCheck('id', 'evt')})`,
    project({ nullable: true }),
    word('aggregate_type', 'aggregate_type'),
    'aggregate_id TEXT NOT NULL',
    'aggregate_revision INTEGER NOT NULL CHECK (aggregate_revision >= 1)',
    "type TEXT NOT NULL CHECK (type GLOB '[a-z]*.[a-z]*' AND type NOT GLOB '*[^a-z_.]*')",
    'schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version >= 1)',
    json('payload', { empty: '{}' }),
    ref('actor_id', 'actors'),
    `command_id TEXT CHECK (${idCheck('command_id', 'cmd')})`,
    at('occurred_at'),
  ]),

  table('change_log', [
    'cursor INTEGER PRIMARY KEY AUTOINCREMENT',
    project({ nullable: true }),
    word('aggregate_type', 'aggregate_type'),
    'aggregate_id TEXT NOT NULL',
    'aggregate_revision INTEGER NOT NULL CHECK (aggregate_revision >= 1)',
    at('changed_at'),
  ]),

  /*
   * Receipts are keyed by actor and command id, so one actor can never read
   * another's result by replaying its id. A command an agent issues for a
   * person records both.
   */
  table(
    'command_receipts',
    [
      ref('actor_id', 'actors'),
      `command_id TEXT NOT NULL CHECK (${idCheck('command_id', 'cmd')})`,
      ref('on_behalf_of_actor_id', 'actors', { nullable: true }),
      'command_type TEXT NOT NULL',
      'schema_version INTEGER NOT NULL CHECK (schema_version >= 1)',
      "payload_digest TEXT NOT NULL CHECK (length(payload_digest) = 64 AND payload_digest NOT GLOB '*[^0-9a-f]*')",
      ref('device_id', 'devices'),
      project({ nullable: true }),
      'aggregate_id TEXT',
      json('result'),
      at('received_at'),
      at('completed_at'),
    ],
    ['PRIMARY KEY (actor_id, command_id)'],
  ),

  index('record_events_by_aggregate', 'record_events (aggregate_type, aggregate_id, sequence)'),
  index('record_events_by_project', 'record_events (project_id, sequence)'),
  index('change_log_by_project', 'change_log (project_id, cursor)'),
]
