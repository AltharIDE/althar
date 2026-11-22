/** Goals live with the thread. A cleared row retains its revision to fence late turns. */
export const statements: ReadonlyArray<string> = [
  `CREATE TABLE thread_goals (
    thread_id TEXT PRIMARY KEY NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    generation INTEGER NOT NULL CHECK (generation > 0),
    objective TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'blocked', 'complete', 'limited', 'cleared')),
    rounds INTEGER NOT NULL CHECK (rounds >= 0),
    round_limit INTEGER NOT NULL CHECK (round_limit > 0),
    launch_agent TEXT,
    launch_model TEXT,
    launch_effort TEXT,
    progress TEXT,
    detail TEXT
  ) STRICT`,
  `CREATE INDEX active_thread_goals ON thread_goals (thread_id) WHERE status = 'active'`,
  `ALTER TABLE turn_deliveries ADD COLUMN goal_revision INTEGER`,
  `ALTER TABLE turn_deliveries ADD COLUMN goal_round INTEGER NOT NULL DEFAULT 0 CHECK (goal_round IN (0, 1))`,
]
