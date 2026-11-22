/* The search catalog dates each task by its newest thread item without scanning its entire history. */
export const statements: ReadonlyArray<string> = ['CREATE INDEX thread_items_by_thread_date ON thread_items (thread_id, created_at DESC)']
