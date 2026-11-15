/* Makes the homepage gallery's pictures (src/home/bodies/desktop/screens/) from the brand pack's screenshots: each framed
   one, on its wallpaper, at the strip's height and twice it; and each window alone, opened whole, at 1× and 2× (the pack
   takes it at 2×); all WebP, with their sizes in sizes.json, so each keeps its place before it loads. Run it after the
   pack's screenshots are taken again (bun --filter @althar/brand export:screenshots): `bun run screens`. */

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import sharp from 'sharp'

import { SCREENS } from '../src/home/bodies/desktop/screens/list'

const brand = resolve(import.meta.dirname, '../../../brand/export/screenshots')
const out = resolve(import.meta.dirname, '../src/home/bodies/desktop/screens')

/** The strip's pictures, by height: as tall as a card stands at most, and twice it, for a sharp screen. */
const CARD = [460, 920]

const size = async (file: string) => {
  const { width, height } = await sharp(file).metadata()
  return [width, height]
}

await mkdir(out, { recursive: true })
for (const file of await readdir(out)) if (file.endsWith('.webp')) await rm(resolve(out, file))
const sizes: Record<string, { card: number[]; whole: number[] }> = {}
for (const { file: name } of SCREENS) {
  const framed = resolve(brand, `framed/${name}.jpg`)
  const window = resolve(brand, `${name}.png`)
  for (const height of CARD)
    await sharp(framed)
      .resize({ height })
      .webp({ quality: 82 })
      .toFile(resolve(out, `${name}-${height}h.webp`))
  const whole = await size(window)
  await sharp(window)
    .webp({ quality: 86 })
    .toFile(resolve(out, `${name}-whole-2x.webp`))
  await sharp(window)
    .resize({ width: Math.round(whole[0]! / 2) })
    .webp({ quality: 86 })
    .toFile(resolve(out, `${name}-whole-1x.webp`))
  sizes[name] = { card: await size(framed), whole }
}
const lines = Object.entries(sizes).map(
  ([name, it]) => `  "${name}": { "card": [${it.card.join(', ')}], "whole": [${it.whole.join(', ')}] }`,
)
await writeFile(resolve(out, 'sizes.json'), `{\n${lines.join(',\n')}\n}\n`)
console.warn(`screens: ${SCREENS.length} framed and whole, in ${out}`)
