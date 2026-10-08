import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

import { type Font, create } from 'fontkit'
import { decompress } from 'wawoff2'

const require = createRequire(import.meta.url)

/** A typeface file from a dependency, by its path inside the package. */
export function fontFile(spec: string): string {
  return require.resolve(spec)
}

const cache = new Map<string, Promise<Font>>()

/**
 * A font file opened once, however often it is asked for. A WOFF2 file is
 * unpacked first: fontkit can't apply a variable font's axes to one.
 */
export function openFont(file: string): Promise<Font> {
  let font = cache.get(file)
  if (!font) {
    font = (async () => {
      const bytes = await readFile(file)
      /* a single font: the files this opens are, though fontkit's type allows a collection */
      return create(file.endsWith('.woff2') ? Buffer.from(await decompress(bytes)) : bytes) as Font
    })()
    cache.set(file, font)
  }
  return font
}

/** Inter, with its weight and optical size axes. The interface, the site and the pitch all set it. */
export const inter = (): Promise<Font> => openFont(fontFile('@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2'))
