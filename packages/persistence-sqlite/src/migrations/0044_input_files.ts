/*
 * The files and folders the person sends with a message: each copied where
 * the thread's agent reads (the task's folder, or the coordinator's, under
 * `.althar/attachments`), and named here by its input, in the order they
 * were sent, with what it is and where its copy is, so every turn that
 * delivers the input links the copy in its prompt, after a restart too, and
 * the thread shows them. Never changed once written.
 */
export const statements: ReadonlyArray<string> = [
  `CREATE TABLE user_input_files (
  project_id TEXT NOT NULL REFERENCES projects (id),
  user_input_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 1),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
  kind TEXT NOT NULL CHECK (kind IN ('file', 'folder')),
  media_type TEXT,
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  entries INTEGER CHECK ((entries IS NULL) = (kind = 'file') AND (entries IS NULL OR entries >= 0)),
  path TEXT NOT NULL CHECK (length(path) >= 1),
  PRIMARY KEY (user_input_id, position),
  FOREIGN KEY (user_input_id, project_id) REFERENCES user_inputs (id, project_id)
) STRICT`,
]
