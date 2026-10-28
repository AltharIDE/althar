/*
 * The person's messages to the coordinator a task's request was made from,
 * in their order: the images and files they sent with them are the task's
 * too, read where those messages keep them (user_input_images and
 * user_input_files), never copied, so its thread opens with them and its
 * lead's first turn is sent them. Never changed once written.
 */
export const statements: ReadonlyArray<string> = [
  `CREATE TABLE task_request_inputs (
  project_id TEXT NOT NULL REFERENCES projects (id),
  task_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 1),
  user_input_id TEXT NOT NULL,
  PRIMARY KEY (task_id, position),
  FOREIGN KEY (task_id, project_id) REFERENCES tasks (id, project_id),
  FOREIGN KEY (user_input_id, project_id) REFERENCES user_inputs (id, project_id)
) STRICT`,
]
