import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/*
 * The colour tokens, light and dark, as files: dark is a full second set
 * (every colour of tokens.css set again in dark.css, but for what is the
 * same in every theme), each part that only dark adjusts keeps its light
 * look as a fallback where it is used, and what carries meaning on dark
 * reads at WCAG AA. Colours are resolved here as a browser would: hex,
 * rgb(a), var() and color-mix() in srgb or oklab, alpha composited over
 * what is under it.
 */

const styles = join(import.meta.dirname, '../src/styles')
const source = join(import.meta.dirname, '../src')

/** The custom properties a block of CSS declares, by name, comments left out. */
const declarations = (css: string, selector: string): Map<string, string> => {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const start = plain.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`No ${selector} block`)
  let depth = 0
  let end = start
  for (let i = plain.indexOf('{', start); i < plain.length; i++) {
    if (plain[i] === '{') depth++
    if (plain[i] === '}' && --depth === 0) {
      end = i
      break
    }
  }
  const body = plain.slice(plain.indexOf('{', start) + 1, end)
  const found = new Map<string, string>()
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) found.set(match[1]!, match[2]!.replace(/\s+/g, ' ').trim())
  return found
}

const light = declarations(readFileSync(join(styles, 'tokens.css'), 'utf8'), ':root')
const dark = declarations(readFileSync(join(styles, 'dark.css'), 'utf8'), ":root[data-theme='dark']")

/** What isn't a colour: stacking, radii, type, air, motion. */
const NOT_COLOUR = /^--(z-|r-|r$|font|mono|sp$|measure|ease|fast|base|slow|fold|prose|lede|frost-blur$)/

/**
 * The same in every theme, so dark.css leaves them alone: what is drawn on
 * what is dark anyway (the island, the lightbox, a dark terminal), a
 * project's mark (its picture), and what follows from another token.
 */
const SAME_IN_EVERY_THEME = new Set([
  '--live-on-ink',
  '--signal-on-ink',
  '--signal-on-ink-hover',
  '--signal-on-ink-pressed',
  '--on-dark',
  '--on-dark-2',
  '--on-dark-focus',
  '--term-t1',
  '--term-t2',
  '--term-t3',
  '--term-t4',
  '--term-t5',
  '--term-live',
  '--term-danger',
  '--mark-clay',
  '--mark-ochre',
  '--mark-olive',
  '--mark-moss',
  '--mark-teal',
  '--mark-slate',
  '--mark-rose',
  '--mark-umber',
  '--paper-plain',
  '--bot',
])

describe('the dark theme as a set of tokens', () => {
  it('sets every colour of the light theme again, but for what is the same in every theme', () => {
    const colours = [...light.keys()].filter((name) => !NOT_COLOUR.test(name) && !SAME_IN_EVERY_THEME.has(name))
    expect(colours.filter((name) => !dark.has(name))).toEqual([])
    // and what is the same in every theme really is left alone
    expect([...SAME_IN_EVERY_THEME].filter((name) => dark.has(name))).toEqual([])
  })

  it('adjusts a part only where the part keeps its light look as a fallback', () => {
    const parts = [...dark.keys()].filter((name) => !light.has(name))
    expect(parts.length).toBeGreaterThan(0)
    const modules = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? modules(join(dir, entry.name)) : entry.name.endsWith('.module.css') ? [join(dir, entry.name)] : [],
      )
    const css = modules(source)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n')
    // Each is read with its light look beside it, var(--part, light), or names one that is: never bare.
    expect(parts.filter((name) => !css.includes(`var(${name},`) && !css.includes(`${name}: var(--`))).toEqual([])
  })

  it('names no theme in a component: every difference at night is a token', () => {
    const modules = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? modules(join(dir, entry.name)) : entry.name.endsWith('.module.css') ? [join(dir, entry.name)] : [],
      )
    expect(modules(source).filter((file) => readFileSync(file, 'utf8').includes('data-theme'))).toEqual([])
  })
})

/* ---- colours, resolved ---- */

