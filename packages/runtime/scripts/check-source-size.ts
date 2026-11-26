import { globSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = join(import.meta.dirname, '../src')
const limit = 4_000

// Files the limit leaves until they are split along their responsibilities, each with the split it waits for. Cut by
// size alone, a file comes apart where its lines run out, as Runs did, into parts that imported it back through its
// re-exports (DEV-274). Remove each entry when its file is split.
const unsplit: ReadonlySet<string> = new Set([
  // By screen: each screen's reads a module of the read layer.
  'Queries.ts',
])

const paths = globSync('**/*.{ts,tsx,mts,cts}', { cwd: source })

for (const path of [...paths].sort()) {
  const relative = path.replaceAll('\\', '/')
  if (unsplit.has(relative)) continue
  const text = readFileSync(join(source, path), 'utf8')
  const lines = text === '' ? 0 : text.split(/\r\n|\n|\r/).length - Number(/[\r\n]$/.test(text))
  if (lines <= limit) continue
  console.error(
    `src/${relative} has ${lines} lines (limit ${limit}). Split it along its responsibilities, not its length: each part a module ` +
      `with one job, placed in its layer (packages/runtime/layers.js), and its importers importing each name from the part that ` +
      `makes it. Not a file left behind that re-exports the parts, nor a bag of dependencies handed to them.`,
  )
  process.exitCode = 1
}
