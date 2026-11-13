import type { AggregateType } from '@althar/domain'

/*
 * The task a change in the store's feed is of, for every kind of record the
 * feed names: what a change to it may move on that task's card. Each kind
 * says it here, by SQL on the change `c` (a row of change_log), or that it is
 * of no task: a kind added to the feed doesn't type-check until it says, so no
 * change to what a card shows can go unread by its board.
 */

/** The task a run's step's try is of. */
const OF_ATTEMPT = (id: string) => `(SELECT r.task_id FROM node_attempts a JOIN nodes n ON n.id = a.node_id
  JOIN workflow_executions e ON e.id = n.execution_id JOIN runs r ON r.id = e.run_id WHERE a.id = ${id})`

/** The task a thread is of: a task's own, or one of its steps' (a review's); none for a coordinator's. */
const OF_THREAD = (id: string) => `(SELECT task_id FROM threads WHERE id = ${id})`

export const TASK_OF: Readonly<Record<AggregateType, string | null>> = {
  task: 'c.aggregate_id',
  task_plan: '(SELECT task_id FROM task_plans WHERE id = c.aggregate_id)',
  run: '(SELECT task_id FROM runs WHERE id = c.aggregate_id)',
  run_attempt: '(SELECT r.task_id FROM run_attempts a JOIN runs r ON r.id = a.run_id WHERE a.id = c.aggregate_id)',
  workflow_execution: '(SELECT r.task_id FROM workflow_executions e JOIN runs r ON r.id = e.run_id WHERE e.id = c.aggregate_id)',
  node: `(SELECT r.task_id FROM nodes n JOIN workflow_executions e ON e.id = n.execution_id
    JOIN runs r ON r.id = e.run_id WHERE n.id = c.aggregate_id)`,
  node_attempt: OF_ATTEMPT('c.aggregate_id'),
  workspace: '(SELECT task_id FROM workspaces WHERE id = c.aggregate_id)',
  thread: OF_THREAD('c.aggregate_id'),
  // An item of a task's thread; or a task's card in its coordinator's thread, which `touchCard` moves on as the card is
  // to be read again (its moment between agents over, its task renamed).
  thread_item: `(SELECT coalesce(h.task_id, CASE WHEN i.kind = 'task' THEN json_extract(i.content, '$.taskId') END)
    FROM thread_items i JOIN threads h ON h.id = i.thread_id WHERE i.id = c.aggregate_id)`,
  user_input: OF_THREAD('(SELECT thread_id FROM user_inputs WHERE id = c.aggregate_id)'),
  turn_delivery: OF_THREAD('(SELECT thread_id FROM turn_deliveries WHERE id = c.aggregate_id)'),
  provider_session: OF_THREAD('(SELECT thread_id FROM provider_sessions WHERE id = c.aggregate_id)'),
  permission_request: OF_THREAD(`(SELECT s.thread_id FROM permission_requests r
    JOIN provider_sessions s ON s.id = r.provider_session_id WHERE r.id = c.aggregate_id)`),
  attention_request: '(SELECT task_id FROM attention_requests WHERE id = c.aggregate_id)',
  // A call answered: by its permission's session, or its attention request.
  decision: `coalesce(
    (SELECT h.task_id FROM decisions d JOIN permission_requests r ON r.id = d.permission_request_id
      JOIN provider_sessions s ON s.id = r.provider_session_id JOIN threads h ON h.id = s.thread_id WHERE d.id = c.aggregate_id),
    (SELECT a.task_id FROM decisions d JOIN attention_requests a ON a.id = d.attention_request_id WHERE d.id = c.aggregate_id))`,
  finding: OF_ATTEMPT('(SELECT review_attempt_id FROM findings WHERE id = c.aggregate_id)'),
  change_set: '(SELECT task_id FROM change_sets WHERE id = c.aggregate_id)',
  external_link: '(SELECT task_id FROM external_links WHERE id = c.aggregate_id)',
  issue_draft: OF_THREAD('(SELECT thread_id FROM issue_drafts WHERE id = c.aggregate_id)'),
  issue_change: OF_THREAD('(SELECT thread_id FROM issue_changes WHERE id = c.aggregate_id)'),
  review_draft: '(SELECT task_id FROM review_drafts WHERE id = c.aggregate_id)',
  conflict_resolution: '(SELECT task_id FROM conflict_resolutions WHERE id = c.aggregate_id)',
  errand: OF_THREAD('(SELECT thread_id FROM errands WHERE id = c.aggregate_id)'),
  automation_occurrence: '(SELECT task_id FROM automation_occurrences WHERE id = c.aggregate_id)',
  // What isn't any one task's: a project, its notes, rules, automations and canvases, this device's agents, accounts,
  // connections, skills and settings, a pull request followed for the coordinator, a command's receipt. The card a
  // change came out as is the news itself, never a change to work it out again from.
  project: null,
  project_note: null,
  policy: null,
  automation: null,
  canvas: null,
  followed_pull: null,
  mutation_receipt: null,
  agent_installation: null,
  account_status: null,
  agent_account: null,
  connection: null,
  skill: null,
  setting: null,
  card: null,
}

/** SQL for the task a change `c` of change_log is of, or NULL. */
export const taskOfChange = `CASE c.aggregate_type
  ${Object.entries(TASK_OF)
    .flatMap(([type, of]) => (of === null ? [] : [`WHEN '${type}' THEN ${of}`]))
    .join('\n  ')}
END`
