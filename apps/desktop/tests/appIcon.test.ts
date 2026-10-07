import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readAppIcon, writeAppIcon } from '../src/main/appIcon'

/* The icon the main process keeps in the profile's desktop.json. */

const profile = () => mkdtempSync(join(tmpdir(), 'althar-icon-'))

describe('the app icon kept in the profile', () => {
  it('is cobalt until one is chosen, or when what is kept is not an icon', async () => {
    const empty = profile()
    expect(await readAppIcon(empty)).toBe('cobalt')
    writeFileSync(join(empty, 'desktop.json'), '{"icon":"neon"}')
    expect(await readAppIcon(empty)).toBe('cobalt')
    writeFileSync(join(empty, 'desktop.json'), '[1]')
    expect(await readAppIcon(empty)).toBe('cobalt')
    writeFileSync(join(empty, 'desktop.json'), 'not json')
    expect(await readAppIcon(empty)).toBe('cobalt')
  })

  it('keeps a choice, and whatever else the file holds, making the profile where there is none', async () => {
    const at = join(profile(), 'new')
    await writeAppIcon(at, 'ink')
    expect(await readAppIcon(at)).toBe('ink')
    writeFileSync(join(at, 'desktop.json'), '{"icon":"ink","other":1}')
    await writeAppIcon(at, 'solid-dark')
    expect(JSON.parse(readFileSync(join(at, 'desktop.json'), 'utf8'))).toEqual({ icon: 'solid-dark', other: 1 })
  })
})
