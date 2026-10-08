/*
 * A message waiting its turn can be taken back before the agent reads it:
 * the person edits it or drops it. It stays in the record, as withdrawn.
 */
export const statements: ReadonlyArray<string> = [`INSERT INTO vocab_user_input_state (word) VALUES ('withdrawn')`]
