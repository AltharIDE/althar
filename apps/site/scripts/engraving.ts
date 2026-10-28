/* Makes the footer's engraving (src/shared/footer/engraving/) from a generated picture: `bun scripts/engraving.ts <picture.png>`.
   Recolours it in the page's two inks, the paper #f4f2ec and the cobalt #1f35c8, by how dark it is, takes the light standing on
   the altar out (the footer draws it, moving), and writes it in AVIF and WebP at 1280 and its own width, and the narrow crop
   around the altar at 640 and its own width. The light's column and the crop are where they are in the picture of 1916 by 821:
   for another picture, change COLUMN and CROP here, and the altar, table and water in Footer.tsx. */

import { mkdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

import sharp, { type Sharp } from 'sharp'

const OUT = resolve(import.meta.dirname, '../src/shared/footer/engraving')
const PAPER = [244, 242, 236]
const INK = [31, 53, 200]
/** The picture's red at its darkest: as dark as it gets, it is the cobalt. */
const DARKEST = 14
/** The paper's own unevenness, in red, made flat paper: kept, it shows as blocks once compressed. */
const GRAIN = 6
/** The light's column above the altar's table, in the picture's px: x from, x to, and its foot. */
const COLUMN = { from: 1262, to: 1402, foot: 501 }
/** Where the narrow crop starts, as a share of the width. */
const CROP = 0.4

const source = process.argv[2]
if (!source) throw new Error('Usage: bun scripts/engraving.ts <picture.png>')
const { data, info } = await sharp(source).removeAlpha().raw().toBuffer({ resolveWithObject: true })
const { width, height } = info
const out = Buffer.alloc(data.length)
for (let i = 0; i < data.length; i += 3) {
  const t = Math.min(1, Math.max(0, (PAPER[0]! - GRAIN - data[i]!) / (PAPER[0]! - GRAIN - DARKEST)))
  for (let k = 0; k < 3; k++) out[i + k] = Math.round(PAPER[k]! * (1 - t) + INK[k]! * t)
}
// The light, as paper, feathered at its sides.
for (let y = 0; y < COLUMN.foot; y++)
  for (let x = COLUMN.from; x < COLUMN.to; x++) {
    const a = Math.min(1, Math.min(x - COLUMN.from, COLUMN.to - 1 - x) / 10)
    const i = (y * width + x) * 3
    for (let k = 0; k < 3; k++) out[i + k] = Math.round(out[i + k]! * (1 - a) + PAPER[k]! * a)
  }

await mkdir(OUT, { recursive: true })
const whole = () => sharp(out, { raw: { width, height, channels: 3 } })
const left = Math.round(width * CROP)
const narrow = () => whole().extract({ left, top: 0, width: width - left, height })
const files: [string, () => Sharp][] = [
  ['engraving-1280', () => whole().resize(1280)],
  ['engraving-1916', whole],
  ['engraving-narrow-640', () => narrow().resize(640)],
  ['engraving-narrow-1150', narrow],
]
for (const [name, make] of files) {
  await make().avif({ quality: 52, effort: 6 }).toFile(`${OUT}/${name}.avif`)
  await make().webp({ quality: 78 }).toFile(`${OUT}/${name}.webp`)
  for (const ext of ['avif', 'webp'])
    process.stdout.write(`${name}.${ext} ${Math.round((await stat(`${OUT}/${name}.${ext}`)).size / 1024)} KB\n`)
}
