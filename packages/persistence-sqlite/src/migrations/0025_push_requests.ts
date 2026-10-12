/*
 * A thread item for the lead asking the person to push its new commits to
 * the task's pull request: the commits that would go up, with a Push that
 * is the person's to press. Althar posts it and keeps it current.
 */
export const statements: ReadonlyArray<string> = ["INSERT INTO vocab_thread_item_kind (word) VALUES ('push_request')"]
