import { clearPrepared } from './match'
import { search, type Ask, type Context, type Entry } from './model'

let entries: ReadonlyArray<Entry> = []
self.onmessage = (
  event: MessageEvent<
    { type: 'entries'; entries: ReadonlyArray<Entry> } | { type: 'query'; id: number; query: string; context: Context; ask: Ask }
  >,
) => {
  const message = event.data
  if (message.type === 'entries') {
    clearPrepared()
    entries = message.entries
  } else self.postMessage({ id: message.id, results: search(entries, message.query, message.context, message.ask).slice(0, 150) })
}
