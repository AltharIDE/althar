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
