import { AVATAR_STYLES, avatarSvg } from './avatar'
import { NEEDS_YOU, RUNNING, tileSvg } from './emoji'
import { type LockupLayout, lockupSvg } from './lockup'
import { MARK_STYLES, type MarkName, markSvg } from './mark'
import { paletteJson } from './palette'

/*
 * Everything the pack draws, as a list of files: what each contains, and the
 * PNGs to make from them. Nothing here touches the disk; scripts/export.ts
 * writes it, and tests/catalog.test.ts holds it to its promises.
 */

export interface Written {
  /** Where it goes, from the export folder. */
  file: string
  content: string
}

export interface Raster {
  file: string
  /** The `file` of the SVG it is made from. */
  from: string
  width: number
  /** Drawn on this ground; without one, the PNG keeps its transparency. */
  background?: string
}

export interface Catalog {
  files: Written[]
  rasters: Raster[]
}

const names = <T extends Record<string, unknown>>(o: T): Array<keyof T & string> => Object.keys(o) as Array<keyof T & string>

const LOCKUP_WIDTHS: Record<LockupLayout, readonly number[]> = { horizontal: [800, 2400], stacked: [600, 1800] }

export async function catalog(): Promise<Catalog> {
  const files: Written[] = []
  const rasters: Raster[] = []
  /** An SVG, and its PNGs at the given widths, named `<name>-<width>.png`. */
  const drawing = (name: string, svg: string, widths: readonly number[]): void => {
    files.push({ file: `${name}.svg`, content: svg })
    for (const width of widths) rasters.push({ file: `${name}-${width}.png`, from: `${name}.svg`, width })
  }

  for (const name of names(MARK_STYLES)) drawing(`mark/mark-${name}`, markSvg(MARK_STYLES[name as MarkName]), [256, 1024])

  for (const layout of ['horizontal', 'stacked'] as const) {
    for (const name of names(MARK_STYLES)) {
      const style = MARK_STYLES[name]
      drawing(`lockup/lockup-${layout}-${name}`, await lockupSvg(layout, { ...style, text: style.section }), LOCKUP_WIDTHS[layout])
    }
  }

  for (const name of names(AVATAR_STYLES)) drawing(`avatar/avatar-${name}`, avatarSvg(AVATAR_STYLES[name]), [1024, 400, 128])

  /* Chat emoji: one file each at the size chats ask for. */
  for (const [name, svg] of [
    ['althar', tileSvg()],
    ['running', RUNNING],
    ['needs-you', NEEDS_YOU],
  ] as const) {
    files.push({ file: `emoji/${name}.svg`, content: svg })
    rasters.push({ file: `emoji/${name}.png`, from: `emoji/${name}.svg`, width: 128 })
  }

  /* The favicon kit: the tile, and what browsers and phones ask for of it. */
  files.push({ file: 'web/favicon.svg', content: tileSvg() })
  for (const [file, width] of [
    ['web/apple-touch-icon.png', 180],
    ['web/icon-192.png', 192],
    ['web/icon-512.png', 512],
    ['web/favicon-32.png', 32],
  ] as const) {
    rasters.push({ file, from: 'web/favicon.svg', width })
  }

  files.push({ file: 'palette/colors.json', content: paletteJson() + '\n' })
  return { files, rasters }
}
