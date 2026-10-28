import { createHash } from 'node:crypto'

import type { ProjectId } from '@althar/domain'
import { SCREENSHOT_PNG } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { Artifacts } from '../src/Artifacts'
import { ImageRefused } from '../src/errors'
import { keepSent } from '../src/sentImages'
import { runtime, task } from './support'

/*
 * The images a person sends with a message, as the runtime reads them
 * before the message is recorded: from the window's bytes or from the store,
 * believed by their bytes, and refused whole where one can't be sent.
 */

const PNG = Buffer.from(SCREENSHOT_PNG, 'base64')
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** Why a send was refused, and of which image. */
const refusal = (error: unknown) => {
  assert.instanceOf(error, ImageRefused)
  return [error.reason, error.name]
}

describe('images sent with a message, as the runtime keeps them', () => {
  it.live('are refused whole where a message carries more than ten', () =>
    Effect.gen(function* () {
      const { project } = yield* task()
      const images = Array.from({ length: 11 }, () => ({ data: SCREENSHOT_PNG, name: 'shot.png' }))
      assert.deepStrictEqual(refusal(yield* Effect.flip(keepSent(project.projectId as ProjectId, images))), ['too_many', null])
    }).pipe(Effect.provide(runtime())),
  )

  it.live('keep a picture whose size its header doesn’t say, with no size, and its name trimmed', () =>
    Effect.gen(function* () {
      const { project } = yield* task()
      // A GIF's signature with nothing after it: a GIF, whose size can't be read.
      const gif = Buffer.from('GIF89a', 'ascii')
      const [kept] = yield* keepSent(project.projectId as ProjectId, [{ data: gif.toString('base64'), name: '  short.gif  ' }])
      assert.deepStrictEqual(kept, {
        sha256: digest(gif),
        size: gif.length,
        mediaType: 'image/gif',
        width: null,
        height: null,
        name: 'short.gif',
      })
      // In the store, by its digest.
      assert.deepStrictEqual(yield* (yield* Artifacts).read(digest(gif)), new Uint8Array(gif))
    }).pipe(Effect.provide(runtime())),
  )

  it.live('are refused where there is no store to keep them in', () =>
    Effect.gen(function* () {
      const { project } = yield* task()
      assert.deepStrictEqual(refusal(yield* Effect.flip(keepSent(project.projectId as ProjectId, [{ data: SCREENSHOT_PNG, name: ' ' }]))), [
        'unkept',
        null,
      ])
    }).pipe(Effect.provide(runtime(':memory:', {}, { artifactsRoot: null }))),
  )

  it.live('are refused, by their name, where one the store keeps already is larger than a message carries', () =>
    Effect.gen(function* () {
      const { project } = yield* task()
      const projectId = project.projectId as ProjectId
      // A picture the project keeps that is larger than 5 MB, as an agent's could be.
      const huge = Buffer.alloc(5 * 1024 * 1024 + 1)
      PNG.copy(huge)
      const kept = yield* (yield* Artifacts).keep({
        projectId,
        bytes: new Uint8Array(huge),
        mediaType: 'image/png',
        kind: 'image',
        sensitivity: 'normal',
        subject: { type: 'thread_item', id: 'item_1', role: 'image' },
      })
      assert.isNotNull(kept)
      assert.deepStrictEqual(refusal(yield* Effect.flip(keepSent(projectId, [{ digest: kept?.sha256 ?? '', name: 'big.png' }]))), [
        'too_large',
        'big.png',
      ])
      // One the project keeps that is small enough is sent again from the store.
      const small = yield* (yield* Artifacts).keep({
        projectId,
        bytes: new Uint8Array(PNG),
        mediaType: 'image/png',
        kind: 'image',
        sensitivity: 'normal',
        subject: { type: 'thread_item', id: 'item_2', role: 'image' },
      })
      const [again] = yield* keepSent(projectId, [{ digest: small?.sha256 ?? '', name: null }])
      assert.deepInclude(again, { sha256: digest(PNG), mediaType: 'image/png', name: null })
    }).pipe(Effect.provide(runtime())),
  )
})
