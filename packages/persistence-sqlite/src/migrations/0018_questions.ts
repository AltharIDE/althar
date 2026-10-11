/*
 * A question an agent asks the person is an item of its thread, where it is
 * answered (DEV-13). Its call is an attention request of the kind `question`,
 * which the first schema already has.
 */
export const statements: ReadonlyArray<string> = [`INSERT INTO vocab_thread_item_kind (word) VALUES ('question')`]
