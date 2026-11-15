import { assert, it } from '@effect/vitest'
import { Effect } from 'effect'
import sharp from 'sharp'

import { fitPicture } from '../src/fitPicture'
import { RECORDING_GIF } from './recording'

it.effect('keeps small animations unchanged and uses a decodable still frame when an animation exceeds the host limit', () =>
  Effect.gen(function* () {
    const gif = { bytes: RECORDING_GIF, name: 'motion.gif', mediaType: 'image/gif' }
    assert.strictEqual((yield* fitPicture(gif, 10_000_000))?.picture, gif)
    const fitted = yield* fitPicture(gif, RECORDING_GIF.byteLength)
    assert.isNotNull(fitted)
    assert.strictEqual(fitted?.note, 'Still frame')
    assert.strictEqual(fitted?.picture.name, 'motion.jpg')
    const info = yield* Effect.promise(() => sharp(fitted!.picture.bytes).metadata())
    assert.strictEqual(info.format, 'jpeg')
    assert.isBelow(fitted?.picture.bytes.byteLength ?? Infinity, RECORDING_GIF.byteLength)
  }),
)

it.effect('reports that media cannot fit even after reducing it', () =>
  Effect.gen(function* () {
    assert.isNull(yield* fitPicture({ bytes: RECORDING_GIF, name: 'motion.gif', mediaType: 'image/gif' }, 1))
  }),
)

it.effect('reports decoder failures separately from media that cannot fit', () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(fitPicture({ bytes: new Uint8Array(100), name: 'broken.png', mediaType: 'image/png' }, 10))
    assert.instanceOf(error, Error)
  }),
)
