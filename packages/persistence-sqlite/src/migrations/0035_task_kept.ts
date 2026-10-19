/*
 * A finished task that isn't a change, kept for later: the person took it
 * out of Needs you as it is, without settling it. When, kept; none until
 * then. The person writing to it again clears it, so the round that follows
 * ends in Needs you.
 */
export const statements: ReadonlyArray<string> = [
  `ALTER TABLE tasks ADD COLUMN kept_at TEXT CHECK (kept_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')`,
]
