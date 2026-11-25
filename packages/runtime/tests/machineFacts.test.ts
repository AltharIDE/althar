import { mkdtempSync } from 'node:fs'
import { release, tmpdir } from 'node:os'
import { join } from 'node:path'

import { removeTreeSync } from '@althar/testing'
import { Effect } from 'effect'
import { afterAll, describe, expect, it } from 'vitest'

import { machineFacts } from '../src/homeFolders'

/* What a home's machine says it is, on each system Althar's runtime may run on: a home's welcome shows it. */

const home = mkdtempSync(join(tmpdir(), 'althar-machine-'))
afterAll(() => removeTreeSync(home))

describe('a machine’s facts', () => {
  it('names the system as it names itself, wherever the runtime runs', async () => {
    const on = (platform: NodeJS.Platform) => Effect.runPromise(machineFacts(home, platform))
    expect((await on('darwin')).system).toMatch(/^macOS/)
    expect((await on('win32')).system).toBe(`Windows ${release()}`)
    expect((await on('freebsd')).system).toBe(`freebsd ${release()}`)
  })

  it('says the room on its disk, and none where the folder isn’t there', async () => {
    const facts = await Effect.runPromise(machineFacts(home, 'linux'))
    expect(facts.cores).toBeGreaterThan(0)
    expect(facts.disk?.size).toBeGreaterThan(0)
    expect((await Effect.runPromise(machineFacts(join(home, 'gone'), 'linux'))).disk).toBeNull()
  })
})
