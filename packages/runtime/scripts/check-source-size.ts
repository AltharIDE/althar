import { globSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = join(import.meta.dirname, '../src')
const limit = 4_000

// Existing files can shrink to the shared limit without blocking unrelated changes.
const legacyLimits: Readonly<Record<string, number>> = {
  'Queries.ts': 5_039,
  'Runs.ts': 9_323,
  'Sessions.ts': 5_691,
  'rules.ts': 5_376,
}

const paths = globSync('**/*.{ts,tsx,mts,cts}', { cwd: source })

for (const path of [...paths].sort()) {
  const relative = path.replaceAll('\\', '/')
  const text = readFileSync(join(source, path), 'utf8')
  const lines = text === '' ? 0 : text.split(/\r\n|\n|\r/).length - Number(/[\r\n]$/.test(text))
  const max = legacyLimits[relative] ?? limit
  if (lines <= max) continue
  console.error(`src/${relative} has ${lines} lines (limit ${max}). Split the file along its responsibilities.`)
  process.exitCode = 1
}
