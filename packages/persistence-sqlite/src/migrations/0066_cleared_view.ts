/*
 * A coordinator's thread can have its view cleared: `view_from` is the
 * sequence where the cleared view begins (null when it hasn't been), and
 * `earlier_shown` says the conversation before it is open in the thread's
 * place. Both belong to the thread, so every window and every reload agrees.
 * The items themselves stay: an agent, a handover and read_thread still read
 * all of them. A thread made before this has no mark.
 */
export const statements: ReadonlyArray<string> = [
  'ALTER TABLE threads ADD COLUMN view_from INTEGER CHECK (view_from >= 1)',
  'ALTER TABLE threads ADD COLUMN earlier_shown INTEGER NOT NULL DEFAULT 0 CHECK (earlier_shown IN (0, 1))',
]
