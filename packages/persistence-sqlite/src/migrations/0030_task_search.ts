import { at, index, project, sameProject, scoped, table } from './0001_initial/columns'

/*
 * Finding a task by what it was about (DEV-96, ADR-035): its title, what
 * the person asked of it, what its lead reported and built, its pull
 * requests' numbers and its issue's key, its branches, and the files its
 * lead changed. Each task has one row of that text, which the runtime writes
 * whenever one of them changes (its Search.ts), and SQLite's full-text index
 * (FTS5) reads the row: the index keeps no copy of the text, and the
 * triggers keep it in step with the rows, as FTS5's external content tables
 * are kept. Words are split as Unicode says, accents set aside, and never
 * stemmed, so a word typed part way finds every word it begins. The row's
 * integer key is the index's; `changed_at` is when what it holds last
 * changed, for putting recent tasks first.
 */
const columns = ['title', 'asked', 'summaries', 'refs', 'files']
const fresh = columns.map((column) => `new.${column}`).join(', ')
const old = columns.map((column) => `old.${column}`).join(', ')

export const statements: ReadonlyArray<string> = [
  table(
    'task_search_rows',
    [
      'id INTEGER PRIMARY KEY NOT NULL',
      scoped('task_id'),
      project(),
      ...columns.map((column) => `${column} TEXT NOT NULL DEFAULT ''`),
      at('changed_at'),
    ],
    ['UNIQUE (task_id)', sameProject('task_id', 'tasks')],
  ),
  index('task_search_rows_by_project', 'task_search_rows (project_id)'),
  `CREATE VIRTUAL TABLE task_search USING fts5(${columns.join(', ')}, content='task_search_rows', content_rowid='id', tokenize='unicode61 remove_diacritics 2')`,
  `CREATE TRIGGER task_search_added AFTER INSERT ON task_search_rows BEGIN
  INSERT INTO task_search (rowid, ${columns.join(', ')}) VALUES (new.id, ${fresh});
END`,
  `CREATE TRIGGER task_search_removed AFTER DELETE ON task_search_rows BEGIN
  INSERT INTO task_search (task_search, rowid, ${columns.join(', ')}) VALUES ('delete', old.id, ${old});
END`,
  `CREATE TRIGGER task_search_changed AFTER UPDATE ON task_search_rows BEGIN
  INSERT INTO task_search (task_search, rowid, ${columns.join(', ')}) VALUES ('delete', old.id, ${old});
  INSERT INTO task_search (rowid, ${columns.join(', ')}) VALUES (new.id, ${fresh});
END`,
]
