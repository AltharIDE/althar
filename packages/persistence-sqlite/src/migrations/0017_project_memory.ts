/** A rebuildable evidence projection; retirement is deliberate user state. */
export const statements: ReadonlyArray<string> = [
  `CREATE UNIQUE INDEX thread_items_project_identity ON thread_items(id,project_id)`,
  `CREATE TABLE memory_source_bases (
    id TEXT PRIMARY KEY NOT NULL REFERENCES thread_items(id),
    bases TEXT NOT NULL CHECK(json_valid(bases))
  ) STRICT`,
  `CREATE TRIGGER memory_source_capture AFTER INSERT ON thread_items BEGIN
    INSERT INTO memory_source_bases(id,bases)
      SELECT new.id,coalesce(json_group_array(json_object('repository',w.binding_id,'ref',w.base_ref,'commit',w.base_commit,'branch',w.branch)),'[]')
      FROM workspaces w JOIN threads t ON t.task_id=w.task_id AND t.project_id=w.project_id
      WHERE t.id=new.thread_id AND w.project_id=new.project_id;
  END`,
  `CREATE TABLE project_memory (
    id TEXT PRIMARY KEY NOT NULL REFERENCES thread_items(id),
    project_id TEXT NOT NULL REFERENCES projects(id),
    text TEXT NOT NULL,
    source_revision INTEGER NOT NULL CHECK(source_revision >= 1),
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
    state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active', 'retired')),
    bases TEXT NOT NULL CHECK(json_valid(bases)),
    FOREIGN KEY(id,project_id) REFERENCES thread_items(id,project_id)
  ) STRICT`,
  `CREATE INDEX project_memory_by_project ON project_memory(project_id)`,
  `CREATE TABLE project_memory_history (
    id TEXT NOT NULL REFERENCES project_memory(id),
    source_revision INTEGER NOT NULL CHECK(source_revision >= 1),
    text TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    PRIMARY KEY(id, source_revision)
  ) STRICT`,
  `CREATE VIRTUAL TABLE project_memory_fts USING fts5(id UNINDEXED, text, tokenize='unicode61')`,
  `CREATE TRIGGER project_memory_insert AFTER INSERT ON project_memory BEGIN
    INSERT INTO project_memory_fts(id,text) VALUES(new.id,new.text);
  END`,
  `CREATE TRIGGER project_memory_update AFTER UPDATE OF text ON project_memory BEGIN
    DELETE FROM project_memory_fts WHERE id=old.id;
    INSERT INTO project_memory_fts(id,text) VALUES(new.id,new.text);
  END`,
]
