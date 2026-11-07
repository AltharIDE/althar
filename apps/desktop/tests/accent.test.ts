import { describe, expect, it } from 'vitest'

import type { DesktopChrome } from '../src/main/desktop'
import { accentSheet, accentTokens, contrast, hexToRgb, legibleShade, systemAccentState } from '../src/renderer/shared/accent'
import { controlsFor } from '../src/renderer/shared/useWindowChrome'

const GNOME_BLUE = hexToRgb('#3584e4')
const PAGE = { light: hexToRgb('#f4f2ec'), dark: hexToRgb('#1c1a17') }
const WHITE = hexToRgb('#ffffff')

describe('the system’s accent, kept legible', () => {
  it('measures contrast as WCAG does', () => {
    expect(contrast(WHITE, hexToRgb('#000000'))).toBeCloseTo(21, 5)
    expect(contrast(WHITE, WHITE)).toBe(1)
  })

  it('takes the nearest shade that keeps the ratio, darker on light, lighter on dark', () => {
    const onLight = legibleShade(GNOME_BLUE, [PAGE.light], 4.5)
    expect(onLight).toBeDefined()
    expect(contrast(onLight ?? WHITE, PAGE.light)).toBeGreaterThanOrEqual(4.5)
    const onDark = legibleShade(hexToRgb('#1c4f9c'), [PAGE.dark], 4.5)
    expect(contrast(onDark ?? PAGE.dark, PAGE.dark)).toBeGreaterThanOrEqual(4.5)
    // One that keeps it already is itself.
    expect(legibleShade(hexToRgb('#1a1a1a'), [WHITE], 4.5)).toEqual(hexToRgb('#1a1a1a'))
  })

  it('gives every violet token a legible shade of GNOME’s blue in both schemes', () => {
    const tokens = accentTokens(GNOME_BLUE)
    expect(tokens).toBeDefined()
    const light = hexToRgb(tokens?.light['--signal'] ?? '#000000')
    const fill = hexToRgb(tokens?.light['--signal-fill'] ?? '#000000')
    const dark = hexToRgb(tokens?.dark['--signal'] ?? '#000000')
    const darkFill = hexToRgb(tokens?.dark['--signal-fill'] ?? '#000000')
    expect(contrast(light, PAGE.light)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(WHITE, fill)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(dark, PAGE.dark)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(WHITE, darkFill)).toBeGreaterThanOrEqual(4.5)
  })

  // GNOME 47's accents, Breeze's blue and Windows' default: every state of every token it gives keeps contrast with what it meets.
  const SYSTEM_ACCENTS = [
    '#3584e4',
    '#2190a4',
    '#3a944a',
    '#c88800',
    '#ed5b00',
    '#e62d42',
    '#d56199',
    '#9141ac',
    '#6f8396',
    '#3daee9',
    '#0078d4',
  ]
  const RAISED = { light: hexToRgb('#fcfbf8'), dark: hexToRgb('#25231f') }
  it.each(SYSTEM_ACCENTS)('keeps every state of %s legible, hovered and pressed included, in both schemes', (hex) => {
    const tokens = accentTokens(hexToRgb(hex))
    if (tokens === undefined) return
    for (const scheme of ['light', 'dark'] as const) {
      const token = (name: string) => hexToRgb(tokens[scheme][name] ?? '#000000')
      for (const fill of ['--signal-fill', '--signal-fill-hover', '--signal-fill-pressed'])
        expect(contrast(WHITE, token(fill)), `${scheme} ${fill}`).toBeGreaterThanOrEqual(4.5)
      for (const text of ['--signal', '--signal-bright', '--signal-pressed'])
        for (const surface of [PAGE[scheme], RAISED[scheme]])
          expect(contrast(token(text), surface), `${scheme} ${text}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('gives light a status chip ink that reads on the accent’s own wash', () => {
    const light = accentTokens(GNOME_BLUE)?.light
    const inkHex = light?.['--signal-ink']
    const signalHex = light?.['--signal']
    expect(inkHex).toBeDefined()
    expect(signalHex).toBeDefined()
    const ink = hexToRgb(inkHex!)
    const wash = (s: typeof WHITE) => {
      const t = hexToRgb(signalHex!)
      return { r: Math.round(t.r * 0.1 + s.r * 0.9), g: Math.round(t.g * 0.1 + s.g * 0.9), b: Math.round(t.b * 0.1 + s.b * 0.9) }
    }
    expect(contrast(ink, wash(PAGE.light))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(ink, wash(hexToRgb('#fcfbf8')))).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps GNOME’s blue’s dark hover readable under white words, still lighter than its fill', () => {
    const dark = accentTokens(GNOME_BLUE)?.dark
    const fill = hexToRgb(dark?.['--signal-fill'] ?? '#ffffff')
    const hover = hexToRgb(dark?.['--signal-fill-hover'] ?? '#ffffff')
    expect(contrast(WHITE, hover)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(WHITE, hover)).toBeLessThan(contrast(WHITE, fill))
  })

  it('keeps Althar’s own where the system’s is too light or too dark to read as itself', () => {
    // GNOME's yellow and a near-black: either would have to move too far from itself.
    expect(accentTokens(hexToRgb('#f5c211'))).toBeUndefined()
    expect(accentTokens(hexToRgb('#050505'))).toBeUndefined()
    expect(systemAccentState(hexToRgb('#f5c211'))).toBe('illegible')
    expect(systemAccentState(GNOME_BLUE)).toBe('used')
    expect(systemAccentState(null)).toBe('none')
  })

  it('lays the tokens over the kit’s, a step more specific, light and dark', () => {
    const tokens = accentTokens(GNOME_BLUE)
    if (tokens === undefined) throw new Error('GNOME’s blue keeps contrast')
    const sheet = accentSheet(tokens)
    expect(sheet).toContain(':root:root {')
    expect(sheet).toContain(":root:root[data-theme='dark'] {")
    expect(sheet).toMatch(/--signal: #[0-9a-f]{6};/)
  })
})

describe('the bar’s buttons, by what the desktop says', () => {
  const chrome = (more: Partial<DesktopChrome>): DesktopChrome => ({
    kind: 'drawn',
    look: 'gnome',
    tone: 'adwaita',
    family: 'gnome',
    layout: { start: [], end: ['close'] },
    accent: null,
    ...more,
  })

  it('keeps the traffic lights’ room on a Mac', () => {
    expect(controlsFor('darwin', undefined)).toEqual({ lights: 'space' })
  })

  it('draws GNOME’s, in its order and at its end, a layout of close alone too', () => {
    expect(controlsFor('linux', chrome({}))).toEqual({
      lights: 'drawn',
      controls: { look: 'gnome', tone: 'adwaita', start: [], end: ['close'] },
    })
    expect(controlsFor('linux', chrome({ layout: { start: ['close', 'maximize'], end: [] } }))).toMatchObject({
      controls: { start: ['close', 'maximize'], end: [] },
    })
  })

  it('draws none where the window manager draws the frame, or a tiling one has none', () => {
    expect(controlsFor('linux', chrome({ kind: 'frame', look: undefined }))).toEqual({ lights: 'none' })
    expect(controlsFor('linux', chrome({ kind: 'bare', look: undefined }))).toEqual({ lights: 'none' })
  })

  it('draws Windows’ or neutral ones where main said nothing', () => {
    expect(controlsFor('win32', undefined)).toMatchObject({ lights: 'drawn', controls: { look: 'windows' } })
    expect(controlsFor('linux', undefined)).toMatchObject({ lights: 'drawn', controls: { look: 'gnome', tone: 'legacy' } })
  })
})
