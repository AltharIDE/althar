import { createHash } from 'node:crypto'

/** JSON with object keys sorted, so equal values always produce equal text. Keys are unique, so no two compare equal. */
export const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).toSorted(([a], [b]) => (a < b ? -1 : 1)))
      : inner,
  ) ?? 'null'

export const sha256Hex = (text: string): string => createHash('sha256').update(text).digest('hex')
