/*
 * Pins Claude Code's and Codex's own programs at the versions the adapters' lockfile resolves (bun.lock), for each
 * platform their makers publish: the npm package, its address, its sha512 integrity, and its size, asked of npm.
 * Writes src/pinnedPrograms.ts. Run it after the adapters move (`bun scripts/pinPrograms.ts`); a test checks the pins
 * against the lockfile, so they can't drift apart.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { pinsFromLock } from '../src/pinnedLock'

const root = join(import.meta.dirname, '..', '..', '..')
const pins = pinsFromLock(readFileSync(join(root, 'bun.lock'), 'utf8'))

const sized = async () => {
  const out: Record<string, unknown> = {}
  for (const [agent, pin] of Object.entries(pins)) {
    const assets: Record<string, unknown> = {}
    for (const [target, asset] of Object.entries(pin.assets)) {
      // npm's CDN says no length to a HEAD; a range of one byte says the whole in Content-Range.
      const answer = await fetch(asset.tarball, { headers: { range: 'bytes=0-0' } })
      await answer.body?.cancel()
      const bytes = Number(/\/(\d+)$/u.exec(answer.headers.get('content-range') ?? '')?.[1])
      if (!answer.ok || !Number.isSafeInteger(bytes) || bytes <= 0) throw new Error(`npm didn't say how big ${asset.tarball} is.`)
      assets[target] = { ...asset, bytes }
    }
    out[agent] = { ...pin, assets }
  }
  return out
}

const body = JSON.stringify(await sized(), null, 2)
writeFileSync(
  join(import.meta.dirname, '..', 'src', 'pinnedPrograms.ts'),
  `// Written by scripts/pinPrograms.ts from bun.lock; tests/pinnedPrograms.test.ts checks it against the lockfile.\n` +
    `import type { ProgramPins } from './pinnedLock'\n\n` +
    `export const PINNED_PROGRAMS: ProgramPins = ${body}\n`,
)
