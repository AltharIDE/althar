import type { Entry } from './model'

/*
 * What the ranking worker holds of the entries, and what changed in them
 * since. The catalog is read again whenever anything changes, and its
 * entries are made afresh each time, though few of them differ: posting
 * them all would copy every task, note and passage across on the window's
 * thread at each change. So only those that changed cross, each by its key,
 * with the keys in order where any came, went or moved.
 */

/** Each entry by its key, and the keys in order. */
export interface Held {
  readonly byKey: ReadonlyMap<string, Entry>
  readonly order: ReadonlyArray<string>
}

export const nothingHeld: Held = { byKey: new Map(), order: [] }

/** What changed: the entries new or changed, by key; and every key in order, where any came, went or moved. */
export interface EntryChanges {
  readonly put: ReadonlyArray<readonly [string, Entry]>
  readonly order?: ReadonlyArray<string>
}

/** Each entry's key: its id, and which of that id it is where two share one. */
const keysOf = (entries: ReadonlyArray<Entry>) => {
  const seen = new Map<string, number>()
  return entries.map((entry) => {
    const n = seen.get(entry.id) ?? 0
    seen.set(entry.id, n + 1)
    return n === 0 ? entry.id : `${entry.id}\u0000${n}`
  })
}

/** Whether two values read alike: the same values in arrays and plain objects, all the way down. */
export const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b))
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((one: unknown, at) => same(one, b[at]))
  const keys = Object.keys(a)
  return (
    keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && same(Reflect.get(a, key), Reflect.get(b, key)))
  )
}

/** What changed from what is held to these entries; null where nothing did. */
export const changesTo = (held: Held, entries: ReadonlyArray<Entry>): EntryChanges | null => {
  const keys = keysOf(entries)
  const moved = keys.length !== held.order.length || keys.some((key, at) => held.order[at] !== key)
  const put: Array<readonly [string, Entry]> = []
  entries.forEach((entry, at) => {
    const key = keys[at] ?? entry.id
    const was = held.byKey.get(key)
    if (was === undefined || !same(was, entry)) put.push([key, entry])
  })
  if (put.length === 0 && !moved) return null
  return moved ? { put, order: keys } : { put }
}

/** What is held once the changes are in. */
export const withChanges = (held: Held, changes: EntryChanges): Held => {
  const byKey = new Map(held.byKey)
  for (const [key, entry] of changes.put) byKey.set(key, entry)
  if (changes.order === undefined) return { byKey, order: held.order }
  const kept = new Set(changes.order)
  for (const key of byKey.keys()) if (!kept.has(key)) byKey.delete(key)
  return { byKey, order: changes.order }
}

/** All that is held, as changes: what a worker that holds nothing yet is sent. */
export const allOf = (held: Held): EntryChanges => ({ put: [...held.byKey], order: held.order })

/** The entries held, in order. */
export const entriesOf = (held: Held): Entry[] =>
  held.order.flatMap((key) => {
    const entry = held.byKey.get(key)
    return entry === undefined ? [] : [entry]
  })
