import {
  at,
  flag,
  id,
  index,
  json,
  project,
  ref,
  referencedInProject,
  revision,
  sameProject,
  scoped,
  table,
  vocabulary,
  word,
} from './0001_initial/columns'

/*
 * Automations (docs/plans/automations.md): work Althar starts by itself on a
 * schedule. An automation is the person's, on the Mac it was made on: its
 * name, where it stands (proposed and waiting to be turned on, on, paused by
 * the person or by itself and why, or deleted), the definition it runs, when
 * it was last turned on (no slot before counts), and whether its reviews post
 * themselves.
 *
 * Its definitions are kept, one row for every change, never changed after:
 * its name, its prompt, and the rest as JSON (the schedule and the zone it
 * was made in, its lead, what each run does, its limits). Each time it runs,
 * or doesn't, is an occurrence: of a slot (the local time its schedule said,
 * or `now:` and an id for one the person asked for), of a subject within it
 * where it has one (a pull request it reviews), with the definition it ran
 * with, where it stands and why, and the task it started. One occurrence for
 * each slot and subject, refused by the store rather than by care, so a
 * day's 9:00 runs once however often the clock is read.
 */
export const statements: ReadonlyArray<string> = [
  ...vocabulary('automation_state', ['proposed', 'on', 'paused', 'deleted']),
  ...vocabulary('automation_paused_by', ['person', 'itself']),
  ...vocabulary('automation_occurrence_cause', ['schedule', 'now']),
  ...vocabulary('automation_occurrence_state', ['starting', 'running', 'made', 'nothing', 'failed', 'missed', 'skipped']),
  "INSERT INTO vocab_aggregate_type (word) VALUES ('automation'), ('automation_occurrence')",
  "INSERT INTO vocab_thread_item_kind (word) VALUES ('automation')",
  table(
    'automations',
    [
      id('auto'),
      project(),
      ref('device_id', 'devices'),
      word('state', 'automation_state'),
      word('paused_by', 'automation_paused_by', { nullable: true }),
      'pause_reason TEXT',
      'definition INTEGER NOT NULL CHECK (definition >= 1)',
      flag('posts_reviews', 0),
      at('since', { nullable: true }),
      ref('made_by_actor_id', 'actors'),
      at('created_at'),
      at('updated_at'),
      revision,
    ],
    [
      referencedInProject,
      "CHECK ((state = 'paused') = (paused_by IS NOT NULL))",
      "CHECK (state = 'paused' OR pause_reason IS NULL)",
      "CHECK (state <> 'on' OR since IS NOT NULL)",
    ],
  ),
  index('automations_by_project', 'automations (project_id)'),
  table(
    'automation_definitions',
    [
      scoped('automation_id'),
      project(),
      'number INTEGER NOT NULL CHECK (number >= 1)',
      'name TEXT NOT NULL',
      'prompt TEXT NOT NULL',
      json('parts', { empty: '{}' }),
      ref('made_by_actor_id', 'actors'),
      at('made_at'),
    ],
    ['PRIMARY KEY (automation_id, number)', sameProject('automation_id', 'automations')],
  ),
  table(
    'automation_occurrences',
    [
      id('occ'),
      project(),
      scoped('automation_id'),
      'definition INTEGER NOT NULL',
      word('cause', 'automation_occurrence_cause'),
      'slot TEXT NOT NULL',
      "subject TEXT NOT NULL DEFAULT ''",
      'subject_title TEXT',
      word('state', 'automation_occurrence_state'),
      'reason TEXT',
      scoped('task_id', { nullable: true }),
      at('due_at'),
      at('fired_at'),
      at('ended_at', { nullable: true }),
      revision,
    ],
    [
      referencedInProject,
      sameProject('automation_id', 'automations'),
      sameProject('task_id', 'tasks'),
      'FOREIGN KEY (automation_id, definition) REFERENCES automation_definitions (automation_id, number)',
      'UNIQUE (automation_id, slot, subject)',
      "CHECK (state <> 'running' OR task_id IS NOT NULL)",
      "CHECK ((state IN ('made', 'nothing', 'failed', 'missed', 'skipped')) = (ended_at IS NOT NULL))",
    ],
  ),
  index('automation_occurrences_by_automation', 'automation_occurrences (automation_id, fired_at)'),
  index('automation_occurrences_by_task', 'automation_occurrences (task_id)', { where: 'task_id IS NOT NULL' }),
  index('automation_occurrences_by_project', 'automation_occurrences (project_id)'),
]
