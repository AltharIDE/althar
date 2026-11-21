/*
 * The person's own tuning of a built-in preset (a task is a conversation plus parts, "Presets"): a built-in names no model,
 * and the person may set its lead, reviewer, their efforts and its brief as their own, by the built-in's id. `parts` is
 * JSON of only what they set; removing the row takes the built-in back to its default.
 */
export const statements: ReadonlyArray<string> = [
  `CREATE TABLE preset_tunings (
    preset_id TEXT PRIMARY KEY NOT NULL CHECK (preset_id GLOB 'builtin:*'),
    parts TEXT NOT NULL CHECK (json_valid(parts)),
    updated_at TEXT NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
  ) STRICT`,
]
