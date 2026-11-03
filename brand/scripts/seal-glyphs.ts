/* Writes the review seal's letters (packages/ui/src/seal/glyphs.ts) as outlines, so the seal reads the same in any <img>,
   which can't load a font: `bun scripts/seal-glyphs.ts`. Inter at 600 for its words, every printable ASCII letter and the
   middle dot; JetBrains Mono at 500 for the commit, its hex digits only. Run it again after changing either setting. */

import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { Font } from 'fontkit'

import { fontFile, inter, openFont } from '../src/fonts'

const OUT = resolve(import.meta.dirname, '../../packages/ui/src/seal/glyphs.ts')
/** Units to the em, as the seal draws them. */
const EM = 1000

const LETTER: Record<string, string> = { moveTo: 'M', lineTo: 'L', quadraticCurveTo: 'Q', bezierCurveTo: 'C', closePath: 'Z' }

/** Each letter of `chars` in `font`: its advance and its outline, in thousandths of an em, y down from the baseline. */
function glyphs(font: Font, chars: string, features: string[] = []) {
  const k = EM / font.unitsPerEm
  const set: Record<string, [number, string]> = {}
  for (const char of chars) {
    const run = font.layout(char, features)
    const glyph = run.glyphs[0]
    if (glyph === undefined || run.glyphs.length !== 1) throw new Error(`no single glyph for ${JSON.stringify(char)}`)
    const d = glyph.path.commands
      .map(({ command, args }) => {
        const points: string[] = []
        for (let j = 0; j < args.length; j += 2) points.push(`${Math.round(args[j]! * k)} ${Math.round(-args[j + 1]! * k)}`)
        return `${LETTER[command]}${points.join(' ')}`
      })
      .join('')
    set[char] = [Math.round(run.positions[0]!.xAdvance * k), d]
  }
  return set
}

const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('')
const sans = glyphs((await inter()).getVariation({ wght: 600, opsz: 14 }), `${ascii}·’`, ['cv05', 'cv11', 'ss03'])
const mono = glyphs(
  (await openFont(fontFile('@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2'))).getVariation({
    wght: 500,
  }),
  '0123456789abcdef ',
)

const table = (set: Record<string, [number, string]>) =>
  `{\n${Object.entries(set)
    .map(([char, [advance, d]]) => `  ${JSON.stringify(char)}: [${advance}, ${JSON.stringify(d)}],`)
    .join('\n')}\n}`

await writeFile(
  OUT,
  `/* Made by brand/scripts/seal-glyphs.ts: don't edit. The review seal's letters as outlines, each its advance and its path, in thousandths of an em, y down from the baseline. */

export type Glyphs = Readonly<Record<string, readonly [advance: number, d: string]>>

/** Inter at 600, with the interface's alternates. */
export const SANS: Glyphs = ${table(sans)}

/** JetBrains Mono at 500: a commit's hex digits. */
export const MONO: Glyphs = ${table(mono)}
`,
)
process.stdout.write(`${OUT}\n`)
