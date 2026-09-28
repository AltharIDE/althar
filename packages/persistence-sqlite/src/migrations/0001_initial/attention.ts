import { at, id, index, json, oneOf, ref, revision, table } from './columns'

/** Permission requests from agents, requests for a person's attention, and the decisions that answer them. */
export const attention: ReadonlyArray<string> = [
  table('permission_requests', [
    id('perm'),
    ref('provider_session_id', 'provider_sessions'),
    ref('node_attempt_id', 'node_attempts', { nullable: true }),
    'tool_call_id TEXT NOT NULL',
    oneOf('tool_kind', ['read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'switch_mode', 'other']),
    'title TEXT NOT NULL',
    json('raw_input', { empty: '{}' }),
    json('options', { empty: '[]' }),
    'action_digest TEXT NOT NULL',
    oneOf('state', ['open', 'decided', 'cancelled']),
    at('received_at'),
  ]),

  table('attention_requests', [
    id('attn'),
    ref('project_id', 'projects'),
    ref('task_id', 'tasks', { nullable: true }),
    ref('node_attempt_id', 'node_attempts', { nullable: true }),
    ref('permission_request_id', 'permission_requests', { nullable: true }),
    oneOf('kind', ['permission', 'question', 'stuck', 'plan', 'graph_patch', 'usage_limit', 'review_disagreement']),
    ref('addressee_actor_id', 'actors', { nullable: true }),
    json('payload', { empty: '{}' }),
    'action_digest TEXT',
    ref('policy_id', 'policies', { nullable: true }),
    oneOf('state', ['open', 'answered', 'expired', 'withdrawn']),
    at('created_at'),
    at('expires_at', { nullable: true }),
    at('answered_at', { nullable: true }),
    revision,
    "CHECK ((kind = 'permission') = (permission_request_id IS NOT NULL))",
  ]),

  table('decisions', [
    id('dec'),
    ref('permission_request_id', 'permission_requests', { nullable: true }),
    ref('attention_request_id', 'attention_requests', { nullable: true }),
    oneOf('outcome', ['allow_once', 'allow_always', 'reject_once', 'reject_always', 'answer', 'dismiss']),
    'reason TEXT',
    ref('decided_by_actor_id', 'actors'),
    ref('decided_by_session_id', 'provider_sessions', { nullable: true }),
    json('rule', { nullable: true }),
    ref('policy_id', 'policies', { nullable: true }),
    'action_digest TEXT',
    at('decided_at'),
    at('consumed_at', { nullable: true }),
    'CHECK (permission_request_id IS NOT NULL OR attention_request_id IS NOT NULL)',
  ]),

  index('permission_requests_open', 'permission_requests (provider_session_id)', { where: "state = 'open'" }),
  index('attention_requests_by_project', 'attention_requests (project_id, state)'),
  index('attention_requests_by_task', 'attention_requests (task_id)'),
  index('decisions_by_permission_request', 'decisions (permission_request_id)'),
  index('decisions_by_attention_request', 'decisions (attention_request_id)'),
]
