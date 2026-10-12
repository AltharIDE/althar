import type { SentImage } from '@althar/contracts'
import type { ProjectId } from '@althar/domain'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Artifacts } from './Artifacts'
import { ImageRefused } from './errors'
import { MESSAGE_IMAGES, pictureSize, pictureType, type PictureType } from './pictures'

/*
 * The images the person sends with a message (docs/architecture/07): read
 * from the bytes the window sent, or from the store where Althar keeps one
 * already, as when a message waiting its turn is taken back and sent again.
 * The bytes are believed, not a name: only PNG, JPEG, GIF and WebP are sent,
 * each of at most MESSAGE_IMAGES.bytes, and a message carries at most
 * MESSAGE_IMAGES.count. Each is written to the artifact store before the
 * command that records the message runs, so no file is written inside its
 * transaction; the message names them by their digests.
 */

/** An image the person sent, in the store, for its message to record. */
export interface InputImage {
  readonly sha256: string
  readonly size: number
  readonly mediaType: PictureType
  readonly width: number | null
  readonly height: number | null
  readonly name: string | null
}

/** How much of a name is kept: a file's name, not a paragraph. */
const NAME_KEPT = 200

/** A base64 string's length, as bytes, without decoding it. */
const decodedLength = (base64: string) => Math.floor((base64.replace(/=+$/, '').length * 3) / 4)

/** One image's bytes: from the window, or from the store, where it is one of the project's own pictures. */
const bytesOf = (projectId: ProjectId, image: SentImage, name: string | null) =>
  Effect.gen(function* () {
    if ('data' in image) {
      if (decodedLength(image.data) > MESSAGE_IMAGES.bytes) return yield* new ImageRefused({ reason: 'too_large', name })
      return new Uint8Array(Buffer.from(image.data, 'base64'))
    }
    const sql = yield* SqlClient.SqlClient
    const [known] = yield* sql<{ id: string }>`
      SELECT id FROM artifacts WHERE project_id = ${projectId} AND sha256 = ${image.digest} AND kind = 'image' LIMIT 1`
    const bytes = known === undefined ? null : yield* (yield* Artifacts).read(image.digest)
    return bytes ?? (yield* new ImageRefused({ reason: 'missing', name }))
  })

/** Reads, checks and keeps the images sent with a message, in their order; refused whole where one can't be sent. */
export const keepSent = (projectId: ProjectId, images: ReadonlyArray<SentImage>) =>
  Effect.gen(function* () {
    if (images.length > MESSAGE_IMAGES.count) return yield* new ImageRefused({ reason: 'too_many', name: null })
    const artifacts = yield* Artifacts
    return yield* Effect.forEach(images, (image) =>
      Effect.gen(function* () {
        const name = image.name === null || image.name.trim() === '' ? null : image.name.trim().slice(0, NAME_KEPT)
        const bytes = yield* bytesOf(projectId, image, name)
        const type = pictureType(bytes)
        if (type === null) return yield* new ImageRefused({ reason: 'unsupported', name })
        if (bytes.length > MESSAGE_IMAGES.bytes) return yield* new ImageRefused({ reason: 'too_large', name })
        const put = yield* artifacts.put(bytes)
        if (put === null) return yield* new ImageRefused({ reason: 'unkept', name })
        const size = pictureSize(bytes, type)
        return {
          sha256: put.sha256,
          size: put.size,
          mediaType: type,
          width: size?.width ?? null,
          height: size?.height ?? null,
          name,
        } satisfies InputImage
      }),
    )
  })
