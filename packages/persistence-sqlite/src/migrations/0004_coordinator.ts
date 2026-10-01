/*
 * The coordinator's thread holds its tasks as items of their own: a task's
 * plan before it starts, then its card as it runs, kept current by Charrette.
 */
export const statements: ReadonlyArray<string> = ["INSERT INTO vocab_thread_item_kind (word) VALUES ('task')"]
