import { index } from './0001_initial/columns'

/*
 * Ways in for reads that scanned whole tables. A thread page looks up each
 * tool call's permission, decided or not, by session and tool call, and
 * whether a question in the thread stands in its place. What waits for a
 * place asks whether any turn of a task's threads, of whatever kind, reached
 * an agent: the existing indexes cover only a task's own thread and active
 * turns.
 */
export const statements: ReadonlyArray<string> = [
  index('permission_requests_by_tool_call', 'permission_requests (provider_session_id, tool_call_id)'),
  index('thread_items_questions', "thread_items (thread_id, provider_session_id, json_extract(content, '$.toolCallId'))", {
    where: "kind = 'question'",
  }),
  index('threads_by_task', 'threads (task_id)'),
  index('turn_deliveries_by_thread', 'turn_deliveries (thread_id)'),
]
