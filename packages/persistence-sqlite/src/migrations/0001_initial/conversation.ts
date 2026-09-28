import { at, id, index, json, oneOf, ref, revision, table } from './columns'

/** Threads: what you write, how it reaches an agent, and the normalized record of the conversation. */
export const conversation: ReadonlyArray<string> = [
  table('threads', [
    id('thr'),
    ref('project_id', 'projects'),
    oneOf('kind', ['coordinator', 'task', 'step']),
    ref('owner_actor_id', 'actors', { nullable: true }),
    ref('task_id', 'tasks', { nullable: true }),
    ref('node_id', 'nodes', { nullable: true }),
    at('created_at'),
    revision,
    `CHECK (
    (kind = 'coordinator' AND owner_actor_id IS NOT NULL AND task_id IS NULL AND node_id IS NULL)
    OR (kind = 'task' AND owner_actor_id IS NULL AND task_id IS NOT NULL AND node_id IS NULL)
    OR (kind = 'step' AND owner_actor_id IS NULL AND task_id IS NOT NULL AND node_id IS NOT NULL)
  )`,
  ]),

  table('user_inputs', [
    id('input'),
    ref('thread_id', 'threads'),
    'sequence INTEGER NOT NULL CHECK (sequence >= 1)',
    "command_id TEXT NOT NULL UNIQUE CHECK (substr(command_id, 1, 4) = 'cmd_')",
    oneOf('disposition', ['after_current', 'interrupt_and_continue', 'supersede_pending', 'cancel_run']),
    'body TEXT NOT NULL',
    ref('author_actor_id', 'actors'),
    oneOf('state', ['queued', 'delivered', 'superseded']),
    at('accepted_at'),
    'UNIQUE (thread_id, sequence)',
  ]),

  table('turn_deliveries', [
    id('turn'),
    ref('thread_id', 'threads'),
    ref('provider_session_id', 'provider_sessions'),
    ref('node_attempt_id', 'node_attempts', { nullable: true }),
    'controller_generation INTEGER NOT NULL CHECK (controller_generation >= 1)',
    ref('brief_artifact_id', 'artifacts', { nullable: true }),
    oneOf('state', ['pending', 'delivered', 'completed', 'interrupted', 'interruption_uncertain', 'failed']),
    at('requested_at'),
    at('delivered_at', { nullable: true }),
    at('ended_at', { nullable: true }),
  ]),

  table('turn_delivery_inputs', [
    'delivery_id TEXT NOT NULL REFERENCES turn_deliveries (id)',
    'user_input_id TEXT NOT NULL REFERENCES user_inputs (id)',
    'position INTEGER NOT NULL CHECK (position >= 1)',
    'PRIMARY KEY (delivery_id, user_input_id)',
  ]),

  table('thread_items', [
    id('item'),
    ref('thread_id', 'threads'),
    'sequence INTEGER NOT NULL CHECK (sequence >= 1)',
    oneOf('kind', ['user_message', 'agent_message', 'agent_thought', 'tool_call', 'plan', 'step_result', 'notice']),
    ref('user_input_id', 'user_inputs', { nullable: true }),
    ref('delivery_id', 'turn_deliveries', { nullable: true }),
    ref('provider_session_id', 'provider_sessions', { nullable: true }),
    json('content'),
    at('created_at'),
    'UNIQUE (thread_id, sequence)',
    "CHECK ((kind = 'user_message') = (user_input_id IS NOT NULL))",
  ]),

  table('thread_summaries', [
    id('sum'),
    ref('thread_id', 'threads'),
    'covers_from_sequence INTEGER NOT NULL CHECK (covers_from_sequence >= 1)',
    'covers_to_sequence INTEGER NOT NULL',
    ref('artifact_id', 'artifacts'),
    'written_by TEXT NOT NULL',
    at('created_at'),
    'CHECK (covers_to_sequence >= covers_from_sequence)',
  ]),

  index('threads_by_project', 'threads (project_id)'),
  index('one_coordinator_thread_per_owner', 'threads (project_id, owner_actor_id)', { unique: true, where: "kind = 'coordinator'" }),
  index('one_thread_per_task', 'threads (task_id)', { unique: true, where: "kind = 'task'" }),
  index('one_thread_per_step', 'threads (node_id)', { unique: true, where: "kind = 'step'" }),
  index('user_inputs_queued', 'user_inputs (thread_id, sequence)', { where: "state = 'queued'" }),
  index('turn_deliveries_by_thread', 'turn_deliveries (thread_id)'),
  index('turn_deliveries_by_session', 'turn_deliveries (provider_session_id)'),
  index('thread_summaries_by_thread', 'thread_summaries (thread_id, covers_to_sequence)'),
]
