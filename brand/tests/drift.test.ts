import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { drawnFrom } from '../src/aurora'
import { catalog } from '../src/catalog'
import { BORE, SECTION } from '../src/geometry'
import { COBALT, INK, PAPER, VIOLET } from '../src/palette'

/*
 * What the pack keeps in step with the rest of the repository. The mark is
 * drawn in places that can't import it (another package's component, a
 * favicon, a card's HTML); the colours are the interface's; the app icons are
 * the desktop app's; export/ is what the code draws, and the wallpapers what
 * the launch draws. Each of these goes wrong
 * silently when one side changes alone.
 */

const repo = resolve(import.meta.dirname, '../..')
const read = (path: string): string => readFileSync(resolve(repo, path), 'utf8')

const COPIES = [
  'packages/ui/src/foundations/Logo/Logo.tsx',
  'packages/ui/.storybook/theme.ts',
  'packages/ui/.storybook/public/favicon.svg',
  'apps/pitch/src/components/Logo.tsx',
  'apps/pitch/public/favicon.svg',
  'apps/pitch/scripts/og.html',
  'apps/site/public/favicon.svg',
]

describe('the pack and the repository', () => {
  it('draws the mark as every copy of it does', () => {
    for (const path of COPIES) {
      expect(read(path), path).toContain(SECTION)
      /* Storybook's theme draws the section alone, as a tile */
      if (!path.endsWith('theme.ts')) expect(read(path), path).toContain(BORE)
    }
  })

  it("uses the interface's colours", () => {
    const tokens = read('packages/ui/src/styles/tokens.css')
    const token = (name: string): string => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens)?.[1]?.toLowerCase() ?? ''
    expect({ cobalt: token('live'), violet: token('signal'), ink: token('t-1'), paper: token('n-2') }).toEqual({
      cobalt: COBALT,
      violet: VIOLET,
      ink: INK,
      paper: PAPER,
    })
  })

  it("has the desktop app's icons", () => {
    for (const name of ['cobalt', 'cobalt-dark', 'paper', 'ink', 'solid', 'solid-dark']) {
      expect(read(`brand/export/app-icon/${name}.svg`), name).toBe(read(`apps/desktop/resources/icons/${name}.svg`))
    }
  })

  it('has the wallpapers as the launch and their page draw them now: after changing either, run bun run export:wallpapers', () => {
    expect(JSON.parse(read('brand/wallpapers/drawn-from.json'))).toEqual(drawnFrom())
  })

  it('has every drawing as the code draws it: after changing one, run bun run export', async () => {
    const { files } = await catalog()
    for (const f of files) expect(read(`brand/export/${f.file}`), f.file).toBe(f.content)
  })
})
