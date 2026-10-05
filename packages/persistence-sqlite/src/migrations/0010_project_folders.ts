import { at, id, index, project, ref, table } from './0001_initial/columns'

/*
 * Projects of several repositories, and of a folder inside one
 * (docs/architecture/01).
 *
 * A project remembers the folder it was opened at on each device, so opening
 * that folder again finds it: one that holds several repositories, a
 * repository, or a folder inside one. A repository binding can name a folder
 * inside its repository, the part of a monorepo the project is about: its
 * agents start there and its coordinator reads from there, while the rest of
 * the repository stays the task's to change.
 */
export const statements: ReadonlyArray<string> = [
  table(
    'project_folders',
    [id('pfo'), project(), ref('device_id', 'devices'), 'path TEXT NOT NULL', at('created_at')],
    ['UNIQUE (device_id, path)'],
  ),
  index('project_folders_by_project', 'project_folders (project_id)'),
  'ALTER TABLE repository_bindings ADD COLUMN folder TEXT',
]
