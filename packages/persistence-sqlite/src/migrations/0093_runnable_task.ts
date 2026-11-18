/*
 * The task a runnable was kept for (docs/decisions/workspaces-and-runs.md, "What a project runs"): one a task's lead
 * keeps goes once that task's worktrees are cleaned up, as what it runs mostly lives only on the task's branch.
 * Runnables kept before say their task nowhere but in its thread: a lead's keep_run call with the same command, else the
 * first of its run cards that ran it. Only those Althar's system actor kept, as leads keep theirs; the person's and the
 * coordinator's belong to no task. Each list is read in one pass over the threads, not once for each runnable.
 */
export const statements: ReadonlyArray<string> = [
  'ALTER TABLE runnables ADD COLUMN task_id TEXT REFERENCES tasks (id)',
  `WITH calls AS MATERIALIZED (
    SELECT t.task_id, i.created_at, json_extract(i.content, '$.rawInput.command') AS command
    FROM thread_items i JOIN threads t ON t.id = i.thread_id
    WHERE i.kind = 'tool_call' AND t.task_id IS NOT NULL AND i.content LIKE '%keep\\_run%' ESCAPE '\\'
  ), cards AS MATERIALIZED (
    SELECT t.task_id, i.created_at, json_extract(i.content, '$.runnableId') AS runnable_id
    FROM thread_items i JOIN threads t ON t.id = i.thread_id
    WHERE i.kind = 'run' AND t.task_id IS NOT NULL AND i.content LIKE '%runnableId%'
  )
  UPDATE runnables SET task_id = coalesce(
    (SELECT task_id FROM calls WHERE calls.command = runnables.command AND calls.created_at <= runnables.created_at
      ORDER BY calls.created_at DESC LIMIT 1),
    (SELECT task_id FROM cards WHERE cards.runnable_id = runnables.id ORDER BY cards.created_at LIMIT 1))
  WHERE dropped_at IS NULL AND command IS NOT NULL
    AND kept_by_actor_id IN (SELECT id FROM actors WHERE kind = 'system')`,
  'CREATE INDEX runnables_of_task ON runnables (task_id) WHERE task_id IS NOT NULL AND dropped_at IS NULL',
]
