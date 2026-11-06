import type { Rgb } from '../../main/desktop'

/*
 * The system's accent as the window's own (Settings › Appearance › Accent,
 * ADR-096): where the person chose the system's, its colour takes the place
 * of Althar's violet, for focus rings, selection, and what violet marks and
 * fills, in both schemes. Only where it stays legible: as the desktops do
 * themselves (libadwaita derives a darker accent for text on light), each
 * use takes the nearest shade of the system's colour, its lightness moved
 * no further than MAX_SHIFT, that keeps WCAG's contrast against what it sits
 * on (4.5:1 for words, 3:1 for a ring). Where any use can't, in either
 * scheme, the colour is too far from legible to still read as the system's,
 * and Althar keeps its own.
 */

/** How far in OKLab lightness a shade may move from the system's colour and still be it. */
export const MAX_SHIFT = 0.22

/** What the accent sits on, from the kit's tokens: the page and raised sheets in each scheme, and the ink a focus ring may sit on. */
const SURFACES = {
  light: { page: '#f4f2ec', raised: '#fcfbf8', ink: '#141417' },
  dark: { page: '#1c1a17', raised: '#25231f', ink: '#ddd7cc' },
} as const

const WHITE: Rgb = { r: 255, g: 255, b: 255 }

export const hexToRgb = (hex: string): Rgb => {
  const n = Number.parseInt(hex.slice(1), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export const rgbToHex = ({ r, g, b }: Rgb): string => `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`

const toLinear = (c: number) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const fromLinear = (v: number) => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055
  return Math.round(Math.min(1, Math.max(0, c)) * 255)
}

/** WCAG's relative luminance. */
export const luminance = ({ r, g, b }: Rgb): number => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)

/** WCAG's contrast ratio, 1 to 21. */
export const contrast = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

type Lab = readonly [number, number, number]

const toOklab = ({ r, g, b }: Rgb): Lab => {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)]
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

const fromOklab = ([L, a, b]: Lab): Rgb => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return {
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0004196086 * l - 0.7034266592 * m + 1.707614701 * s),
  }
}

/** The colour with its OKLab lightness moved by `by`. */
export const shifted = (color: Rgb, by: number): Rgb => {
  const [L, a, b] = toOklab(color)
  return fromOklab([Math.min(1, Math.max(0, L + by)), a, b])
}

/**
 * The nearest shade of `color` that keeps `ratio` against every one of `against`: itself where it already does, else moved
 * darker or lighter (whichever the surfaces call for) a step at a time up to MAX_SHIFT; nothing where none does. With `states`,
 * the lightness offsets its hover and pressed shades take from it, each of those must keep the ratio too, so a hover that
 * lightens a fill never lightens it past legible.
 */
export const legibleShade = (color: Rgb, against: readonly Rgb[], ratio: number, states: readonly number[] = []): Rgb | undefined => {
  const legible = (shade: Rgb) => against.every((surface) => contrast(shade, surface) >= ratio)
  const keeps = (shade: Rgb) => legible(shade) && states.every((by) => legible(shifted(shade, by)))
  if (keeps(color)) return color
  // Lighter on dark surfaces, darker on light ones.
  const direction = against.every((surface) => luminance(surface) > luminance(color)) ? -1 : 1
  for (let step = 0.01; step <= MAX_SHIFT + 1e-9; step += 0.01) {
    const shade = shifted(color, direction * step)
    if (keeps(shade)) return shade
  }
  return undefined
}

const rgba = ({ r, g, b }: Rgb, alpha: number) => `rgba(${r}, ${g}, ${b}, ${alpha})`

/** How far each scheme's state shades move from the colour they come from, in OKLab lightness. */
const STATES = {
  light: { textBright: -0.04, textPressed: -0.08, fillHover: -0.04, fillPressed: -0.08 },
  dark: { textBright: 0.04, textPressed: -0.04, fillHover: 0.03, fillPressed: -0.03 },
} as const

