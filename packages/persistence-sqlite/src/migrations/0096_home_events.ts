/* The home feed reads these few events on every refresh. Walk them in order without scanning the transcript. */
export const statements: ReadonlyArray<string> = [
  "CREATE INDEX thread_items_home_events ON thread_items (created_at DESC, sequence DESC) WHERE kind = 'step_result' OR (kind = 'notice' AND json_extract(content, '$.about') = 'stall')",
]
