/* Seek to a project's settled history and the catalog's recent public passages. */
export const statements: ReadonlyArray<string> = [
  "CREATE INDEX tasks_settled_by_project ON tasks (project_id, settled_at DESC, id DESC) WHERE state IN ('done', 'abandoned')",
  "CREATE INDEX thread_items_search_passages ON thread_items (id DESC) WHERE kind IN ('user_message', 'agent_message', 'step_result', 'arrival')",
]
