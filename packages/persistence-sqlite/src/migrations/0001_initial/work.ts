import {
  at,
  flag,
  gitObject,
  id,
  index,
  json,
  project,
  ref,
  referencedInProject,
  revision,
  sameProject,
  scoped,
  sha256,
  table,
  word,
} from './columns'

/** Tasks, plans and runs; workspaces and what code they held; workflow definitions and executions. */
export const work: ReadonlyArray<string> = [
  table(
    'tasks',
    [
      id('task'),
      project(),
      'title TEXT NOT NULL',
      "description TEXT NOT NULL DEFAULT ''",
      "slug TEXT NOT NULL CHECK (slug <> '' AND slug NOT GLOB '*[^a-z0-9-]*')",
      word('state', 'task_state'),
      ref('created_by_actor_id', 'actors'),
      at('created_at'),
      at('settled_at', { nullable: true }),
      revision,
    ],
    ['UNIQUE (project_id, slug)', referencedInProject],
  ),

  /* What a task may use. Editable until a run starts; each run keeps its own copy. */
  table(
    'task_repository_requirements',
    [
      id('req'),
      project(),
      scoped('task_id'),
      scoped('binding_id'),
      word('access', 'repository_access'),
      json('allowed_roots', { empty: '[]' }),
      'base_ref TEXT',
      flag('required', 1),
      revision,
    ],
    ['UNIQUE (task_id, binding_id)', sameProject('task_id', 'tasks'), sameProject('binding_id', 'repository_bindings')],
  ),

  /* Workflow definitions ship with Althar and belong to no project. */
  table('workflow_definitions', [id('wdef'), 'name TEXT NOT NULL UNIQUE', at('created_at'), at('retired_at', { nullable: true })]),

  table(
    'workflow_versions',
    [
      id('wver'),
      ref('definition_id', 'workflow_definitions'),
      'version INTEGER NOT NULL CHECK (version >= 1)',
      sha256('content_hash'),
      json('definition'),
      at('created_at'),
    ],
    ['UNIQUE (definition_id, version)'],
  ),

  table(
    'task_plans',
    [
      id('plan'),
      project(),
      scoped('task_id'),
      ref('workflow_version_id', 'workflow_versions'),
      json('parameters', { empty: '{}' }),
      ref('proposed_by_actor_id', 'actors'),
      word('state', 'plan_state'),
      at('proposed_at'),
      at('starts_at', { nullable: true }),
      at('decided_at', { nullable: true }),
      revision,
    ],
    [sameProject('task_id', 'tasks'), referencedInProject],
  ),

  table(
    'runs',
    [
      id('run'),
      project(),
      scoped('task_id'),
      scoped('plan_id', { nullable: true }),
      ref('workflow_version_id', 'workflow_versions'),
      scoped('policy_id'),
      json('parameters', { empty: '{}' }),
      json('budget', { empty: '{}' }),
      word('state', 'run_state'),
      'end_reason TEXT',
      at('created_at'),
      at('ended_at', { nullable: true }),
      revision,
    ],
    [sameProject('task_id', 'tasks'), sameProject('plan_id', 'task_plans'), sameProject('policy_id', 'policies'), referencedInProject],
  ),

  /* The task's requirements as they stood when the run was admitted. */
  table(
    'run_repository_requirements',
    [
      project(),
      scoped('run_id'),
      scoped('binding_id'),
      word('access', 'repository_access'),
      json('allowed_roots', { empty: '[]' }),
      'base_ref TEXT',
      flag('required', 1),
    ],
    ['PRIMARY KEY (run_id, binding_id)', sameProject('run_id', 'runs'), sameProject('binding_id', 'repository_bindings')],
  ),

  /*
   * One run attempt at a time is active. It runs on one device, and its
   * controller is the runtime instance holding the current generation; on
   * restart, an attempt whose instance has ended has lost its controller.
   */
  table(
    'run_attempts',
    [
      id('ratt'),
      project(),
      scoped('run_id'),
      'attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1)',
      ref('device_id', 'devices'),
      'controller_generation INTEGER NOT NULL DEFAULT 1 CHECK (controller_generation >= 1)',
      ref('controller_instance_id', 'runtime_instances'),
      word('state', 'run_attempt_state'),
      at('started_at'),
      at('ended_at', { nullable: true }),
      revision,
    ],
    ['UNIQUE (run_id, attempt_number)', sameProject('run_id', 'runs'), referencedInProject],
  ),

  /*
   * A task's worktree for one repository on one device, shared by every run,
   * attempt and agent of the task (ADR-006).
   */
  table(
    'workspaces',
    [
      id('ws'),
      project(),
      scoped('task_id'),
      scoped('binding_id'),
      ref('device_id', 'devices'),
      word('access', 'repository_access'),
      'path TEXT NOT NULL',
      'base_ref TEXT NOT NULL',
      gitObject('base_commit', { nullable: true }),
      'branch TEXT NOT NULL',
      word('state', 'workspace_state'),
      at('created_at'),
      at('cleaned_at', { nullable: true }),
      revision,
    ],
    [
      'UNIQUE (task_id, binding_id, device_id)',
      sameProject('task_id', 'tasks'),
      sameProject('binding_id', 'repository_bindings'),
      referencedInProject,
    ],
  ),

  table(
    'workflow_executions',
    [
      id('wexe'),
      project(),
      'run_id TEXT NOT NULL UNIQUE',
      ref('workflow_version_id', 'workflow_versions'),
      'graph_revision INTEGER NOT NULL DEFAULT 1 CHECK (graph_revision >= 1)',
      word('state', 'execution_state'),
      at('created_at'),
      at('ended_at', { nullable: true }),
      revision,
    ],
    [sameProject('run_id', 'runs'), referencedInProject],
  ),

  table(
    'execution_graph_revisions',
    [
      project(),
      scoped('execution_id'),
      'revision INTEGER NOT NULL CHECK (revision >= 1)',
      json('graph'),
      word('cause', 'graph_revision_cause'),
      at('created_at'),
    ],
    ['PRIMARY KEY (execution_id, revision)', sameProject('execution_id', 'workflow_executions')],
  ),

  /* A node row per loop iteration: review round 2 is its own row, with its own attempts. */
  table(
    'nodes',
    [
      id('node'),
      project(),
      scoped('execution_id'),
      'node_key TEXT NOT NULL',
      'iteration INTEGER NOT NULL DEFAULT 0 CHECK (iteration >= 0)',
      word('type', 'node_type'),
      'added_in_revision INTEGER NOT NULL CHECK (added_in_revision >= 1)',
      json('config', { empty: '{}' }),
      word('state', 'node_state'),
      at('created_at'),
      revision,
    ],
    ['UNIQUE (execution_id, node_key, iteration)', sameProject('execution_id', 'workflow_executions'), referencedInProject],
  ),

  index('tasks_by_project', 'tasks (project_id, state)'),
  index('task_plans_by_task', 'task_plans (task_id)'),
  index('runs_by_task', 'runs (task_id)'),
  index('one_active_attempt_per_run', 'run_attempts (run_id)', { unique: true, where: "state = 'active'" }),
  index('run_attempts_by_controller', 'run_attempts (controller_instance_id)'),
]
