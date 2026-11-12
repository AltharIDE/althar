/*
 * What a turn said, found by its turn: the board and the home read, for each
 * task's card on every read, whether its lead answered since the person last
 * looked (replied.ts), and with no index on an item's turn each such read
 * went through every item in the store. In the person's store of 180,000
 * items that was a third of a second each time the board was read, with the
 * runtime's one thread waiting on it. The turns that recorded heads are
 * found by their thread the same way, without reading each turn's prompt.
 */
export const statements: ReadonlyArray<string> = [
  'CREATE INDEX thread_items_by_delivery ON thread_items (delivery_id, kind) WHERE delivery_id IS NOT NULL',
  'CREATE INDEX turn_deliveries_with_heads ON turn_deliveries (thread_id, delivered_at) WHERE heads IS NOT NULL',
]
