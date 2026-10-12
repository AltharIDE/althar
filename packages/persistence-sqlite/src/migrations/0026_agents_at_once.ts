/*
 * Work that waits for a place among the agents this machine runs at once
 * (DEV-58, ADR-031), kept so a restart doesn't lose it. A step that can't
 * start is held, why being `machine_busy`, with how it starts once a place
 * frees in its output. A conflict round whose lead can't be asked yet keeps
 * the ask it waits to make, and since when, in `waiting`: null once asked.
 * How many may be at once is a setting, only where the person changed it.
 */
export const statements: ReadonlyArray<string> = [
  "INSERT INTO vocab_hold_reason (word) VALUES ('machine_busy')",
  'ALTER TABLE conflict_resolutions ADD COLUMN waiting TEXT CHECK (json_valid(waiting))',
]
