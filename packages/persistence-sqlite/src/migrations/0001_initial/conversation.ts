import { at, id, idCheck, index, json, project, ref, referencedInProject, revision, sameProject, scoped, table, word } from './columns'

/** Threads: what you write, how it reaches an agent, and the normalized record of the conversation. */
export const conversation: ReadonlyArray<string> = [
  /*
   * A coordinator thread belongs to one person. A task has one thread with its
   * lead. A step has one thread per step name within an execution, so a
   * reviewer keeps its thread, and can keep its session, across review rounds.
   */
  table(
    'threads',
    [
      id('thr'),
      project(),
      word('kind', 'thread_kind'),
      ref('owner_actor_id', 'actors', { nullable: true }),
      scoped('task_id', { nullable: true }),
      scoped('execution_id', { nullable: true }),
      'node_key TEXT',
      at('created_at'),
      revision,
    ],
    [
      `CHECK (
    (kind = 'coordinator' AND owner_actor_id IS NOT NULL AND task_id IS NULL AND execution_id IS NULL AND node_key IS NULL)
    OR (kind = 'task' AND owner_actor_id IS NULL AND task_id IS NOT NULL AND execution_id IS NULL AND node_key IS NULL)
    OR (kind = 'step' AND owner_actor_id IS NULL AND task_id IS NOT NULL AND execution_id IS NOT NULL AND node_key IS NOT NULL)
  )`,
      sameProject('task_id', 'tasks'),
      sameProject('execution_id', 'workflow_executions'),
      referencedInProject,
    ],
  ),

  table(
    'user_inputs',
    [
      id('input'),
      project(),
      scoped('thread_id'),
      'sequence INTEGER NOT NULL CHECK (sequence >= 1)',
      `command_id TEXT NOT NULL UNIQUE CHECK (${idCheck('command_id', 'cmd')})`,
      word('disposition', 'input_disposition'),
      'body TEXT NOT NULL',
      ref('author_actor_id', 'actors'),
      word('state', 'user_input_state'),
      scoped('superseded_by_input_id', { nullable: true }),
      at('accepted_at'),
      revision,
    ],
    [
      'UNIQUE (thread_id, sequence)',
      "CHECK ((state = 'superseded') = (superseded_by_input_id IS NOT NULL))",
      sameProject('thread_id', 'threads'),
      sameProject('superseded_by_input_id', 'user_inputs'),
      referencedInProject,
    ],
  ),

  /*
   * One turn: what was sent to an agent session and what came back. The model
   * can change within a session, so each turn records its own, with the usage
   * the agent reported and why the turn stopped.
   */
  table(
    'turn_deliveries',
    [
      id('turn'),
      project(),
      scoped('thread_id'),
      scoped('provider_session_id'),
      scoped('node_attempt_id', { nullable: true }),
      'controller_generation INTEGER NOT NULL CHECK (controller_generation >= 1)',
      scoped('brief_artifact_id', { nullable: true }),
      'model TEXT',
      'effort TEXT',
      json('usage', { nullable: true }),
      'stop_reason TEXT',
      'error_class TEXT',
      word('state', 'turn_delivery_state'),
      at('requested_at'),
      at('delivered_at', { nullable: true }),
      at('ended_at', { nullable: true }),
      revision,
    ],
    [
      sameProject('thread_id', 'threads'),
      sameProject('provider_session_id', 'provider_sessions'),
      sameProject('node_attempt_id', 'node_attempts'),
      sameProject('brief_artifact_id', 'artifacts'),
      referencedInProject,
    ],
  ),

  table(
    'turn_delivery_inputs',
    [project(), scoped('delivery_id'), scoped('user_input_id'), 'position INTEGER NOT NULL CHECK (position >= 1)'],
    [
      'PRIMARY KEY (delivery_id, user_input_id)',
      sameProject('delivery_id', 'turn_deliveries'),
      sameProject('user_input_id', 'user_inputs'),
    ],
  ),

  /*
   * The conversation record, normalized from the agent's updates. A tool call
   * is one item, updated in place as the agent reports on it.
   */
  table(
    'thread_items',
    [
      id('item'),
      project(),
      scoped('thread_id'),
      'sequence INTEGER NOT NULL CHECK (sequence >= 1)',
      word('kind', 'thread_item_kind'),
      scoped('user_input_id', { nullable: true }),
      scoped('delivery_id', { nullable: true }),
      scoped('provider_session_id', { nullable: true }),
      'tool_call_id TEXT',
      json('content'),
      at('created_at'),
      revision,
    ],
    [
      'UNIQUE (thread_id, sequence)',
      "CHECK ((kind = 'user_message') = (user_input_id IS NOT NULL))",
      "CHECK ((kind = 'tool_call') = (tool_call_id IS NOT NULL))",
      sameProject('thread_id', 'threads'),
      sameProject('user_input_id', 'user_inputs'),
      sameProject('delivery_id', 'turn_deliveries'),
      sameProject('provider_session_id', 'provider_sessions'),
    ],
  ),

  index('threads_by_project', 'threads (project_id)'),
  index('one_coordinator_thread_per_owner', 'threads (project_id, owner_actor_id)', { unique: true, where: "kind = 'coordinator'" }),
  index('one_thread_per_task', 'threads (task_id)', { unique: true, where: "kind = 'task'" }),
  index('one_thread_per_step', 'threads (execution_id, node_key)', { unique: true, where: "kind = 'step'" }),
  index('user_inputs_queued', 'user_inputs (thread_id, sequence)', { where: "state = 'queued'" }),
  index('one_active_turn_per_thread', 'turn_deliveries (thread_id)', { unique: true, where: "state IN ('pending', 'delivered')" }),
  index('turn_deliveries_by_session', 'turn_deliveries (provider_session_id)'),
  index('one_item_per_tool_call', 'thread_items (thread_id, tool_call_id)', { unique: true, where: 'tool_call_id IS NOT NULL' }),
]