interface Rgba {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

/** Splits at the commas that aren't inside parentheses. */
const parts = (text: string) => {
  const out: string[] = []
  let depth = 0
  let from = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++
    if (text[i] === ')') depth--
    if (text[i] === ',' && depth === 0) {
      out.push(text.slice(from, i).trim())
      from = i + 1
    }
  }
  out.push(text.slice(from).trim())
  return out
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
const clamp = (c: number) => Math.min(1, Math.max(0, c))

const toOklab = ({ r, g, b }: Rgba): [number, number, number] => {
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

const fromOklab = ([L, A, B]: [number, number, number], a: number): Rgba => {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return {
    r: clamp(toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    g: clamp(toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    b: clamp(toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
    a,
  }
}

/** A token's value with every var() in it replaced by what that resolves to, in a theme. */
const expand = (value: string, theme: 'light' | 'dark'): string =>
  value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => expand(valueOf(name, theme), theme))

const valueOf = (name: string, theme: 'light' | 'dark') => {
  const value = (theme === 'dark' ? dark.get(name) : undefined) ?? light.get(name)
  if (value === undefined) throw new Error(`No token ${name}`)
  return value
}

/** A colour as a browser parses it; color-mix interpolated with premultiplied alpha, as CSS Color 5 has it. */
const parse = (text: string): Rgba => {
  const value = text.trim()
  if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)?.[1]
  if (hex !== undefined) {
    const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex
    const n = Number.parseInt(full, 16)
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: 1 }
  }
  const rgb = /^rgba?\((.*)\)$/.exec(value)?.[1]
  if (rgb !== undefined) {
    const [r = 0, g = 0, b = 0, a = 1] = rgb
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number)
    return { r: r / 255, g: g / 255, b: b / 255, a }
  }
  const mix = /^color-mix\((.*)\)$/.exec(value)?.[1]
  if (mix !== undefined) {
    const [space = '', first = '', second = ''] = parts(mix)
    const side = (part: string) => {
      const at = /\s(\d+(?:\.\d+)?)%$/.exec(part)
      return { colour: parse(at === null ? part : part.slice(0, at.index)), share: at === null ? undefined : Number(at[1]) / 100 }
    }
    const one = side(first)
    const two = side(second)
    const p1 = one.share ?? (two.share === undefined ? 0.5 : 1 - two.share)
    const p2 = two.share ?? 1 - p1
    const sum = p1 + p2
    const [w1, w2] = [p1 / sum, p2 / sum]
    const a = one.colour.a * w1 + two.colour.a * w2
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 }
    const scale = Math.min(1, sum)
    if (space.trim() === 'in oklab') {
      const [x, y] = [toOklab(one.colour), toOklab(two.colour)]
      const lab = [0, 1, 2].map((i) => (x[i]! * one.colour.a * w1 + y[i]! * two.colour.a * w2) / a) as [number, number, number]
      return { ...fromOklab(lab, a * scale) }
    }
    const channel = (key: 'r' | 'g' | 'b') => (one.colour[key] * one.colour.a * w1 + two.colour[key] * two.colour.a * w2) / a
    return { r: channel('r'), g: channel('g'), b: channel('b'), a: a * scale }
  }
  throw new Error(`Not a colour this test reads: ${value}`)
}

const colour = (name: string, theme: 'light' | 'dark') => parse(expand(valueOf(name, theme), theme))

/** `top` over `under`, as a page composites them. */
const over = (top: Rgba, under: Rgba): Rgba => ({
  r: top.r * top.a + under.r * (1 - top.a),
  g: top.g * top.a + under.g * (1 - top.a),
  b: top.b * top.a + under.b * (1 - top.a),
  a: 1,
})

const luminance = ({ r, g, b }: Rgba) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)

