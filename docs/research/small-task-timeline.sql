-- Where a small task's time goes, from an Althar profile (docs/research/small-task-timeline.md).
-- Read-only, and only on a copy: Althar holds its profile's database for itself, so open a copy, never the live file.
--
--   d=$(mktemp -d) && cp ~/Library/Application\ Support/Althar/althar.sqlite* "$d"/ && \
--     sqlite3 -cmd "PRAGMA query_only = ON" -header -column "$d/althar.sqlite" < docs/research/small-task-timeline.sql; rm -rf "$d"
--
-- One row per task whose pull request changed at most 40 lines, the latest 12, in minutes from the task's creation:
-- waiting for a place, the lead's steps, the review's, until the pull request opened, from it to checks passed, and merged.
-- It prints no titles, paths or times of day.

WITH small AS (
  SELECT t.id AS task_id, t.created_at, x.id AS link_id, json_extract(x.snapshot, '$.number') AS pr,
    json_extract(x.snapshot, '$.additions') + json_extract(x.snapshot, '$.deletions') AS lines
  FROM tasks t JOIN external_links x ON x.task_id = t.id AND x.kind = 'change'
  WHERE json_extract(x.snapshot, '$.additions') + json_extract(x.snapshot, '$.deletions') <= 40
  ORDER BY t.created_at DESC LIMIT 12
),
attempt AS (
  SELECT r.task_id, n.node_key, a.id, a.started_at, a.ended_at
  FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
  JOIN runs r ON r.id = e.run_id WHERE r.task_id IN (SELECT task_id FROM small)
),
held AS (
  SELECT aggregate_id, type, payload, occurred_at,
    lead(occurred_at) OVER (PARTITION BY aggregate_id ORDER BY sequence) AS next_at
  FROM record_events WHERE aggregate_id IN (SELECT id FROM attempt)
),
seen AS (
  SELECT subject_id, kind, observed_at, json_extract(payload, '$.outcome') AS outcome FROM observations
  WHERE subject_id IN (SELECT link_id FROM small)
)
SELECT s.pr, s.lines,
  round(coalesce((SELECT sum(julianday(h.next_at) - julianday(h.occurred_at)) FROM held h JOIN attempt a ON a.id = h.aggregate_id
    WHERE a.task_id = s.task_id AND h.type = 'node_attempt.held' AND h.payload LIKE '%machine_busy%'), 0) * 1440, 1) AS place,
  round(coalesce((SELECT sum(julianday(ended_at) - julianday(started_at)) FROM attempt a
    WHERE a.task_id = s.task_id AND a.node_key IN ('implement', 'settle')), 0) * 1440, 1) AS lead,
  round(coalesce((SELECT sum(julianday(ended_at) - julianday(started_at)) FROM attempt a
    WHERE a.task_id = s.task_id AND a.node_key = 'review'), 0) * 1440, 1) AS review,
  round((julianday((SELECT min(occurred_at) FROM record_events WHERE aggregate_id = s.link_id)) - julianday(s.created_at)) * 1440, 1) AS to_pr,
  round((julianday((SELECT min(observed_at) FROM seen WHERE subject_id = s.link_id AND kind = 'checks' AND outcome = 'passed'))
    - julianday((SELECT min(occurred_at) FROM record_events WHERE aggregate_id = s.link_id))) * 1440, 1) AS checks,
  round((julianday((SELECT min(observed_at) FROM seen WHERE subject_id = s.link_id AND kind = 'merged')) - julianday(s.created_at)) * 1440, 1) AS to_merge
FROM small s ORDER BY s.created_at DESC;
