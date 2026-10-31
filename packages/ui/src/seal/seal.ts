import { LOGO_BORE, LOGO_SECTION } from '../foundations/Logo/Logo.paths'
import { type Glyphs, MONO, SANS } from './glyphs'

/*
 * The review seal: a mark in the corner of a pull request Althar opens,
 * naming the model that reviewed it, in how many passes, at which commit,
 * and the day. Line-engraved in one ink on nothing, so the page shows
 * through: cobalt for a light page, the dark theme's lighter cobalt for a
 * dark one, and the description picks with a <picture>. Its words are
 * outlines (glyphs.ts), as an <img> can't load a font.
 *
 * A code host shows an image only by its address, so the site draws it from
 * one (apps/site/worker): sealUrl writes it, sealOf reads it back, and
 * refuses anything this can't draw. Pure, with no React or styles, so the
 * site's server, the settings and the runtime's tests can all draw it.
 */

export const SEAL_STYLES = ['ring', 'wax', 'colophon'] as const
export type SealStyle = (typeof SEAL_STYLES)[number]
export type SealInk = 'light' | 'dark'

/** What a seal says. */
export interface SealFacts {
  /** The reviewer, as people know it: GPT-6.1 Sol. */
  readonly model: string
  /** The commit it passed, at least its first 7 hex digits; the seal shows those 7. */
  readonly sha: string
  /** How many times the reviewer read the change, the last with nothing left to change. */
  readonly passes: number
  /** The day it passed, as YYYY-MM-DD. */
  readonly date: string
}

/** The site's cobalt on a light page; on a dark one, the dark theme's --live. */
export const SEAL_INK: Record<SealInk, string> = { light: '#1f35c8', dark: '#8a95ff' }

/** How wide each is shown in a description, in px: about a third of the column beside it. */
export const SEAL_WIDTH: Record<SealStyle, number> = { ring: 150, wax: 150, colophon: 150 }

/** Where the site draws seals. */
export const SEAL_ORIGIN = 'https://althar.ai'

/** The longest reviewer's name a seal sets. */
export const MODEL_MAX = 32
export const PASSES_MAX = 99

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const SHA = /^[0-9a-f]{7,40}$/

/** How many passes, in words: 1 pass, 3 passes. */
export const passesOf = (passes: number) => `${passes} ${passes === 1 ? 'pass' : 'passes'}`

/** What a seal says, in a line: its picture's text for a screen reader. */
export const sealLine = (facts: SealFacts) => `Reviewed by ${facts.model} in ${passesOf(facts.passes)}, at ${facts.sha.slice(0, 7)}`

/** Whether a seal can say these facts: a model in letters it has, a commit in hex, a count it can set, a real day. */
export function sealable(facts: SealFacts): boolean {
  const model = facts.model.trim()
  if (model.length === 0 || model.length > MODEL_MAX || model !== facts.model) return false
  // Printable ASCII, every letter of which glyphs.ts has.
  if (!/^[\x20-\x7e]+$/.test(model)) return false
  if (!SHA.test(facts.sha)) return false
  if (!Number.isInteger(facts.passes) || facts.passes < 1 || facts.passes > PASSES_MAX) return false
  const day = DATE.exec(facts.date)
  if (day === null) return false
  const at = new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3])))
  return at.getUTCFullYear() === Number(day[1]) && at.getUTCMonth() === Number(day[2]) - 1 && at.getUTCDate() === Number(day[3])
}

/** The address the site draws a seal at. Every fact is in it, so each commit's seal is its own, and a cache keeps it for good. */
export function sealUrl(style: SealStyle, facts: SealFacts, ink: SealInk, origin = SEAL_ORIGIN): string {
  const query = new URLSearchParams({ model: facts.model, sha: facts.sha.slice(0, 7), passes: String(facts.passes), date: facts.date })
  if (ink === 'dark') query.set('ink', 'dark')
  return `${origin}/seal/${style}.svg?${query.toString()}`
}

