/*
 * The task a runnable was kept for (docs/decisions/workspaces-and-runs.md, "What a project runs"): one a task's lead
 * keeps goes once that task's worktrees are cleaned up, as what it runs mostly lives only on the task's branch.
 * Runnables kept before say their task nowhere but in its thread, and only where the evidence is of that runnable: its
 * project.runnable_kept lines that set its name, command and repository since it was made, each matched to the leads'
 * keep_run calls it answered: in the same project, with the same command and no other repository named, the first such
 * line just after each. Where every such line has its calls, and they are all one task's, that task. Where no line has one, the task whose thread
 * ran it, by its id, as it was kept, within a minute, as run_project keeps what it runs. A task that only ran it later
 * isn't the one that kept it, and where the evidence names more than one task, none is taken: it stays the project's.
 * Only those Althar's system actor kept, as leads keep theirs; the person's and the coordinator's belong to no task.
 * Each list is read in one pass, not once for each runnable.
 */
export const statements: ReadonlyArray<string> = [
  'ALTER TABLE runnables ADD COLUMN task_id TEXT REFERENCES tasks (id)',
  `WITH calls AS MATERIALIZED (
    SELECT i.project_id, t.task_id, i.created_at, json_extract(i.content, '$.rawInput.command') AS command,
      lower(json_extract(i.content, '$.rawInput.repository')) AS repository
    FROM thread_items i JOIN threads t ON t.id = i.thread_id
    WHERE i.kind = 'tool_call' AND t.task_id IS NOT NULL AND i.content LIKE '%keep\\_run%' ESCAPE '\\'
      AND json_extract(i.content, '$.title') IN ('keep_run', 'mcp__althar__keep_run')
      AND json_extract(i.content, '$.status') = 'completed'
  ), kept AS MATERIALIZED (
    SELECT e.sequence, e.project_id, e.occurred_at, lower(json_extract(e.payload, '$.name')) AS name,
      json_extract(e.payload, '$.command') AS command, json_extract(e.payload, '$.repository') AS repository
    FROM record_events e
    WHERE e.type = 'project.runnable_kept' AND e.actor_id IN (SELECT id FROM actors WHERE kind = 'system')
  ), answered AS MATERIALIZED (
    SELECT c.task_id, (
      SELECT k.sequence FROM kept k
      WHERE k.project_id = c.project_id AND k.command = c.command
        AND (c.repository IS NULL OR c.repository = lower(k.repository) OR c.repository IN (
          SELECT b.slug FROM repository_bindings b WHERE b.project_id = k.project_id AND b.display_name = k.repository))
        AND k.occurred_at BETWEEN strftime('%Y-%m-%dT%H:%M:%fZ', c.created_at, '-5 seconds')
          AND strftime('%Y-%m-%dT%H:%M:%fZ', c.created_at, '+60 seconds')
      ORDER BY k.occurred_at, k.sequence LIMIT 1
    ) AS sequence
    FROM calls c
  ), evidence AS MATERIALIZED (
    SELECT r.id AS runnable_id, a.task_id
    FROM runnables r
    JOIN repository_bindings b ON b.id = r.binding_id
    JOIN kept k ON k.project_id = r.project_id AND k.name = lower(r.name) AND k.command = r.command
      AND k.repository = b.display_name
      AND k.occurred_at >= strftime('%Y-%m-%dT%H:%M:%fZ', r.created_at, '-5 seconds')
    LEFT JOIN answered a ON a.sequence = k.sequence
    WHERE r.dropped_at IS NULL AND r.command IS NOT NULL AND r.name IS NOT NULL
  ), cards AS MATERIALIZED (
    SELECT i.project_id, t.task_id, i.created_at, json_extract(i.content, '$.runnableId') AS runnable_id
    FROM thread_items i JOIN threads t ON t.id = i.thread_id
    WHERE i.kind = 'run' AND t.task_id IS NOT NULL AND i.content LIKE '%runnableId%'
  )
  UPDATE runnables SET task_id = CASE
    WHEN EXISTS (SELECT 1 FROM evidence WHERE evidence.runnable_id = runnables.id AND evidence.task_id IS NOT NULL)
    THEN (SELECT min(task_id) FROM evidence WHERE evidence.runnable_id = runnables.id
      HAVING count(DISTINCT task_id) = 1 AND count(task_id) = count(*))
    ELSE (SELECT min(task_id) FROM cards WHERE cards.project_id = runnables.project_id AND cards.runnable_id = runnables.id
      AND cards.created_at BETWEEN runnables.created_at AND strftime('%Y-%m-%dT%H:%M:%fZ', runnables.created_at, '+60 seconds')
      HAVING count(DISTINCT task_id) = 1)
  END
  WHERE dropped_at IS NULL AND command IS NOT NULL
    AND kept_by_actor_id IN (SELECT id FROM actors WHERE kind = 'system')`,
  'CREATE INDEX runnables_of_task ON runnables (task_id) WHERE task_id IS NOT NULL AND dropped_at IS NULL',
]
