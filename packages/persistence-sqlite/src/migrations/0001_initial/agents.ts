import { at, gitObject, id, index, json, project, ref, referencedInProject, revision, sameProject, scoped, table, word } from './columns'

/** Agents on this device and who they are signed in as; sessions, processes and node attempts; what code each attempt saw. */
export const agents: ReadonlyArray<string> = [
  table('agent_installations', [
    id('inst'),
    ref('device_id', 'devices'),
    'agent_id TEXT NOT NULL',
    'agent_version TEXT',
    'adapter_version TEXT',
    'protocol_version INTEGER',
    word('status', 'installation_status'),
    json('capabilities', { empty: '{}' }),
    at('probed_at'),
    revision,
  ]),

  table('principals', [
    id('prin'),
    'agent_id TEXT NOT NULL',
    ref('device_id', 'devices'),
    'subject_hint TEXT NOT NULL',
    word('auth_mode', 'auth_mode'),
    at('observed_at'),
  ]),

  table('account_statuses', [
    id('acct'),
    ref('principal_id', 'principals'),
    word('state', 'account_state'),
    json('windows', { empty: '[]' }),
    word('source', 'account_status_source'),
    at('observed_at'),
  ]),

  /*
   * A session with an agent. `config` records how it was started: the mode
   * (such as plan mode or a read-only sandbox), and the MCP servers and tools
   * it was given, which differ by role.
   */
  table(
    'provider_sessions',
    [
      id('sess'),
      project(),
      scoped('thread_id'),
      'agent_id TEXT NOT NULL',
      'model TEXT',
      'effort TEXT',
      json('config', { empty: '{}' }),
      ref('principal_id', 'principals', { nullable: true }),
      ref('installation_id', 'agent_installations', { nullable: true }),
      'external_session_id TEXT',
      scoped('run_attempt_id', { nullable: true }),
      'controller_generation INTEGER CHECK (controller_generation >= 1)',
      scoped('brief_artifact_id', { nullable: true }),
      word('state', 'provider_session_state'),
      scoped('superseded_by_session_id', { nullable: true }),
      'last_event_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_event_sequence >= 0)',
      at('started_at'),
      at('ended_at', { nullable: true }),
      revision,
    ],
    [
      "CHECK ((state = 'superseded') = (superseded_by_session_id IS NOT NULL))",
      sameProject('thread_id', 'threads'),
      sameProject('run_attempt_id', 'run_attempts'),
      sameProject('brief_artifact_id', 'artifacts'),
      sameProject('superseded_by_session_id', 'provider_sessions'),
      referencedInProject,
    ],
  ),

  /*
   * Every process Althar starts. The row is written as `launching` before
   * the spawn, so a crash in between still leaves something to reconcile, and
   * the OS start time guards against a reused pid.
   */
  table(
    'processes',
    [
      id('proc'),
      project({ nullable: true }),
      ref('device_id', 'devices'),
      ref('runtime_instance_id', 'runtime_instances'),
      scoped('provider_session_id', { nullable: true }),
      scoped('run_attempt_id', { nullable: true }),
      scoped('node_attempt_id', { nullable: true }),
      word('purpose', 'process_purpose'),
      'executable TEXT NOT NULL',
      'executable_version TEXT',
      'pid INTEGER CHECK (pid > 0)',
      'process_group_id INTEGER CHECK (process_group_id > 0)',
      at('os_started_at', { nullable: true }),
      json('args_redacted', { empty: '[]' }),
      'environment_digest TEXT',
      'controller_generation INTEGER CHECK (controller_generation >= 1)',
      word('state', 'process_state'),
      at('launched_at'),
      at('ended_at', { nullable: true }),
      'exit_code INTEGER',
      'signal TEXT',
      revision,
    ],
    [
      "CHECK (state = 'launching' OR pid IS NOT NULL)",
      'CHECK ((provider_session_id IS NULL AND run_attempt_id IS NULL AND node_attempt_id IS NULL) OR project_id IS NOT NULL)',
      sameProject('provider_session_id', 'provider_sessions'),
      sameProject('run_attempt_id', 'run_attempts'),
      sameProject('node_attempt_id', 'node_attempts'),
    ],
  ),

  /* At most one attempt of a node is unfinished. A `held` attempt says why it waits. */
  table(
    'node_attempts',
    [
      id('natt'),
      project(),
      scoped('node_id'),
      'attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1)',
      scoped('run_attempt_id'),
      'controller_generation INTEGER NOT NULL CHECK (controller_generation >= 1)',
      scoped('provider_session_id', { nullable: true }),
      word('state', 'node_attempt_state'),
      word('hold_reason', 'hold_reason', { nullable: true }),
      json('input', { empty: '{}' }),
      json('output', { nullable: true }),
      scoped('output_artifact_id', { nullable: true }),
      'error_class TEXT',
      at('admitted_at'),
      at('started_at', { nullable: true }),
      at('ended_at', { nullable: true }),
      revision,
    ],
    [
      'UNIQUE (node_id, attempt_number)',
      "CHECK ((state = 'held') = (hold_reason IS NOT NULL))",
      sameProject('node_id', 'nodes'),
      sameProject('run_attempt_id', 'run_attempts'),
      sameProject('provider_session_id', 'provider_sessions'),
      sameProject('output_artifact_id', 'artifacts'),
      referencedInProject,
    ],
  ),

  /*
   * Which code a workspace held, and when: at the start and end of each node,
   * at a switch and at an interrupt. Althar owns the worktree, so it can
   * commit or write a tree there to take one.
   */
  table(
    'workspace_snapshots',
    [
      id('snap'),
      project(),
      scoped('workspace_id'),
      scoped('node_attempt_id', { nullable: true }),
      gitObject('commit_sha', { nullable: true }),
      gitObject('tree_sha', { nullable: true }),
      word('reason', 'snapshot_reason'),
      at('taken_at'),
    ],
    [
      'CHECK (commit_sha IS NOT NULL OR tree_sha IS NOT NULL)',
      sameProject('workspace_id', 'workspaces'),
      sameProject('node_attempt_id', 'node_attempts'),
    ],
  ),

  index('account_statuses_by_principal', 'account_statuses (principal_id, observed_at)'),
  index('provider_sessions_by_thread', 'provider_sessions (thread_id)'),
  index('provider_sessions_by_run_attempt', 'provider_sessions (run_attempt_id)'),
  index('processes_by_session', 'processes (provider_session_id)'),
  index('processes_live', 'processes (runtime_instance_id)', { where: "state IN ('launching', 'running')" }),
  index('one_unfinished_attempt_per_node', 'node_attempts (node_id)', {
    unique: true,
    where: "state NOT IN ('succeeded', 'failed', 'cancelled', 'superseded')",
  }),
  index('node_attempts_by_session', 'node_attempts (provider_session_id)'),
  index('node_attempts_by_run_attempt', 'node_attempts (run_attempt_id)'),
  index('workspace_snapshots_by_workspace', 'workspace_snapshots (workspace_id, taken_at)'),
  index('workspace_snapshots_by_attempt', 'workspace_snapshots (node_attempt_id)'),
]
