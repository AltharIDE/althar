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
 * on, and where it stands: the lead resolving it, resolved, or given back to
 * the person with why. Where Althar pushed what resolved it, the commit it
 * pushed.
 */
export const statements: ReadonlyArray<string> = [
  ...vocabulary('conflict_resolution_state', ['resolving', 'resolved', 'failed']),
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
      at('created_at'),
      at('updated_at'),
      at('settled_at', { nullable: true }),
      revision,
    ],
    [
      sameProject('task_id', 'tasks'),
      referencedInProject,
      "CHECK ((state = 'failed') = (failure IS NOT NULL))",
      "CHECK ((state = 'resolving') = (settled_at IS NULL))",
    ],
  ),
  index('conflict_resolutions_by_project', 'conflict_resolutions (project_id)'),
  // One round at a time on a task.
  index('conflict_resolutions_resolving', 'conflict_resolutions (task_id)', { unique: true, where: "state = 'resolving'" }),
]
