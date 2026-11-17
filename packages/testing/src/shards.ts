import { globSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export type Durations = Readonly<Record<string, number>>
const root = fileURLToPath(new URL('../../..', import.meta.url))
export const fromRepository = (file: string) => relative(root, file).replaceAll('\\', '/')

/** Timing history affects placement only. A missing or damaged history never excludes a file. */
export const durations = (platform = process.platform): Durations => {
  try {
    const saved = JSON.parse(readFileSync(new URL('../durations.json', import.meta.url), 'utf8')) as {
      readonly platforms?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
    }
    return Object.fromEntries(
      Object.entries(saved.platforms?.[platform] ?? {}).filter(
        (entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0,
      ),
    )
  } catch {
    return {}
  }
}

/** Largest files first, each on the least loaded shard; ties are independent of locale and discovery order. */
export const balance = <T>(
  files: ReadonlyArray<T>,
  count: number,
  key: (file: T) => string,
  history: Durations,
): ReadonlyArray<Array<T>> => {
  if (!Number.isInteger(count) || count < 1 || count > 128) throw new Error('Invalid shard count')
  if (new Set(files.map(key)).size !== files.length) throw new Error('Duplicate test file in shard inventory')
  const measured = files.map((file) => history[key(file)]).filter((ms): ms is number => ms !== undefined && Number.isFinite(ms) && ms > 0)
  measured.sort((a, b) => a - b)
  const fallback = measured[Math.floor(measured.length / 2)] ?? 1
  const cost = (file: T) => {
    const ms = history[key(file)]
    return ms !== undefined && Number.isFinite(ms) && ms > 0 ? ms : fallback
  }
  const ordered = [...files].sort((a, b) => cost(b) - cost(a) || (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
  const shards = Array.from({ length: count }, () => ({ files: [] as Array<T>, milliseconds: 0 }))
  for (const file of ordered) {
    const next = shards.reduce((best, shard) => (shard.milliseconds < best.milliseconds ? shard : best))
    next.files.push(file)
    next.milliseconds += cost(file)
  }
  return shards.map((shard) => shard.files)
}

export const shardNumber = (part: string): { readonly index: number; readonly count: number } => {
  const match = /^(\d+)\/(\d+)$/.exec(part)
  const index = Number(match?.[1])
  const count = Number(match?.[2])
  if (!Number.isInteger(index) || !Number.isInteger(count) || index < 1 || index > count || count > 128)
    throw new Error(`Invalid shard: ${part}`)
  return { index, count }
}

/** The same spec/test extensions Playwright discovers by default, including newly added files. */
export const playwrightShard = (directory: string, part: string): ReadonlyArray<RegExp> => {
  const { index, count } = shardNumber(part)
  const files = globSync('e2e/**/*', { cwd: directory })
    .filter((file) => /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(file))
    .map((file) => join(directory, file))
  const selected = balance(files, count, fromRepository, durations())[index - 1] ?? []
  // RegExp, not CLI/glob patterns: a file's punctuation cannot select a different spec.
  return selected.map((file) => new RegExp(`^${file.replaceAll('\\', '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
}
