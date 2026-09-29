/*
 * A permission decision can reach the rest of the turn. Some agents offer
 * nothing narrower for a request to go beyond their sandbox (Codex allows a
 * permission profile for the turn), so allowing it once is allowing it for the
 * turn, and the record says so.
 */
export const statements: ReadonlyArray<string> = ["INSERT INTO vocab_decision_scope (word) VALUES ('turn')"]
