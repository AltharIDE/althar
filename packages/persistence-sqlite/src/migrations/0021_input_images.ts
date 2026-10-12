/*
 * The images the person sends with a message: each kept in the artifact
 * store, as a picture an agent hands back is, and named here by its input, in
 * the order they were sent, so every turn that delivers the input sends them
 * with its words, after a restart too. Never changed once written.
 */
export const statements: ReadonlyArray<string> = [
  `CREATE TABLE user_input_images (
  project_id TEXT NOT NULL REFERENCES projects (id),
  user_input_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 1),
  artifact_id TEXT NOT NULL,
  PRIMARY KEY (user_input_id, position),
  FOREIGN KEY (user_input_id, project_id) REFERENCES user_inputs (id, project_id),
  FOREIGN KEY (artifact_id, project_id) REFERENCES artifacts (id, project_id)
) STRICT`,
]
