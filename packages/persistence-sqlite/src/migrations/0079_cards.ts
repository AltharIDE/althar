/*
 * A task's card, as its board shows it, changed (the board keeps up): the
 * runtime works a task's card out again as a change of the task is recorded,
 * and says so on the client feed only where it came out different, so a
 * window reads its boards again on that alone.
 */
export const statements: ReadonlyArray<string> = ["INSERT INTO vocab_aggregate_type (word) VALUES ('card')"]