/** The kit's violet tokens, from the system's accent, for one scheme; nothing where any of them can't be made legible. */
const tokensFor = (accent: Rgb, scheme: 'light' | 'dark'): Record<string, string> | undefined => {
  const surfaces = SURFACES[scheme]
  const by = STATES[scheme]
  // Violet as words and marks on the page and on sheets, its brighter and pressed shades as well.
  const text = legibleShade(accent, [hexToRgb(surfaces.page), hexToRgb(surfaces.raised)], 4.5, [by.textBright, by.textPressed])
  // Violet as a fill with white words on it, hovered and pressed as well.
  const fill = legibleShade(accent, [WHITE], 4.5, [by.fillHover, by.fillPressed])
  // A focus ring on an ink fill.
  const onInk = legibleShade(accent, [hexToRgb(surfaces.ink)], 3)
  if (text === undefined || fill === undefined || onInk === undefined) return undefined
  const hex = rgbToHex
  const states = {
    '--signal': hex(text),
    '--signal-bright': hex(shifted(text, by.textBright)),
    '--signal-pressed': hex(shifted(text, by.textPressed)),
    '--signal-fill': hex(fill),
    '--signal-fill-hover': hex(shifted(fill, by.fillHover)),
    '--signal-fill-pressed': hex(shifted(fill, by.fillPressed)),
    '--on-ink-focus': hex(onInk),
  }
  return scheme === 'light'
    ? {
        ...states,
        '--signal-dim': rgba(text, 0.1),
        '--selection': rgba(text, 0.1),
        '--signal-line': rgba(text, 0.32),
        '--signal-hover': rgba(text, 0.16),
        '--signal-paper': `color-mix(in oklab, ${hex(accent)} 7%, #ffffff)`,
      }
    : {
        ...states,
        '--signal-dim': rgba(text, 0.13),
        '--selection': rgba(text, 0.34),
        '--signal-line': rgba(text, 0.42),
        '--signal-hover': rgba(text, 0.22),
        '--signal-paper': `color-mix(in oklab, ${hex(text)} 7%, var(--n-1))`,
        '--signal-raised': `color-mix(in oklab, ${hex(text)} 5%, var(--paper))`,
      }
}

/** The kit's violet tokens from the system's accent, light and dark; nothing where it can't keep contrast in both. */
export const accentTokens = (
  accent: Rgb,
): { readonly light: Record<string, string>; readonly dark: Record<string, string> } | undefined => {
  const light = tokensFor(accent, 'light')
  const dark = tokensFor(accent, 'dark')
  return light === undefined || dark === undefined ? undefined : { light, dark }
}

/** The style sheet that lays them over the kit's, a step more specific than its `:root` and `:root[data-theme='dark']`. */
export const accentSheet = (tokens: NonNullable<ReturnType<typeof accentTokens>>): string => {
  const block = (values: Record<string, string>) =>
    Object.entries(values)
      .map(([name, value]) => `  ${name}: ${value};`)
      .join('\n')
  return `:root:root {\n${block(tokens.light)}\n}\n:root:root[data-theme='dark'] {\n${block(tokens.dark)}\n}\n`
}

const SHEET_ID = 'althar-system-accent'

/** Lays the system's accent over the kit's on `document`, or takes it off with null. */
export const applyAccent = (sheet: string | null, document: Document = window.document): void => {
  const existing = document.getElementById(SHEET_ID)
  if (sheet === null) {
    existing?.remove()
    return
  }
  const style = existing ?? Object.assign(document.createElement('style'), { id: SHEET_ID })
  if (style.textContent !== sheet) style.textContent = sheet
  if (existing === null) document.head.append(style)
}

/** What the accent setting can say of the system's colour: there is none, it is used, or it can't be made legible here. */
export type SystemAccentState = 'none' | 'used' | 'illegible'

/** Where the system's accent stands, for the setting's note. */
export const systemAccentState = (accent: Rgb | null | undefined): SystemAccentState =>
  accent == null ? 'none' : accentTokens(accent) === undefined ? 'illegible' : 'used'
