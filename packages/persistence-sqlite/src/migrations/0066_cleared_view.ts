/*
 * A coordinator's thread can have its view cleared: `view_from` is the
 * sequence where the cleared view begins (null when it hasn't been), and
 * `earlier_shown` says the conversation before it is open in the thread's
 * place. Both belong to the thread, so every window and every reload agrees.
 * The items themselves stay: an agent, a handover and read_thread still read
 * all of them. A thread made before this has no mark.
 *
 * The view asks whether a card still waits on the person, and so finds a
 * setting's change by the item that shows it: that read gets its index here.
 */
export const statements: ReadonlyArray<string> = [
  'ALTER TABLE threads ADD COLUMN view_from INTEGER CHECK (view_from >= 1)',
  'ALTER TABLE threads ADD COLUMN earlier_shown INTEGER NOT NULL DEFAULT 0 CHECK (earlier_shown IN (0, 1))',
  'CREATE INDEX setting_changes_by_item ON setting_changes(item_id) WHERE item_id IS NOT NULL',
]
