/*
 * The task a runnable was kept for (docs/decisions/workspaces-and-runs.md, "What a project runs"): one a task's lead
 * keeps goes once that task's worktrees are cleaned up, as what it runs mostly lives only on the task's branch.
 * Runnables kept before say their task nowhere but in its thread, in the same project: the task whose leads' keep_run
 * calls that went through set its command, where they are all one task's; else, where no call did, the task whose
 * thread ran it as it was kept, within a minute, as run_project keeps what it runs. A task that only ran it later
 * isn't the one that kept it, and where the threads name more than one task, none is taken: it stays the project's.
 * Only those Althar's system actor kept, as leads keep theirs; the person's and the coordinator's belong to no task.
 * Each list is read in one pass over the threads, not once for each runnable.
 */
export const statements: ReadonlyArray<string> = [
  'ALTER TABLE runnables ADD COLUMN task_id TEXT REFERENCES tasks (id)',
  `WITH calls AS MATERIALIZED (
    SELECT i.project_id, t.task_id, json_extract(i.content, '$.rawInput.command') AS command
    FROM thread_items i JOIN threads t ON t.id = i.thread_id
    WHERE i.kind = 'tool_call' AND t.task_id IS NOT NULL AND i.content LIKE '%keep\\_run%' ESCAPE '\\'
      AND json_extract(i.content, '$.title') IN ('keep_run', 'mcp__althar__keep_run')
      AND json_extract(i.content, '$.status') = 'completed'
  ), cards AS MATERIALIZED (
    SELECT i.project_id, t.task_id, i.created_at, json_extract(i.content, '$.runnableId') AS runnable_id
    FROM thread_items i JOIN threads t ON t.id = i.thread_id
    WHERE i.kind = 'run' AND t.task_id IS NOT NULL AND i.content LIKE '%runnableId%'
  )
  UPDATE runnables SET task_id = CASE
    WHEN EXISTS (SELECT 1 FROM calls WHERE calls.project_id = runnables.project_id AND calls.command = runnables.command)
    THEN (SELECT min(task_id) FROM calls WHERE calls.project_id = runnables.project_id AND calls.command = runnables.command
      HAVING count(DISTINCT task_id) = 1)
    ELSE (SELECT min(task_id) FROM cards WHERE cards.project_id = runnables.project_id AND cards.runnable_id = runnables.id
      AND cards.created_at BETWEEN runnables.created_at AND strftime('%Y-%m-%dT%H:%M:%fZ', runnables.created_at, '+60 seconds')
      HAVING count(DISTINCT task_id) = 1)
  END
  WHERE dropped_at IS NULL AND command IS NOT NULL
    AND kept_by_actor_id IN (SELECT id FROM actors WHERE kind = 'system')`,
  'CREATE INDEX runnables_of_task ON runnables (task_id) WHERE task_id IS NOT NULL AND dropped_at IS NULL',
]
