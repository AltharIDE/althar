/*
 * What every card reads, found without going through a thread's turns or
 * items one by one. Whether the coordinator's turn that made a draft is
 * still open, and how its lead's last turn ended, are read by thread and
 * time: by thread alone, each read went through all of a thread's turns, 500
 * in the person's longest, and sorted them for the one it wanted. And
 * whether the lead's tool calls may have changed its worktree, which a ready
 * task's files are read again on, is read from its tool calls alone: by
 * thread, the read went through every item of the thread, 5,000 in the
 * person's longest, to count them.
 */
export const statements: ReadonlyArray<string> = [
  'CREATE INDEX turn_deliveries_by_thread_time ON turn_deliveries (thread_id, requested_at)',
  "CREATE INDEX thread_items_tool_calls ON thread_items (thread_id, sequence) WHERE kind = 'tool_call'",
]
