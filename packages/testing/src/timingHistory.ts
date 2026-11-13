import { globSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Durations } from './shards'

/** Each artifact is one job: sum a spec's test attempts, then take the median across measured jobs/runs. */
export const timingHistory = (artifacts: ReadonlyArray<string>): Readonly<Record<string, Durations>> => {
  const samples = new Map<string, Array<number>>()
  for (const artifact of artifacts) {
    const totals = new Map<string, number>()
    for (const line of artifact.split('\n').filter(Boolean)) {
      const record = JSON.parse(line) as { platform?: unknown; file?: unknown; milliseconds?: unknown }
      if (
        typeof record.platform !== 'string' ||
        !['linux', 'win32', 'darwin'].includes(record.platform) ||
        typeof record.file !== 'string' ||
        !/^(?:(?:packages|apps)\/[^/]+|brand)\/.+\.(?:test|spec)\.[cm]?[jt]sx?$/.test(record.file) ||
        record.file.split('/').some((part) => part === '..' || part === '.') ||
        typeof record.milliseconds !== 'number' ||
        !Number.isFinite(record.milliseconds) ||
        record.milliseconds <= 0
      )
        throw new Error('Invalid timing record')
      const key = `${record.platform}:${record.file}`
      totals.set(key, (totals.get(key) ?? 0) + record.milliseconds)
    }
    for (const [key, total] of totals) samples.set(key, [...(samples.get(key) ?? []), total])
  }
  const platforms: Record<string, Record<string, number>> = {}
  for (const [key, values] of [...samples].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const [platform = '', file = ''] = key.split(':')
    values.sort((a, b) => a - b)
    const middle = Math.floor(values.length / 2)
    const median = values.length % 2 === 0 ? ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2 : (values[middle] ?? 0)
    ;(platforms[platform] ??= {})[file] = Math.round(median)
  }
  return platforms
}

// Refresh from a chosen full post-merge run's downloaded test-timings-* artifacts.
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/timingHistory.ts') && process.argv[2] !== undefined) {
  const directory = process.argv[2]
  const artifacts = globSync('**/*.jsonl', { cwd: directory }).map((file) => readFileSync(join(directory, file), 'utf8'))
  if (artifacts.length === 0) throw new Error('No timing artifacts found')
  const file = new URL('../durations.json', import.meta.url)
  const previous = JSON.parse(readFileSync(file, 'utf8')) as { platforms: Record<string, Durations> }
  for (const [platform, entries] of Object.entries(timingHistory(artifacts)))
    previous.platforms[platform] = { ...previous.platforms[platform], ...entries }
  writeFileSync(file, `${JSON.stringify({ source: process.argv[3] ?? directory, platforms: previous.platforms }, null, 2)}\n`)
}
