/*
 * A thread item for the coordinator asking the person to stop, hold,
 * restart or settle a task, where no message of theirs asked it to
 * (ADR-086): one button that does it as their press. Althar posts it and
 * keeps it current.
 */
export const statements: ReadonlyArray<string> = ["INSERT INTO vocab_thread_item_kind (word) VALUES ('task_ask')"]
