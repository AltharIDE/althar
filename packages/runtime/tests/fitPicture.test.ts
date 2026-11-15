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