/** What a seal's address asks for, or null where it asks for something a seal can't say. */
export function sealOf(url: URL): { style: SealStyle; facts: SealFacts; ink: SealInk } | null {
  const style = /^\/seal\/([a-z]+)\.svg$/.exec(url.pathname)?.[1]
  if (!SEAL_STYLES.includes(style as SealStyle)) return null
  const q = url.searchParams
  const ink = q.get('ink') ?? 'light'
  if (ink !== 'light' && ink !== 'dark') return null
  const passes = q.get('passes') ?? ''
  if (!/^\d{1,2}$/.test(passes)) return null
  const facts = { model: q.get('model') ?? '', sha: q.get('sha') ?? '', passes: Number(passes), date: q.get('date') ?? '' }
  if (!sealable(facts) || facts.sha.length !== 7) return null
  return { style: style as SealStyle, facts, ink }
}

/** The seal, as an SVG document. Throws on facts it can't say: check them with sealable first. */
export function sealSvg(style: SealStyle, facts: SealFacts, ink: SealInk): string {
  if (!sealable(facts)) throw new Error(`A seal can't say ${JSON.stringify(facts)}`)
  return DRAW[style](facts, SEAL_INK[ink])
}

/* ---- drawing ---------------------------------------------------------------------------- */

const n = (value: number) => {
  const rounded = Number(value.toFixed(2))
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A run of letters in one face: its size in px, and what is added after each letter. */
interface Span {
  readonly text: string
  readonly face: Glyphs
  readonly size: number
  readonly tracking: number
}

/** A run's letters placed along a line from 0: each one's start, advance and outline, in px. */
function set(spans: ReadonlyArray<Span>) {
  const letters: Array<{ x: number; advance: number; scale: number; d: string }> = []
  let pen = 0
  for (const span of spans) {
    const scale = span.size / 1000
    for (const char of span.text) {
      // sealable allows only letters both faces' callers have; a space stands in for any other, and never shows
      const [advance, d] = span.face[char] ?? span.face[' '] ?? [250, '']
      letters.push({ x: pen, advance: advance * scale, scale, d })
      pen += advance * scale + span.tracking
    }
  }
  const last = spans.at(-1)
  return { letters, width: pen - (last?.tracking ?? 0) }
}

/** Spans made smaller together, where they would be wider than `room`. */
function fit(spans: ReadonlyArray<Span>, room: number): ReadonlyArray<Span> {
  const width = set(spans).width
  if (width <= room) return spans
  const k = room / width
  return spans.map((span) => ({ ...span, size: span.size * k, tracking: span.tracking * k }))
}

const glyph = (d: string, transform: string) => (d === '' ? '' : `<path transform="${transform}" d="${d}"/>`)

/** Letters on a line, centred on x, their baseline at y. */
function line(spans: ReadonlyArray<Span>, x: number, y: number, ink: string) {
  const { letters, width } = set(spans)
  const left = x - width / 2
  return `<g fill="${ink}">${letters.map((l) => glyph(l.d, `translate(${n(left + l.x)} ${n(y)}) scale(${l.scale})`)).join('')}</g>`
}

/**
 * Letters set on a circle about (c, c), centred at its top or its foot,
 * reading left to right either way: over the top their feet are on the
 * circle; along the foot their heads are.
 */
function arc(spans: ReadonlyArray<Span>, c: number, r: number, where: 'top' | 'foot', ink: string) {
  const { letters, width } = set(spans)
  return `<g fill="${ink}">${letters
    .map((l) => {
      const along = l.x + l.advance / 2 - width / 2
      const a = along / r
      const deg = (a * 180) / Math.PI
      const x = c + r * Math.sin(a)
      const y = where === 'top' ? c - r * Math.cos(a) : c + r * Math.cos(a)
      return glyph(
        l.d,
        `translate(${n(x)} ${n(y)}) rotate(${n(where === 'top' ? deg : -deg)}) translate(${n(-l.advance / 2)} 0) scale(${l.scale})`,
      )
    })
    .join('')}</g>`
}

/** Room along an arc of `degrees` on a circle of `r`. */
const room = (r: number, degrees: number) => (r * degrees * Math.PI) / 180

/** The mark, `size` across, its middle at x, y; or, as a mask's black, a little fatter, so the hatching stops short of it. */
function mark(x: number, y: number, size: number, ink: string, clear = 0) {
  const k = size / 24
  const at = `translate(${n(x - 12 * k)} ${n(y - 12.37 * k)}) scale(${n(k)})`
  if (clear > 0)
    return `<path transform="${at}" d="${LOGO_SECTION}" fill="black" stroke="black" stroke-width="${n(clear / k)}" stroke-linejoin="round"/>`
  return `<g transform="${at}" fill="${ink}"><path d="${LOGO_SECTION + LOGO_BORE}" fill-rule="evenodd"/><circle cx="12" cy="14.4" r="0.8"/></g>`
}

const circle = (cx: number, cy: number, r: number, ink: string, width: number) =>
  `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="none" stroke="${ink}" stroke-width="${width}"/>`

const lozenge = (x: number, y: number, s: number, ink: string) =>
  `<path d="M${n(x - s)} ${n(y)}L${n(x)} ${n(y - s)}L${n(x + s)} ${n(y)}L${n(x)} ${n(y + s)}Z" fill="${ink}"/>`

/** Level lines filling a circle, fine at its head and heavier toward its foot, as an engraver tones a ground. */
function ground(cx: number, cy: number, r: number, step: number, ink: string, thin: number, thick: number) {
  const lines: string[] = []
  for (let y = cy - r + step / 2; y < cy + r; y += step) {
    const half = Math.sqrt(r * r - (y - cy) ** 2)
    const u = (y - (cy - r)) / (2 * r)
    lines.push(`<path d="M${n(cx - half)} ${n(y)}H${n(cx + half)}" stroke-width="${n(thin + (thick - thin) * u * u)}"/>`)
  }
  return `<g stroke="${ink}" stroke-linecap="round">${lines.join('')}</g>`
}

/** Parallel diagonals over a square of `size`, for a mask to cut; `back` leans them the other way. */
function hatch(size: number, step: number, ink: string, width: number, back = false) {
  const lines: string[] = []
  for (let k = -size; k < size; k += step) lines.push(back ? `M${n(size - k)} 0L${n(-k)} ${size}` : `M${n(k)} 0L${n(k + size)} ${size}`)
  return `<path d="${lines.join('')}" stroke="${ink}" stroke-width="${width}" fill="none"/>`
}

/** A day as the seal sets it: 31 OCT 2026. */
function day(date: string) {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return `${d} ${['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][m - 1]} ${y}`
}

const document = (w: number, h: number, facts: SealFacts, body: string) => {
  const name = escape(sealLine(facts))
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${name}"><title>${name}</title>${body}</svg>`
}

const caps = (text: string, size: number, tracking: number): Span => ({ text: text.toUpperCase(), face: SANS, size, tracking })
const hex = (sha: string, size: number): Span => ({ text: sha.slice(0, 7), face: MONO, size, tracking: 0.4 })
const dot = (size: number): Span => ({ text: '  ·  ', face: SANS, size, tracking: 0 })

/** Ring: a round engraved stamp, the words set on its ring, the mark and the passes on a toned ground. */
function ring(facts: SealFacts, ink: string) {
  const c = 80
  const passes = fit([caps(passesOf(facts.passes), 8.6, 1.4)], 90)
  return document(
    160,
    160,
    facts,
    [
      `<defs><mask id="m"><rect width="160" height="160" fill="white"/>${mark(c, c - 6, 44, ink, 3.2)}<rect x="${c - 50}" y="${c + 17}" width="100" height="15" fill="black"/></mask></defs>`,
      circle(c, c, 77, ink, 1.4),
      circle(c, c, 74, ink, 0.5),
      arc(fit([caps(`Reviewed by ${facts.model}`, 8.6, 0.9)], room(61, 150)), c, 61, 'top', ink),
      arc(fit([hex(facts.sha, 8.6), dot(8.6), caps(day(facts.date), 8.6, 1.1)], room(67.5, 120)), c, 67.5, 'foot', ink),
      lozenge(c - 64, c, 2.2, ink),
      lozenge(c + 64, c, 2.2, ink),
      circle(c, c, 55, ink, 1.1),
      circle(c, c, 52.5, ink, 0.4),
      `<g mask="url(#m)">${ground(c, c, 50, 2.1, ink, 0.3, 0.85)}</g>`,
      mark(c, c - 6, 44, ink),
      line(passes, c, c + 28, ink),
    ].join(''),
  )
}

/** The edge of a pool of wax: a circle that spread unevenly, the same way every time. */
function pool(c: number, r: number) {
  const points: string[] = []
  for (let i = 0; i < 180; i++) {
    const a = (i / 180) * Math.PI * 2
    const rr =
      r +
      2.4 * Math.sin(5 * a + 1.1) +
      1.5 * Math.sin(9 * a + 2.3) +
      0.8 * Math.sin(17 * a + 0.4) +
      1.6 * Math.max(0, Math.sin(3 * a - 0.6)) ** 6
    points.push(`${n(c + rr * Math.cos(a))} ${n(c + rr * Math.sin(a))}`)
  }
  return `M${points.join('L')}Z`
}

/** Wax: a pool of wax pressed with a die, drawn as an engraver would, its shadows in hatching; lit from the upper left. */
function wax(facts: SealFacts, ink: string) {
  const c = 80
  const edge = pool(c, 71)
  return document(
    160,
    160,
    facts,
    [
      '<defs>',
      // the pool's lower right falls away from the light, crossed where it falls deepest, outside the die
      `<mask id="fall"><path d="${edge}" fill="white"/><circle cx="${c - 7}" cy="${c - 7}" r="69" fill="black"/></mask>`,
      `<mask id="deep"><path d="${edge}" fill="white"/><circle cx="${c - 7}" cy="${c - 7}" r="69" fill="black"/><circle cx="${c}" cy="${c}" r="56" fill="black"/></mask>`,
      // the die's hollow is in shadow at its upper left
      `<mask id="hollow"><circle cx="${c}" cy="${c}" r="54" fill="white"/><circle cx="${c + 2}" cy="${c + 2}" r="53.6" fill="black"/></mask>`,
      '</defs>',
      `<g mask="url(#fall)">${hatch(160, 1.9, ink, 0.55)}</g>`,
      `<g mask="url(#deep)">${hatch(160, 3.8, ink, 0.4, true)}</g>`,
      `<path d="${edge}" fill="none" stroke="${ink}" stroke-width="1.3" stroke-linejoin="round"/>`,
      `<g mask="url(#hollow)">${ground(c, c, 54, 1.6, ink, 0.5, 0.5)}</g>`,
      circle(c, c, 54, ink, 1.1),
      arc(fit([caps(facts.model, 9.2, 0.9)], room(43.5, 140)), c, 43.5, 'top', ink),
      arc(fit([hex(facts.sha, 8.4), dot(8.4), caps(passesOf(facts.passes), 8.4, 0.9)], room(50.5, 120)), c, 50.5, 'foot', ink),
      lozenge(c - 47, c, 1.8, ink),
      lozenge(c + 47, c, 1.8, ink),
      circle(c, c, 38, ink, 0.5),
      mark(c, c + 1, 44, ink),
    ].join(''),
  )
}

/** Colophon: a printer's mark, the device over a rule and four lines of type. */
function colophon(facts: SealFacts, ink: string) {
  const c = 80
  return document(
    160,
    132,
    facts,
    [
      `<defs><mask id="m"><rect width="160" height="132" fill="white"/>${mark(c, 25, 30, ink, 2.4)}</mask></defs>`,
      circle(c, 25, 22, ink, 0.9),
      `<g mask="url(#m)">${ground(c, 25, 20, 1.7, ink, 0.3, 0.75)}</g>`,
      mark(c, 25, 30, ink),
      `<path d="M16 56H72M88 56H144" stroke="${ink}" stroke-width="0.6"/>`,
      lozenge(c, 56, 3, ink),
      line([caps('Reviewed by', 8, 2)], c, 72, ink),
      line(fit([{ text: facts.model, face: SANS, size: 16, tracking: 0.2 }], 144), c, 91, ink),
      line(fit([hex(facts.sha, 9.5), dot(8), caps(passesOf(facts.passes), 8, 1.2)], 144), c, 108, ink),
      line([caps(day(facts.date), 8, 1.2)], c, 123, ink),
    ].join(''),
  )
}

const DRAW: Record<SealStyle, (facts: SealFacts, ink: string) => string> = { ring, wax, colophon }
