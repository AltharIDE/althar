import { at, gitObject, id, index, json, project, ref, referencedInProject, revision, sameProject, scoped, table, word } from './columns'

/** What a task changed, the work queued to change things outside Althar, and what was observed. */
export const effects: ReadonlyArray<string> = [
  table(
    'change_sets',
    [id('chg'), project(), scoped('task_id'), scoped('run_id'), word('state', 'change_set_state'), at('created_at'), revision],
    [sameProject('task_id', 'tasks'), sameProject('run_id', 'runs'), referencedInProject],
  ),

  table(
    'repository_changes',
    [
      id('rchg'),
      project(),
      scoped('change_set_id'),
      scoped('binding_id'),
      scoped('workspace_id', { nullable: true }),
      gitObject('base_commit', { nullable: true }),
      gitObject('head_commit', { nullable: true }),
      'branch TEXT NOT NULL',
      scoped('patch_artifact_id', { nullable: true }),
      'pull_request_url TEXT',
      word('pull_request_state', 'pull_request_state', { default: 'none' }),
      at('created_at'),
      at('updated_at'),
      revision,
    ],
    [
      'UNIQUE (change_set_id, binding_id)',
      sameProject('change_set_id', 'change_sets'),
      sameProject('binding_id', 'repository_bindings'),
      sameProject('workspace_id', 'workspaces'),
      sameProject('patch_artifact_id', 'artifacts'),
    ],
  ),

  /*
   * The outbox: an effect outside the database is committed here as intent
   * first, then done by a worker after commit. A claim names the runtime
   * instance that holds it and until when, so a restart, and later several
   * workers, can tell a live claim from an abandoned one.
   */
  table(
    'work_items',
    [
      id('work'),
      project({ nullable: true }),
      'kind TEXT NOT NULL',
      'subject_type TEXT NOT NULL',
      'subject_id TEXT NOT NULL',
      json('payload', { empty: '{}' }),
      word('state', 'work_item_state'),
      scoped('run_attempt_id', { nullable: true }),
      'controller_generation INTEGER CHECK (controller_generation >= 1)',
      ref('claimed_by_instance_id', 'runtime_instances', { nullable: true }),
      at('lease_expires_at', { nullable: true }),
      'attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0)',
      at('available_at'),
      'last_error TEXT',
      at('created_at'),
      at('updated_at'),
      revision,
    ],
    [
      "CHECK ((state = 'claimed') = (claimed_by_instance_id IS NOT NULL AND lease_expires_at IS NOT NULL))",
      'CHECK (run_attempt_id IS NULL OR project_id IS NOT NULL)',
      sameProject('run_attempt_id', 'run_attempts'),
    ],
  ),

  table('mutation_receipts', [
    id('mut'),
    project({ nullable: true }),
    ref('work_item_id', 'work_items'),
    'target TEXT NOT NULL',
    'operation TEXT NOT NULL',
    'idempotency_key TEXT',
    word('state', 'mutation_state'),
    json('request', { empty: '{}' }),
    json('response', { nullable: true }),
    at('created_at'),
    at('confirmed_at', { nullable: true }),
    revision,
  ]),

  table('observations', [
    id('obs'),
    project({ nullable: true }),
    'subject_type TEXT NOT NULL',
    'subject_id TEXT NOT NULL',
    'kind TEXT NOT NULL',
    json('payload', { empty: '{}' }),
    'source TEXT NOT NULL',
    at('observed_at'),
  ]),

  index('change_sets_by_task', 'change_sets (task_id)'),
  index('work_items_ready', 'work_items (available_at)', { where: "state = 'pending'" }),
  index('work_items_claimed', 'work_items (lease_expires_at)', { where: "state = 'claimed'" }),
  index('mutation_receipts_by_work_item', 'mutation_receipts (work_item_id)'),
  index('observations_by_subject', 'observations (subject_type, subject_id, observed_at)'),
]
