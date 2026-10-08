import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'
import { decompress } from 'wawoff2'

import { fontFile, openFont } from '../src/fonts'

import { EM, lockupSvg, outline } from '../src/lockup'
import { MARK_STYLES } from '../src/mark'

const viewBox = (svg: string): [number, number, number, number] =>
  (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? '').split(' ').map(Number) as [number, number, number, number]

describe('the wordmark', () => {
  it('is set as the browser sets it: Inter at 650, tracked tight', async () => {
    const { left, right, top, d } = await outline('Althar')
    /* 300px of Inter at 650 with -0.045em tracking spans 2.543em in Chromium */
    expect((right - left) / EM).toBeCloseTo(2.55, 1)
    expect(top / EM).toBeCloseTo(0.727, 1)
    expect(d.startsWith('M')).toBe(true)
  })

  it('moves with its tracking', async () => {
    const tight = await outline('Althar', { weight: 650, opsz: 32, tracking: -0.045, features: [] })
    const loose = await outline('Althar', { weight: 650, opsz: 32, tracking: 0, features: [] })
    expect(loose.right).toBeGreaterThan(tight.right)
  })

  it('draws a space as nothing and still advances', async () => {
    const one = await outline('A B')
    expect(one.d).toContain('M')
    expect(one.right).toBeGreaterThan((await outline('AB')).right)
  })
})

describe('the lockups', () => {
  it('sets the mark beside the name, the section standing on the baseline', async () => {
    const svg = await lockupSvg('horizontal', { ...MARK_STYLES.ink, text: '#141417' })
    const [x, y, w, h] = viewBox(svg)
    expect(x).toBe(0)
    expect(y).toBeLessThan(0)
    expect(y + h).toBe(0)
    expect(w / h).toBeGreaterThan(4)
    expect(w / h).toBeLessThan(5.5)
  })

  it('stacks the mark over the name, centred', async () => {
    const svg = await lockupSvg('stacked', { ...MARK_STYLES.ink, text: '#141417' })
    const [x, y, w, h] = viewBox(svg)
    expect([x, y]).toEqual([0, 0])
    expect(h).toBeGreaterThan(w / 2.5)
    expect(h).toBeLessThan(w)
  })

  it('colours the name as it is told', async () => {
    expect(await lockupSvg('horizontal', { section: '#fff', text: '#abcdef' })).toContain('fill="#abcdef"')
  })
})

describe('fonts', () => {
  it('open a plain TrueType file as well as a packed one, and open each once', async () => {
    const packed = fontFile('@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2')
    const plain = path.join(await mkdtemp(path.join(tmpdir(), 'brand-')), 'mono.ttf')
    await writeFile(plain, await decompress(await readFile(packed)))
    expect((await openFont(plain)).unitsPerEm).toBeGreaterThan(0)
    expect(await openFont(packed)).toBe(await openFont(packed))
  })
})
