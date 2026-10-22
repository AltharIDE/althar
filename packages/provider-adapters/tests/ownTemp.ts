import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const NAMES = ['TMPDIR', 'TEMP', 'TMP'] as const

/**
 * Points the temporary folder at a fresh one of the test's own, so what it
 * leaves there can be counted without another file's agents, started beside
 * it in the shared one, counting too. `restore` puts the variables back and
 * removes the folder.
 */
export const ownTemp = () => {
  const folder = mkdtempSync(join(tmpdir(), 'althar-test-'))
  const saved = NAMES.map((name) => [name, process.env[name]] as const)
  for (const name of NAMES) process.env[name] = folder
  const restore = () => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    rmSync(folder, { recursive: true, force: true })
  }
  return { folder, restore }
}
