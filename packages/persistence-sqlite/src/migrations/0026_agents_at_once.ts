/*
 * Work that waits for a place among the agents this machine runs at once
 * (DEV-58, ADR-031), kept so a restart doesn't lose it. A step that can't
 * start is held, why being `machine_busy`, with how it starts once a place
 * frees in its output. A conflict round whose lead can't be asked yet keeps
 * the ask it waits to make, and since when, in `waiting`: null once asked.
 * A lead's or a reviewer's turn that waits for a place, what it delivers
 * queued in its thread, keeps since when on the thread, in
 * `waits_for_place`: null once it has one, or its agent is stopped.
 * How many may be at once is a setting, only where the person changed it.
 */
export const statements: ReadonlyArray<string> = [
  "INSERT INTO vocab_hold_reason (word) VALUES ('machine_busy')",
  'ALTER TABLE conflict_resolutions ADD COLUMN waiting TEXT CHECK (json_valid(waiting))',
  "ALTER TABLE threads ADD COLUMN waits_for_place TEXT CHECK (waits_for_place GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')",
]
