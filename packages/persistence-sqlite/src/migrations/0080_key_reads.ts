/*
 * What the board, the home and a task's view read on every change, found
 * by an index rather than by reading every row of a table that grows with
 * each turn. In the person's store of 180,000 items and 55,000 answers, each
 * of these went through the whole table, with the runtime's one thread
 * waiting: a task's card in its coordinator's thread, looked for each time
 * it was touched (7.5 s with the disk busy); whether a lead answered since
 * the person last looked, read for every card (a third of a second); and
 * the count of what the rules answered, on the home (over a second). The
 * turns that recorded heads are found by their thread the same way, without
 * reading each turn's prompt; and the setups and runs an earlier launch left
 * open, which each launch looks for, by their kind.
 */
export const statements: ReadonlyArray<string> = [
  'CREATE INDEX thread_items_by_delivery ON thread_items (delivery_id, kind) WHERE delivery_id IS NOT NULL',
  'CREATE INDEX turn_deliveries_with_heads ON turn_deliveries (thread_id, delivered_at) WHERE heads IS NOT NULL',
  "CREATE INDEX thread_items_task_cards ON thread_items (json_extract(content, '$.taskId')) WHERE kind = 'task'",
  'CREATE INDEX decisions_answered ON decisions (decided_by_actor_id, decided_at) WHERE permission_request_id IS NOT NULL',
  "CREATE INDEX thread_items_setups ON thread_items (kind) WHERE kind = 'setup'",
  "CREATE INDEX thread_items_runs ON thread_items (kind) WHERE kind = 'run'",
]
