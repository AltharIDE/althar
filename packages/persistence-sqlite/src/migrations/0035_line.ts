/*
 * The line of tasks waiting for a free agent before any agent has worked on
 * them, in the person's order (ADR-037): each starts in the order of since
 * when it waits, unless the person moved it, when `line_at` is the time it
 * stands at in its place. A task that joins later waits since later, so it
 * goes to the end. Null once the person puts the line back oldest first, or
 * the task starts.
 */
export const statements: ReadonlyArray<string> = [
  "ALTER TABLE tasks ADD COLUMN line_at TEXT CHECK (line_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')",
]
