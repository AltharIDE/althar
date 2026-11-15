import type { PictureUpload } from '@althar/connectors'
import { Duration, Effect } from 'effect'

/** The original stays in Outputs. Only the copy sent to the code host is changed. */
export const fitPicture = (picture: PictureUpload, limit: number) =>
  Effect.tryPromise({
    try: async (signal) => {
      if (picture.bytes.byteLength < limit) return { picture, note: '' }
      const { default: sharp } = await import('sharp')
      const input = picture.bytes
      // libvips decodes and resizes on its worker pool, leaving the runtime free to answer the window.
      // For animations, a first frame is preferable to losing the entire attachment.
      for (const width of [2560, 1920, 1280, 800, 400, 160, 64, 16, 1]) {
        const bytes = await sharp(input, { animated: false })
          .rotate()
          .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
          .flatten({ background: '#ffffff' })
          .jpeg({ quality: 80 })
          .toBuffer()
        if (bytes.byteLength < limit)
          return {
            picture: { bytes, name: `${picture.name.replace(/\.[^.]+$/, '')}.jpg`, mediaType: 'image/jpeg' },
            note: picture.mediaType === 'image/gif' || picture.mediaType.startsWith('video/') ? 'Still frame' : 'Resized for upload',
          }
        if (signal.aborted) return null
      }
      return null
    },
    catch: (error) => error,
  }).pipe(Effect.timeout(Duration.seconds(60)))