/** The contrast of `ink` on the surfaces listed from the page up, in a theme. */
const contrast = (ink: string, on: ReadonlyArray<string>, theme: 'light' | 'dark') => {
  const ground = on.reduce<Rgba>((under, name) => over(colour(name, theme), under), colour('--n-2', theme))
  const [hi, lo] = [luminance(over(colour(ink, theme), ground)), luminance(ground)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

const TEXT = 4.5
const MARK = 3

/** What carries meaning, the surfaces under it from the page up, and what it must reach. */
const PAIRS: ReadonlyArray<readonly [ink: string, on: ReadonlyArray<string>, at: number]> = [
  ['--t-1', ['--n-2'], TEXT],
  ['--t-2', ['--n-2'], TEXT],
  ['--t-3', ['--n-2'], TEXT],
  ['--t-3', ['--chrome'], TEXT],
  ['--t-3', ['--n-1'], TEXT],
  ['--t-3', ['--paper'], TEXT],
  ['--t-3', ['--n-4'], TEXT],
  ['--t-3', ['--paper', '--hover-paper'], TEXT],
  ['--t-3', ['--paper', '--tile'], TEXT],
  ['--t-3', ['--n-1', '--inset'], TEXT],
  ['--t-3', ['--float'], TEXT],
  ['--t-3', ['--frost', '--frost-sheet'], TEXT],
  ['--t-3', ['--n-1', '--signal-paper'], TEXT],
  ['--t-1', ['--n-1', '--signal-paper'], TEXT],
  ['--t-1', ['--paper', '--chip'], TEXT],
  ['--t-1', ['--chosen'], TEXT],
  ['--kbd-ink', ['--paper', '--chip'], TEXT],
  ['--signal', ['--n-2'], TEXT],
  ['--signal', ['--n-1'], TEXT],
  ['--signal', ['--n-1', '--signal-paper'], TEXT],
  ['--signal', ['--n-1', '--signal-dim'], TEXT],
  ['--on-signal', ['--signal-fill'], TEXT],
  ['--on-signal', ['--signal-fill-hover'], TEXT],
  ['--on-ink', ['--ink-fill'], TEXT],
  ['--on-ink', ['--ink-hover'], TEXT],
  ['--live', ['--n-2'], TEXT],
  ['--live', ['--n-1'], TEXT],
  ['--live', ['--n-1', '--live-dim'], TEXT],
  ['--danger', ['--n-1'], TEXT],
  ['--danger', ['--n-1', '--danger-dim'], TEXT],
  ['--ok', ['--n-1'], TEXT],
  ['--add-ink', ['--add-line'], TEXT],
  ['--add-ink', ['--add-word'], TEXT],
  ['--del-ink', ['--del-line'], TEXT],
  ['--del-ink', ['--del-word'], TEXT],
  ['--named-ink', ['--named-line'], TEXT],
  ['--t-1', ['--named-line'], TEXT],
  ['--syn-keyword', ['--paper'], TEXT],
  ['--syn-string', ['--paper'], TEXT],
  ['--syn-fn', ['--paper'], TEXT],
  ['--syn-type', ['--paper'], TEXT],
  ['--syn-comment', ['--paper'], TEXT],
  ['--syn-punct', ['--paper'], TEXT],
  ['--syn-comment', ['--n-1'], TEXT],
  ['--syn-string', ['--named-line'], TEXT],
  ['--term-t1', ['--term'], TEXT],
  ['--term-paper-ink', ['--chrome'], TEXT],
  ['--signal', ['--n-2'], MARK], // the focus ring
  ['--ok', ['--n-2'], MARK],
  ['--warm', ['--n-1'], MARK],
  ['--add-sign', ['--add-gutter'], MARK],
  ['--del-sign', ['--del-gutter'], MARK],
  ['--linear', ['--n-1'], MARK],
  ['--knob-off', ['--n-1', '--line-2'], MARK],
]

describe('the dark theme, read', () => {
  it.each(PAIRS.map(([ink, on, at]) => ({ ink, on: on.join(' under '), at, surfaces: on })))(
    '$ink on $on reaches $at:1',
    ({ ink, surfaces, at }) => {
      expect(contrast(ink, surfaces, 'dark')).toBeGreaterThanOrEqual(at)
    },
  )

  it('resolves colours as a browser does', () => {
    // the parts of the resolver the pairs lean on, against values a browser gives
    expect(parse('#fff')).toEqual({ r: 1, g: 1, b: 1, a: 1 })
    expect(parse('rgba(255, 240, 215, 0.5)')).toEqual({ r: 1, g: 240 / 255, b: 215 / 255, a: 0.5 })
    const half = parse('color-mix(in srgb, #000000 50%, #ffffff)')
    expect(half.r).toBeCloseTo(0.5, 5)
    // color-mix in oklab of a colour with itself is that colour; with transparent at 0% it is transparent
    expect(parse('color-mix(in oklab, #2d2a26, #2d2a26 40%)').r).toBeCloseTo(0x2d / 255, 3)
    expect(parse('color-mix(in srgb, #25231f 0%, transparent)').a).toBe(0)
    // What Chromium paints for these, read back off a canvas, to within a unit
    const chromium: ReadonlyArray<readonly [string, readonly [number, number, number]]> = [
      ['color-mix(in oklab, #ffffff 80%, #1a1a1d)', [203, 203, 204]],
      ['color-mix(in oklab, #2d2a26, #efeae1 6%)', [55, 52, 47]],
      ['color-mix(in oklab, #a68aff 7%, #25231f)', [45, 42, 45]],
      ['color-mix(in srgb, #8a95ff 92%, #25231f)', [130, 140, 237]],
    ]
    for (const [mixed, [r, g, b]] of chromium) {
      const got = parse(mixed)
      expect(Math.abs(got.r * 255 - r)).toBeLessThanOrEqual(1)
      expect(Math.abs(got.g * 255 - g)).toBeLessThanOrEqual(1)
      expect(Math.abs(got.b * 255 - b)).toBeLessThanOrEqual(1)
    }
  })
})
