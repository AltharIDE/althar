import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { catalog } from '../src/catalog'
import { BANNERS } from '../src/banners'
import { BORE, SECTION } from '../src/geometry'
import { COBALT, INK, PAPER, VIOLET } from '../src/palette'
import { INK_HEX } from '../src/project-marks'

/*
 * The mark is drawn in several places that can't import it: another package's
 * component, a favicon, a card's HTML. These tests hold each copy to the one
 * in src/geometry.ts, and hold what is committed in export/ to what the code
 * draws, so a change to either can't land alone.
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

describe('the mark in other places', () => {
  it.each(COPIES)('%s draws the section the brand package does', (path) => {
    expect(read(path)).toContain(SECTION)
  })

  it.each(COPIES.filter((p) => !p.endsWith('theme.ts')))('%s cuts the same bore', (path) => {
    expect(read(path)).toContain(BORE)
  })

  it('has the banners take it from the package, not draw it again', () => {
    const page = read('brand/banners/printed.html')
    expect(page).toContain('window.ALTHAR_MARK')
    expect(page).not.toContain(SECTION)
  })
})

describe('the colours in the interface', () => {
  const tokens = read('packages/ui/src/styles/tokens.css')
  const token = (name: string): string => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens)?.[1]?.toLowerCase() ?? ''

  it('are the brand colours', () => {
    expect(token('live')).toBe(COBALT)
    expect(token('signal')).toBe(VIOLET)
    expect(token('t-1')).toBe(INK)
    expect(token('n-2')).toBe(PAPER)
  })

  it.each(Object.entries(INK_HEX))('are the project ink %s', (ink, hex) => {
    expect(token(`project-${ink}`)).toBe(hex)
  })
})

describe('what is committed', () => {
  it('has the app icons the desktop app has', () => {
    for (const name of ['cobalt', 'cobalt-dark', 'paper', 'ink', 'solid', 'solid-dark']) {
      expect(read(`brand/export/app-icon/${name}.svg`), name).toBe(read(`apps/desktop/resources/icons/${name}.svg`))
    }
  })

  it('has every drawing as the code draws it', async () => {
    const { files } = await catalog()
    for (const f of files) expect(read(`brand/export/${f.file}`), `${f.file}: run bun run export`).toBe(f.content)
  })

  it('has every banner', () => {
    for (const b of BANNERS) expect(() => read(`brand/export/banner/${b.file}.png`)).not.toThrow()
  })
})
