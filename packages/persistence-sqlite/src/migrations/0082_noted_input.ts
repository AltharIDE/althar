/*
 * What Althar tells a lead that needs nothing done, a heads-up of another
 * task changing the same files, or news of a task already merged or settled,
 * starts no turn of its own: it waits, noted, and the lead reads it with its
 * next turn, whatever starts that.
 */
export const statements: ReadonlyArray<string> = [`INSERT INTO vocab_user_input_state (word) VALUES ('noted')`]
