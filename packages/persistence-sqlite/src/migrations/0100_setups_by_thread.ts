/* A card can find a thread's latest setup without scanning its transcript. */
export const statements: ReadonlyArray<string> = [
  "CREATE INDEX thread_items_setups_by_thread ON thread_items (thread_id, sequence DESC) WHERE kind = 'setup'",
]
