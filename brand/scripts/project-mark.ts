/* Draws the mark a project gets, for any name, as the app draws it.
     bun run project-mark ledger                  -> ledger.svg in the current folder
     bun run project-mark ledger --ink teal       in an ink of your choice (clay ochre olive moss teal slate rose umber)
     bun run project-mark ledger --png 512        and a PNG that wide */

import { writeFile } from 'node:fs/promises'

import { ProjectInk, projectInk } from '@althar/ui/project-mark'

import { png } from '../src/files'
import { INKS, projectMarkSvg } from '../src/project-marks'

const args = process.argv.slice(2)
const name = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--ink' && args[args.indexOf(a) - 1] !== '--png')
const flag = (f: string): string | undefined => args[args.indexOf(f) + 1]

if (!name) {
  console.error('usage: bun run project-mark <name> [--ink <ink>] [--png <width>]')
  process.exit(1)
}
const chosen = flag('--ink')
if (chosen !== undefined && !INKS.includes(chosen as ProjectInk)) {
  console.error(`no such ink: ${chosen}. The inks are ${INKS.join(', ')}.`)
  process.exit(1)
}
const svg = projectMarkSvg(name, (chosen as ProjectInk | undefined) ?? projectInk(name))
await writeFile(`${name}.svg`, svg)
const width = flag('--png')
if (width) await writeFile(`${name}.png`, await png(svg, Number(width)))
console.warn(`${name}.svg${width ? ` and ${name}.png` : ''} written`)
