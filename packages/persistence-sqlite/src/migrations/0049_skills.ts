/*
 * Skills (ADR-008, docs/architecture/06): what the person installs, turns
 * on or off, rolls back or removes is recorded as their act, by the skill's
 * id, beside the store's installs.json, which says only what is installed
 * now. Which skills a session was given is on its own record.
 */
export const statements: ReadonlyArray<string> = ["INSERT INTO vocab_aggregate_type (word) VALUES ('skill')"]
