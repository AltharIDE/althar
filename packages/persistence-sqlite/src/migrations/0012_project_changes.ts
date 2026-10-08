import { vocabulary } from './0001_initial/columns'

/*
 * A project that changes after it is made (docs/architecture/01): renamed,
 * its repositories added or left out, each with its role, and removed.
 *
 * A repository's role was free text, written as `primary` or `repository`
 * and never read; it is now one of the roles the person can choose, and the
 * runtime checks it, since the column predates the vocabulary. A repository
 * whose remote is a fork says where its tasks open pull requests: on the
 * repository it was forked from, or on the fork; none means as before, on the
 * remote it was opened with.
 *
 * Leaving a repository out sets its `detached_at`, and removing a project its
 * `archived_at`: both columns were there from the start, waiting.
 */
export const statements: ReadonlyArray<string> = [
  ...vocabulary('repository_role', ['service', 'frontend', 'infrastructure', 'library', 'docs', 'other']),
  ...vocabulary('change_target', ['upstream', 'fork']),
  "UPDATE repository_bindings SET role = 'other' WHERE role NOT IN (SELECT word FROM vocab_repository_role)",
  'ALTER TABLE repository_bindings ADD COLUMN change_target TEXT REFERENCES vocab_change_target (word)',
]
