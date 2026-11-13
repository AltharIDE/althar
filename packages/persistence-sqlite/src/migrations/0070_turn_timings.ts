/*
 * Where a turn's time went (a task is a conversation plus parts, "Where a
 * turn's time goes"): `turn_deliveries.timings` is JSON, written as the turn
 * ends, of how many milliseconds it spent waiting for a place among the
 * agents at work here (`place`), starting its session or handing it over
 * (`session`, with `starting` saying which), in the agent's own work
 * (`work`), and in the tools it ran (`tools`, part of `work`, counted once
 * where several ran at once). Null for a turn that hasn't ended, and for
 * every turn before this one, whose time is read from its delivery and end
 * as it was.
 *
 * Additive: a build before this one reads past the column.
 */
export const statements: ReadonlyArray<string> = ['ALTER TABLE turn_deliveries ADD COLUMN timings TEXT CHECK (json_valid(timings))']
