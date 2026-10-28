/*
 * Pictures a lead shows the person in its thread at any time, step or no
 * step, are an item of their own: each with its caption, kept in the
 * artifact store as a step's screenshots are.
 */
export const statements: ReadonlyArray<string> = ["INSERT INTO vocab_thread_item_kind (word) VALUES ('pictures')"]
