/*
 * Usage limits (docs/architecture/03 and 05).
 *
 * What a project does when an agent's account reaches its usage limit, move
 * the work on or wait for the reset, is one of the project's rules: a new
 * revision of its policy when the person changes it, which runs cite. A
 * revision is recorded as a fact of its own.
 */
export const statements: ReadonlyArray<string> = ["INSERT INTO vocab_aggregate_type (word) VALUES ('policy')"]
