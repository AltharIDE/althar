import { existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { LOGO_BORE, LOGO_SECTION } from '@althar/ui'

import { BORE, SECTION } from '../scripts/trayPictures'
import { readAppIcon, writeAppIcon } from '../src/main/appIcon'
import { edgeIn, notchIn, readEdge, writeEdge } from '../src/main/edge'

/*
 * Where Althar shows while the person is in another app: the notch AppKit
 * tells of, the choice kept beside the app's icon, and the menu bar's
 * pictures, drawn from the kit's mark.
 */

/** What osascript says on a MacBook Air 15 with a 27-inch screen beside it. */
const AIR_AND_SCREEN = JSON.stringify([
  { frame: [0, 0, 1470, 956], top: 32, left: [0, 646], right: [825, 645] },
  { frame: [1470, 499, 2560, 1440], top: 0, left: [0, 0], right: [0, 0] },
])

describe('the notch', () => {
  it('is where AppKit says, in Electron’s points from the primary screen’s top left', () => {
    expect(notchIn(AIR_AND_SCREEN, 956)).toEqual({ x: 646, y: 0, width: 179, height: 32 })
    // The notched screen under a primary one of 1440: AppKit counts up from the primary's foot, Electron down from its top.
    const below = JSON.stringify([{ frame: [0, -956, 1470, 956], top: 32, left: [0, 646], right: [825, 645] }])
    expect(notchIn(below, 1440)).toEqual({ x: 646, y: 1440, width: 179, height: 32 })
  })

  it('is none on screens without one, or in what can’t be read', () => {
    expect(notchIn(JSON.stringify([{ frame: [0, 0, 2560, 1440], top: 0, left: [0, 0], right: [0, 0] }]), 1440)).toBeNull()
    expect(notchIn('not json', 956)).toBeNull()
    expect(notchIn('{}', 956)).toBeNull()
    expect(notchIn(JSON.stringify([{ frame: [0, 0], top: 32 }, null]), 956)).toBeNull()
    expect(notchIn(JSON.stringify([{ frame: [0, 0, 1470, 956], top: 32, left: [0, 646], right: [600, 645] }]), 956)).toBeNull()
  })

  it('decides the island: without one, it is the menu bar, whatever was chosen', () => {
    const notch = { x: 646, y: 0, width: 179, height: 32 }
    expect(edgeIn('island', notch)).toBe('island')
    expect(edgeIn('menu', notch)).toBe('menu')
    expect(edgeIn('island', null)).toBe('menu')
  })
})

describe('the choice, kept in the profile', () => {
  it('is the island until one is made, or when what is kept isn’t a place', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'althar-edge-'))
    expect(await readEdge(profile)).toBe('island')
    writeFileSync(join(profile, 'desktop.json'), '{"edge":"dock"}')
    expect(await readEdge(profile)).toBe('island')
  })

  it('is kept beside the icon, both written at once', async () => {
    const profile = join(mkdtempSync(join(tmpdir(), 'althar-edge-')), 'new')
    await Promise.all([writeEdge(profile, 'menu'), writeAppIcon(profile, 'ink')])
    expect(await readEdge(profile)).toBe('menu')
    expect(await readAppIcon(profile)).toBe('ink')
  })
})

describe('the menu bar’s pictures', () => {
  it('are drawn from the kit’s mark', () => {
    expect(SECTION).toBe(LOGO_SECTION)
    expect(BORE).toBe(LOGO_BORE)
  })

  it('are there, at both sizes, as template images', () => {
    const tray = join(import.meta.dirname, '..', 'resources', 'tray')
    for (const name of ['markTemplate', 'markYoursTemplate'])
      for (const scale of ['', '@2x']) {
        const path = join(tray, `${name}${scale}.png`)
        expect(existsSync(path), path).toBe(true)
        expect(statSync(path).size).toBeGreaterThan(100)
      }
  })
})
