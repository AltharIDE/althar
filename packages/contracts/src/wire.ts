/** Versioned structured values for transports without structured clone. User values never collide with protocol tags. */
const MAX_DEPTH = 64
const MAX_VALUES = 1_000_000

const invalid = () => new Error('Invalid or excessively complex Althar wire message')
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const base64 = (bytes: Uint8Array): string => {
  const chunks: Array<string> = []
  for (let at = 0; at < bytes.length; at += 32_768) chunks.push(String.fromCharCode(...bytes.subarray(at, at + 32_768)))
  return btoa(chunks.join(''))
}

export const encodeWire = (value: unknown): string => {
  let values = 0
  const encode = (value: unknown, depth: number): unknown => {
    values += 1
    if (depth > MAX_DEPTH || values > MAX_VALUES) throw invalid()
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'undefined') return { type: 'undefined', value: null }
    if (typeof value === 'bigint') {
      const text = value.toString()
      if (text.length > 128) throw invalid()
      return { type: 'bigint', value: text }
    }
    if (value instanceof Uint8Array) return { type: 'bytes', value: base64(value) }
    if (Array.isArray(value)) return { type: 'array', value: value.map((part) => encode(part, depth + 1)) }
    if (record(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null))
      return { type: 'object', value: Object.entries(value).map(([key, part]) => [key, encode(part, depth + 1)]) }
    throw invalid()
  }
  return JSON.stringify({ version: 1, data: encode(value, 0) })
}

export const decodeWire = (text: string): unknown => {
  const wire: unknown = JSON.parse(text)
  if (!record(wire) || wire.version !== 1 || !('data' in wire)) throw invalid()
  let values = 0
  const decode = (value: unknown, depth: number): unknown => {
    values += 1
    if (depth > MAX_DEPTH || values > MAX_VALUES) throw invalid()
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (!record(value) || !('value' in value)) throw invalid()
    const part = value.value
    if (value.type === 'undefined' && part === null) return undefined
    if (value.type === 'bigint' && typeof part === 'string' && part.length <= 128 && /^-?(0|[1-9][0-9]*)$/.test(part)) return BigInt(part)
    if (value.type === 'bytes' && typeof part === 'string') {
      const decoded = atob(part)
      const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0))
      if (base64(bytes) !== part) throw invalid()
      return bytes
    }
    if (value.type === 'array' && Array.isArray(part)) return part.map((item) => decode(item, depth + 1))
    if (value.type === 'object' && Array.isArray(part)) {
      const entries: Array<[string, unknown]> = []
      const keys = new Set<string>()
      for (const entry of part) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || keys.has(entry[0])) throw invalid()
        keys.add(entry[0])
        entries.push([entry[0], decode(entry[1], depth + 1)])
      }
      return Object.fromEntries(entries)
    }
    throw invalid()
  }
  return decode(wire.data, 0)
}
