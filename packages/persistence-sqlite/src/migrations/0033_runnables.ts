import { at, id, index, project, ref, revision, sameProject, scoped, table } from './0001_initial/columns'

/*
 * What a project runs (ADR-044): not one command but a list, in the
 * person's order, the first its default, each run in one of its
 * repositories. One with no command of its own is that repository's own way
 * to run, kept for it with set_run_command or worked out from it (ADR-023);
 * the rest say theirs, such as `bun --filter @althar/ui storybook`, and may
 * have a name. Who kept one is the person, an agent, or nobody for a
 * repository's own. Dropping one keeps its row, as a note's does.
 *
 * Every repository bound before this runs its own way, first in its project
 * in the order the repositories were bound, as the one Run button did.
 */
export const statements: ReadonlyArray<string> = [
  table(
    'runnables',
    [
      id('rnbl'),
      project(),
      scoped('binding_id'),
      'name TEXT CHECK (name IS NULL OR length(trim(name)) > 0)',
      'command TEXT CHECK (command IS NULL OR length(trim(command)) > 0)',
      'position INTEGER NOT NULL CHECK (position >= 0)',
      ref('kept_by_actor_id', 'actors', { nullable: true }),
      at('created_at'),
      ref('dropped_by_actor_id', 'actors', { nullable: true }),
      at('dropped_at', { nullable: true }),
      revision,
    ],
    [sameProject('binding_id', 'repository_bindings')],
  ),
  index('runnables_kept', 'runnables (project_id, position)', { where: 'dropped_at IS NULL' }),
  `INSERT INTO runnables (id, project_id, binding_id, position, created_at)
    SELECT 'rnbl_' || lower(hex(randomblob(16))), b.project_id, b.id,
      (SELECT count(*) FROM repository_bindings o
        WHERE o.project_id = b.project_id AND o.detached_at IS NULL
          AND (o.created_at < b.created_at OR (o.created_at = b.created_at AND o.rowid < b.rowid))),
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM repository_bindings b WHERE b.detached_at IS NULL`,
]
