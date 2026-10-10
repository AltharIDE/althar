import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { artifactPath, type PictureType, pictureType } from '@althar/runtime/artifacts'

import { pictureAsked } from './pictureAddress'

/*
 * Pictures an agent handed back, served to the window from the artifact
 * store under the profile (docs/architecture/07), by their digest: the
 * window never names a path. The bytes say what a picture is; anything the
 * window doesn't draw isn't served. Asked for a width, a smaller copy is
 * made once and kept beside the store, so a thread of large screenshots
 * decodes small pictures, and the full one only when it opens.
 */

/** Makes a smaller copy of a picture, as wide as asked; null where it is no wider already, or can't be made. */
export type Resize = (bytes: Buffer, type: PictureType, width: number) => { readonly bytes: Buffer; readonly type: PictureType } | null

const answer = (bytes: Buffer, type: string) =>
  new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': type,
      // A digest's bytes never change.
      'cache-control': 'private, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  })

const missing = () => new Response(null, { status: 404 })

const read = (path: string) => readFile(path).catch(() => null)

/**
 * Keeps a smaller copy beside the store, written aside under a name of its
 * own first, so neither a half-written copy nor one two requests made at
 * once is ever served.
 */
const keepCopy = async (folder: string, name: string, bytes: Buffer) => {
  await mkdir(folder, { recursive: true })
  const aside = join(folder, `.${name}.${randomUUID()}`)
  try {
    await writeFile(aside, bytes)
    await rename(aside, join(folder, name))
  } finally {
    await rm(aside, { force: true })
  }
}

/** The picture an address asks for, from the store at `root`, or 404 for anything else. */
export const servePicture =
  (root: string, resize: Resize) =>
  async (request: Request): Promise<Response> => {
    const asked = pictureAsked(request.url)
    if (asked === null) return missing()
    const bytes = await read(artifactPath(root, asked.digest))
    if (bytes === null) return missing()
    const type = pictureType(bytes)
    if (type === null) return missing()
    if (asked.width === null) return answer(bytes, type)
    const copies = join(root, 'smaller')
    for (const kept of ['image/png', 'image/jpeg'] as const) {
      const copy = await read(join(copies, `${asked.digest}-${asked.width}.${kept === 'image/png' ? 'png' : 'jpg'}`))
      if (copy !== null) return answer(copy, kept)
    }
    const smaller = resize(bytes, type, asked.width)
    if (smaller === null) return answer(bytes, type)
    // Kept for next time where it can be; served either way.
    await keepCopy(copies, `${asked.digest}-${asked.width}.${smaller.type === 'image/png' ? 'png' : 'jpg'}`, smaller.bytes).catch(
      () => undefined,
    )
    return answer(smaller.bytes, smaller.type)
  }
