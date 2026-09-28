import { at, id, index, json, project, ref, referencedInProject, revision, sameProject, scoped, table, word } from './columns'

/** Permission requests from agents, requests for a person, review findings, and the decisions that answer them. */
export const attention: ReadonlyArray<string> = [
  table(
    'permission_requests',
    [
      id('perm'),
      project(),
      scoped('provider_session_id'),
      scoped('node_attempt_id', { nullable: true }),
      'tool_call_id TEXT NOT NULL',
      word('tool_kind', 'tool_kind'),
      'title TEXT NOT NULL',
      json('raw_input', { empty: '{}' }),
      json('options', { empty: '[]' }),
      'action_digest TEXT NOT NULL',
      word('state', 'permission_request_state'),
      at('received_at'),
      revision,
    ],
    [sameProject('provider_session_id', 'provider_sessions'), sameProject('node_attempt_id', 'node_attempts'), referencedInProject],
  ),

  table(
    'attention_requests',
    [
      id('attn'),
      project(),
      scoped('task_id', { nullable: true }),
      scoped('node_attempt_id', { nullable: true }),
      scoped('permission_request_id', { nullable: true }),
      word('kind', 'attention_kind'),
      ref('addressee_actor_id', 'actors', { nullable: true }),
      json('payload', { empty: '{}' }),
      'action_digest TEXT',
      scoped('policy_id', { nullable: true }),
      word('state', 'attention_state'),
      at('created_at'),
      at('expires_at', { nullable: true }),
      at('answered_at', { nullable: true }),
      revision,
    ],
    [
      "CHECK ((kind = 'permission') = (permission_request_id IS NOT NULL))",
      sameProject('task_id', 'tasks'),
      sameProject('node_attempt_id', 'node_attempts'),
      sameProject('permission_request_id', 'permission_requests'),
      sameProject('policy_id', 'policies'),
      referencedInProject,
    ],
  ),

  /*
   * One finding from a review attempt. It stays open until the lead fixes it
   * or sets it aside, or a person dismisses it; `response` is the lead's
   * answer: what it changed, or why it set the finding aside. A later review
   * round is briefed on these, and a finding that raises an earlier one again
   * says which, in `repeats_finding_id`.
   */
  table(
    'findings',
    [
      id('find'),
      project(),
      scoped('review_attempt_id'),
      word('severity', 'finding_severity'),
      json('location', { empty: '{}' }),
      'claim TEXT NOT NULL',
      'confidence REAL CHECK (confidence >= 0 AND confidence <= 1)',
      word('state', 'finding_state'),
      ref('settled_by_actor_id', 'actors', { nullable: true }),
      scoped('settled_in_attempt_id', { nullable: true }),
      'response TEXT',
      scoped('repeats_finding_id', { nullable: true }),
      at('created_at'),
      at('settled_at', { nullable: true }),
      revision,
    ],
    [
      "CHECK ((state = 'open') = (settled_at IS NULL))",
      sameProject('review_attempt_id', 'node_attempts'),
      sameProject('settled_in_attempt_id', 'node_attempts'),
      sameProject('repeats_finding_id', 'findings'),
      referencedInProject,
    ],
  ),

  /*
   * A decision answers exactly one subject. For a permission, `outcome` and
   * `scope` are Charrette's own decision; `agent_option_id` is the option sent
   * back to the agent, which is always a one-time option, so every later
   * request still reaches Charrette (ADR-007). A decision can be superseded by
   * a later one, never edited.
   */
  table(
    'decisions',
    [
      id('dec'),
      project(),
      scoped('permission_request_id', { nullable: true }),
      scoped('attention_request_id', { nullable: true }),
      scoped('finding_id', { nullable: true }),
      word('outcome', 'decision_outcome'),
      word('scope', 'decision_scope', { nullable: true }),
      'agent_option_id TEXT',
      'reason TEXT',
      ref('decided_by_actor_id', 'actors'),
      scoped('decided_by_session_id', { nullable: true }),
      json('rule', { nullable: true }),
      scoped('policy_id', { nullable: true }),
      'action_digest TEXT',
      scoped('supersedes_decision_id', { nullable: true }),
      at('decided_at'),
      at('consumed_at', { nullable: true }),
    ],
    [
      'CHECK ((permission_request_id IS NOT NULL) + (attention_request_id IS NOT NULL) + (finding_id IS NOT NULL) = 1)',
      "CHECK ((outcome IN ('allow', 'reject')) = (scope IS NOT NULL))",
      'CHECK (agent_option_id IS NULL OR permission_request_id IS NOT NULL)',
      sameProject('permission_request_id', 'permission_requests'),
      sameProject('attention_request_id', 'attention_requests'),
      sameProject('finding_id', 'findings'),
      sameProject('decided_by_session_id', 'provider_sessions'),
      sameProject('policy_id', 'policies'),
      sameProject('supersedes_decision_id', 'decisions'),
      referencedInProject,
    ],
  ),

  index('permission_requests_open', 'permission_requests (provider_session_id)', { where: "state = 'open'" }),
  index('attention_requests_by_project', 'attention_requests (project_id, state)'),
  index('attention_requests_by_task', 'attention_requests (task_id)'),
  index('findings_by_review', 'findings (review_attempt_id)'),
  index('findings_open', 'findings (project_id)', { where: "state = 'open'" }),
  index('findings_by_repeated', 'findings (repeats_finding_id)'),
  index('decisions_by_permission_request', 'decisions (permission_request_id)'),
  index('decisions_by_attention_request', 'decisions (attention_request_id)'),
  index('decisions_by_finding', 'decisions (finding_id)'),
]
