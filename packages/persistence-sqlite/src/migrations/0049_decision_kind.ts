/*
 * What an ask or a refusal is counted as (ADR-071): one of the project's
 * kinds (`default-branch`, `outside`, …), what the rules can't read
 * (`unclear`), a command the project named, credentials and keys, the code
 * host, what a role that only reads may not do, or the rest. Null for what
 * went ahead by itself, and for decisions made before it was kept. The
 * project's rules show a tally of the last weeks by it.
 */
export const statements: ReadonlyArray<string> = ['ALTER TABLE decisions ADD COLUMN kind TEXT']
