import { describe, expect, it } from 'vitest'

import { SANS } from '../src/seal/glyphs'
import { SEAL_INK, SEAL_STYLES, type SealFacts, sealable, sealOf, sealSvg, sealUrl } from '../src/seal/seal'

const FACTS: SealFacts = { model: 'GPT-6.1 Sol', sha: '2f67c42', passes: 3, date: '2026-10-31' }

const parsed = (svg: string) => new DOMParser().parseFromString(svg, 'image/svg+xml')

describe('the review seal', () => {
  it('is read back from the address it is drawn at, in either ink', () => {
    for (const style of SEAL_STYLES)
      for (const ink of ['light', 'dark'] as const)
        expect(sealOf(new URL(sealUrl(style, FACTS, ink)))).toEqual({ style, facts: FACTS, ink })
  })

  it('names only the commit’s first seven digits in its address, so a full sha draws the same seal', () => {
    const url = new URL(sealUrl('ring', { ...FACTS, sha: '2f67c42a0b1c2d3e4f5061728394a5b6c7d8e9f0' }, 'light'))
    expect(url.searchParams.get('sha')).toBe('2f67c42')
    expect(url.origin + url.pathname).toBe('https://althar.ai/seal/ring.svg')
  })

  it('refuses an address that asks for what it can’t say', () => {
    const asked = (query: string, path = '/seal/ring.svg') => sealOf(new URL(`https://althar.ai${path}?${query}`))
    const good = 'model=GPT-6.1+Sol&sha=2f67c42&passes=3&date=2026-10-31'
    expect(asked(good)).not.toBeNull()
    expect(asked(good, '/seal/stamp.svg')).toBeNull()
    expect(asked(good, '/seal/ring.png')).toBeNull()
    expect(asked(`${good}&ink=sepia`)).toBeNull()
    expect(asked(good.replace('2f67c42', '2F67C42'))).toBeNull()
    expect(asked(good.replace('2f67c42', '2f67c4'))).toBeNull()
    expect(asked(good.replace('2f67c42', '2f67c42a'))).toBeNull()
    expect(asked(good.replace('passes=3', 'passes=0'))).toBeNull()
    expect(asked(good.replace('passes=3', 'passes=100'))).toBeNull()
    expect(asked(good.replace('passes=3', 'passes=2.5'))).toBeNull()
    expect(asked(good.replace('2026-10-31', '2026-02-30'))).toBeNull()
    expect(asked(good.replace('2026-10-31', '31-10-2026'))).toBeNull()
    expect(asked(good.replace('GPT-6.1+Sol', ''))).toBeNull()
    expect(asked(good.replace('GPT-6.1+Sol', '%3Cscript%3E'))).not.toBeNull()
    expect(asked(good.replace('GPT-6.1+Sol', 'Mod%C3%A8le'))).toBeNull()
    expect(asked(good.replace('GPT-6.1+Sol', '+GPT'))).toBeNull()
    expect(asked(good.replace('GPT-6.1+Sol', 'x'.repeat(33)))).toBeNull()
  })

  it('draws each look as an image with its words as outlines, in the ink asked for, and names what it says', () => {
    for (const style of SEAL_STYLES)
      for (const ink of ['light', 'dark'] as const) {
        const doc = parsed(sealSvg(style, FACTS, ink))
        expect(doc.querySelector('parsererror')).toBeNull()
        const root = doc.documentElement
        expect(root.getAttribute('role')).toBe('img')
        expect(root.getAttribute('aria-label')).toBe('Reviewed by GPT-6.1 Sol in 3 passes, at 2f67c42')
        expect(root.querySelector('title')?.textContent).toBe('Reviewed by GPT-6.1 Sol in 3 passes, at 2f67c42')
        // Nothing an <img> would need a font, a script or another file for.
        expect(root.querySelector('text, script, image, foreignObject, style')).toBeNull()
        expect(sealSvg(style, FACTS, ink)).toContain(SEAL_INK[ink])
        expect(sealSvg(style, FACTS, ink)).not.toContain(SEAL_INK[ink === 'light' ? 'dark' : 'light'])
      }
  })

  it('sets the reviewer’s name in its own letters', () => {
    expect(sealSvg('colophon', FACTS, 'light')).toContain(SANS.G?.[1])
    expect(sealSvg('colophon', { ...FACTS, model: 'Claude Opus 5.5' }, 'light')).not.toBe(sealSvg('colophon', FACTS, 'light'))
  })

  it('escapes what a name could carry into its markup', () => {
    const doc = parsed(sealSvg('ring', { ...FACTS, model: 'A<b>&"c' }, 'light'))
    expect(doc.querySelector('parsererror')).toBeNull()
    expect(doc.querySelector('b')).toBeNull()
    expect(doc.documentElement.getAttribute('aria-label')).toBe('Reviewed by A<b>&"c in 3 passes, at 2f67c42')
  })

  it('says one pass as one', () => {
    expect(sealSvg('wax', { ...FACTS, passes: 1 }, 'light')).toContain('aria-label="Reviewed by GPT-6.1 Sol in 1 pass, at 2f67c42"')
  })

  it('draws a long name smaller rather than over its edge, and never throws on facts it can say', () => {
    const long = { ...FACTS, model: 'Claude Opus 5.5 Extended Thinking', passes: 99 }
    expect(sealable(long)).toBe(false)
    const longest = { ...FACTS, model: 'W'.repeat(32), passes: 99 }
    for (const style of SEAL_STYLES) expect(() => sealSvg(style, longest, 'light')).not.toThrow()
    expect(() => sealSvg('ring', long, 'light')).toThrow()
  })

  it('draws the same seal for the same facts', () => {
    for (const style of SEAL_STYLES) expect(sealSvg(style, FACTS, 'dark')).toBe(sealSvg(style, { ...FACTS }, 'dark'))
  })
})
