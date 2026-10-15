import {
  at,
  id,
  index,
  json,
  project,
  referencedInProject,
  revision,
  sameProject,
  scoped,
  table,
  vocabulary,
  word,
} from './0001_initial/columns'

/*
 * A task's lead resolving a conflict with its default branch on its own,
 * where the project says to (docs/architecture/06, "Resolving a conflict"):
 * found by merging here, or said by the host of a pull request. A round
 * keeps where the conflict is (the pull request's address, or none for
 * merging here), what conflicts in each repository with the branch it is
 * merged with and where each branch stood as it began, which attempt it is
 * on, which of the thread's inputs last asked the lead, and where it stands:
 * the lead resolving it (or fixing what failed on it), Althar waiting for the
 * pull request's checks on what it pushed, resolved, or given back to the
 * person with why. Where Althar pushed what resolved it, the commit it last
 * pushed.
 *
 * A task can say otherwise than its project: its lead resolves a conflict
 * unasked (1), or waits for the person to ask it (0); null, as the project's
 * rules say.
 */
export const statements: ReadonlyArray<string> = [
  ...vocabulary('conflict_resolution_state', ['resolving', 'checking', 'resolved', 'failed']),
  "INSERT INTO vocab_aggregate_type (word) VALUES ('conflict_resolution')",
  table(
    'conflict_resolutions',
    [
      id('cres'),
      project(),
      scoped('task_id'),
      'pull_request_url TEXT',
      json('conflicts'),
      'attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1)',
      word('state', 'conflict_resolution_state'),
      'failure TEXT',
      json('ended', { nullable: true }),
      'pushed_head TEXT',
      'asked_sequence INTEGER CHECK (asked_sequence >= 1)',
      at('created_at'),
      at('updated_at'),
      at('settled_at', { nullable: true }),
      revision,
    ],
    [
      sameProject('task_id', 'tasks'),
      referencedInProject,
      "CHECK ((state = 'failed') = (failure IS NOT NULL))",
      "CHECK ((state IN ('resolving', 'checking')) = (settled_at IS NULL))",
      "CHECK (state <> 'checking' OR pushed_head IS NOT NULL)",
    ],
  ),
  index('conflict_resolutions_by_project', 'conflict_resolutions (project_id)'),
  // One round at a time on a task.
  index('conflict_resolutions_under_way', 'conflict_resolutions (task_id)', {
    unique: true,
    where: "state IN ('resolving', 'checking')",
  }),
  'ALTER TABLE tasks ADD COLUMN resolve_conflicts INTEGER CHECK (resolve_conflicts IN (0, 1))',
]
