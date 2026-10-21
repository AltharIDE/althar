/*
 * A round of work after the first (a run of no plan, ADR-034) is opened by a
 * turn given its lead just before its first step, Implement, is there; the
 * runtime marks that turn as the step's (ADR-054), which a step's model is
 * read from. Rounds opened before it did are marked here: their first try is
 * given the last turn its session was given after the round before ended and
 * by the time the try was admitted, where none is marked as its yet.
 */
export const statements: ReadonlyArray<string> = [
  `WITH firsts AS (
  SELECT a.id AS attempt_id, a.provider_session_id AS session_id, a.admitted_at,
    (SELECT max(p.ended_at) FROM runs p WHERE p.task_id = r.task_id AND p.created_at < r.created_at) AS after
  FROM node_attempts a
  JOIN nodes n ON n.id = a.node_id
  JOIN workflow_executions e ON e.id = n.execution_id
  JOIN runs r ON r.id = e.run_id
  WHERE r.plan_id IS NULL AND n.node_key = 'implement' AND n.iteration = 0 AND a.attempt_number = 1
    AND a.provider_session_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM turn_deliveries m WHERE m.node_attempt_id = a.id)
),
openers AS (
  SELECT f.attempt_id, (
    SELECT t.id FROM turn_deliveries t
    WHERE t.provider_session_id = f.session_id AND t.node_attempt_id IS NULL
      AND t.requested_at >= f.after AND t.requested_at <= f.admitted_at
    ORDER BY t.requested_at DESC, t.rowid DESC LIMIT 1
  ) AS delivery_id
  FROM firsts f WHERE f.after IS NOT NULL
)
UPDATE turn_deliveries SET node_attempt_id = (SELECT o.attempt_id FROM openers o WHERE o.delivery_id = turn_deliveries.id)
WHERE id IN (SELECT delivery_id FROM openers WHERE delivery_id IS NOT NULL)`,
]
