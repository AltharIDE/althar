import { entriesOf, type EntryChanges, nothingHeld, withChanges } from './held'
import { clearPrepared } from './match'
import { search, type Ask, type Context, type Entry } from './model'

/* What it ranks: the entries as the window last changed them, sent only where they changed (held.ts). */
let held = nothingHeld
let entries: ReadonlyArray<Entry> = []
self.onmessage = (
  event: MessageEvent<
    { type: 'entries'; changes: EntryChanges } | { type: 'query'; id: number; query: string; context: Context; ask: Ask }
  >,
) => {
  const message = event.data
  if (message.type === 'entries') {
    clearPrepared()
    held = withChanges(held, message.changes)
    entries = entriesOf(held)
  } else self.postMessage({ id: message.id, results: search(entries, message.query, message.context, message.ask).slice(0, 150) })
}
