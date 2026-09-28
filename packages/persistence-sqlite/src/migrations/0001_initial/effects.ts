import { at, id, index, json, oneOf, ref, revision, table } from './columns'

/** What a task changed, the work queued to change things outside Charrette, and what was observed. */
export const effects: ReadonlyArray<string> = [
  table('change_sets', [
    id('chg'),
    ref('task_id', 'tasks'),
    ref('run_id', 'runs'),
    oneOf('state', ['open', 'published', 'abandoned']),
    at('created_at'),
    revision,
  ]),

  table('repository_changes', [
    id('rchg'),
    ref('change_set_id', 'change_sets'),
    ref('binding_id', 'repository_bindings'),
    ref('workspace_id', 'workspaces', { nullable: true }),
    'base_commit TEXT',
    'head_commit TEXT',
    'branch TEXT NOT NULL',
    ref('patch_artifact_id', 'artifacts', { nullable: true }),
    'pull_request_url TEXT',
    oneOf('pull_request_state', ['none', 'draft', 'ready', 'merged', 'closed'], { default: 'none' }),
    at('created_at'),
    at('updated_at'),
    'UNIQUE (change_set_id, binding_id)',
  ]),

  /* The outbox: an effect outside the database is committed here as intent first, then done by a worker. */
  table('work_items', [
    id('work'),
    'kind TEXT NOT NULL',
    'subject_type TEXT NOT NULL',
    'subject_id TEXT NOT NULL',
    json('payload', { empty: '{}' }),
    oneOf('state', ['pending', 'claimed', 'done', 'failed', 'uncertain']),
    ref('run_attempt_id', 'run_attempts', { nullable: true }),
    'controller_generation INTEGER CHECK (controller_generation >= 1)',
    'attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0)',
    at('available_at'),
    'last_error TEXT',
    at('created_at'),
    at('updated_at'),
  ]),

  table('mutation_receipts', [
    id('mut'),
    ref('work_item_id', 'work_items'),
    'target TEXT NOT NULL',
    'operation TEXT NOT NULL',
    'idempotency_key TEXT',
    oneOf('state', ['intended', 'confirmed', 'failed', 'uncertain']),
    json('request', { empty: '{}' }),
    json('response', { nullable: true }),
    at('created_at'),
    at('confirmed_at', { nullable: true }),
  ]),

  table('observations', [
    id('obs'),
    'subject_type TEXT NOT NULL',
    'subject_id TEXT NOT NULL',
    'kind TEXT NOT NULL',
    json('payload', { empty: '{}' }),
    'source TEXT NOT NULL',
    at('observed_at'),
  ]),

  index('change_sets_by_task', 'change_sets (task_id)'),
  index('work_items_ready', 'work_items (available_at)', { where: "state = 'pending'" }),
  index('mutation_receipts_by_work_item', 'mutation_receipts (work_item_id)'),
  index('observations_by_subject', 'observations (subject_type, subject_id, observed_at)'),
]
