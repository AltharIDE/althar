/*
 * Each card in Needs you the person settled with one press from where it
 * shows, the board or the home (DEV-173): what the press did, and whether the
 * task had gone unopened since the card came in. A card settled so, unopened,
 * likely had no decision in it, only a button Althar could have pressed; how
 * many there are over a week says what is left to take out of Needs you. It
 * stays on this computer, as all of the store does.
 */
export const statements: ReadonlyArray<string> = [
  `CREATE TABLE one_press_settles (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('merge', 'push', 'done', 'keep', 'resolve', 'carry_on', 'allow', 'reject')),
    unopened INTEGER NOT NULL CHECK (unopened IN (0, 1)),
    pressed_at TEXT NOT NULL
  ) STRICT`,
  'CREATE INDEX one_press_settles_by_time ON one_press_settles (pressed_at)',
]
