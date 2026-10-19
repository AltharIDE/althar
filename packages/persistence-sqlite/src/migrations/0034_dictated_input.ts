/*
 * Whether a message was dictated: any of its words came from the person's
 * voice, even if they typed edits after. Kept with the input, so a message
 * that waits in the queue, or is read again after a restart, still tells the
 * agent that reads it so. Every message before this was typed, as far as
 * Althar knows.
 */
export const statements: ReadonlyArray<string> = [
  'ALTER TABLE user_inputs ADD COLUMN dictated INTEGER NOT NULL DEFAULT 0 CHECK (dictated IN (0, 1))',
]
