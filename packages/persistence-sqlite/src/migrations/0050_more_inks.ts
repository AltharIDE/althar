/*
 * Four more inks for a project's mark: sand, indigo, plum and brick, twelve
 * in all. A project's ink is a column with a CHECK on the words it may hold,
 * and SQLite can't change a CHECK in place, so the table is rebuilt (its
 * documented procedure; foreign keys are off while migrations run, and
 * checked after). Every project keeps its row and its ink.
 */
const INKS = ['clay', 'ochre', 'sand', 'olive', 'moss', 'teal', 'slate', 'indigo', 'plum', 'rose', 'brick', 'umber'] as const

const COLUMNS =
  'id, name, slug, created_by_actor_id, created_at, archived_at, revision, ink, tracker_connection_id, tracker_container_id, tracker_container_name'

export const statements: ReadonlyArray<string> = [
  `CREATE TABLE projects_new (
  id TEXT PRIMARY KEY NOT NULL CHECK (substr(id, 1, 5) = 'proj_' AND length(id) = 37 AND substr(id, 6) NOT GLOB '*[^0-9a-f]*'),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE CHECK (slug <> '' AND slug NOT GLOB '*[^a-z0-9-]*'),
  created_by_actor_id TEXT NOT NULL REFERENCES actors (id),
  created_at TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  archived_at TEXT CHECK (archived_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  ink TEXT NOT NULL DEFAULT 'clay' CHECK (ink IN (${INKS.map((ink) => `'${ink}'`).join(', ')})),
  tracker_connection_id TEXT REFERENCES connections (id),
  tracker_container_id TEXT CHECK (tracker_container_id IS NULL OR tracker_connection_id IS NOT NULL),
  tracker_container_name TEXT CHECK ((tracker_container_name IS NULL) = (tracker_container_id IS NULL))
) STRICT`,
  `INSERT INTO projects_new (${COLUMNS}) SELECT ${COLUMNS} FROM projects`,
  'DROP TABLE projects',
  'ALTER TABLE projects_new RENAME TO projects',
]
