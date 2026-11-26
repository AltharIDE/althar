// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import { ApiError, ClientAuthority, emitterPort, PictureApi, serverProtocol } from '@althar/contracts'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { RpcServer } from 'effect/rpc'
import { expect, vi } from 'vitest'

import { homePictures } from '../src/main/homes/pictures'
import { pictureUrl } from '../src/main/pictureAddress'
import { servePicture } from '../src/main/pictures'

/*
 * The pictures a thread on a home shows, drawn by a window paired with it:
 * fetched through a connection of the home's own (`ReadPicture`), and kept
 * here by their digest, so each is fetched once.
 */

/* A 1 × 1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const digestOf = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

/** A home serving the pictures it keeps over a port of each connection opened to it, counting what it was asked. */
const home = (kept: ReadonlyMap<string, Buffer>) =>
  Effect.gen(function* () {
    const asked: Array<string> = []
    const ports: Array<MessageChannel> = []
    const scope = yield* Effect.scope
    const open = vi.fn(async () => {
      const channel = new MessageChannel()
      ports.push(channel)
      await Effect.runPromise(
        Effect.forkIn(
          Layer.launch(
            RpcServer.layer(PictureApi).pipe(
              Layer.provide(
                PictureApi.toLayer({
                  ReadPicture: ({ digest }) => {
                    asked.push(digest)
                    const bytes = kept.get(digest)
                    return bytes === undefined
                      ? Effect.fail(new ApiError({ reason: 'NotFound', message: 'This picture isn’t kept here.' }))
                      : Effect.succeed({ mediaType: 'image/png' as const, bodyBase64: bytes.toString('base64') })
                  },
                }),
              ),
              Layer.provide(Layer.succeed(ClientAuthority, (effect) => effect)),
              Layer.provide(serverProtocol(emitterPort(channel.port1))),
            ),
          ),
          scope,
        ),
      )
      return channel.port2 as unknown as Electron.MessagePortMain
    })
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const channel of ports) {
          channel.port1.close()
          channel.port2.close()
        }
      }),
    )
    return { open, asked, ports }
  })

describe('a home’s pictures, for a window paired with it', () => {
  it.live('reads a picture by its digest through one connection, once for the full one and its smaller copy asked together', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const digest = digestOf(PNG)
        const there = yield* home(new Map([[digest, PNG]]))
        const pictures = homePictures(there.open)
        yield* Effect.addFinalizer(() => Effect.sync(pictures.stop))
        const [full, smaller] = yield* Effect.promise(() => Promise.all([pictures.read('home_1', digest), pictures.read('home_1', digest)]))
        assert.isTrue(full?.equals(PNG))
        assert.isTrue(smaller?.equals(PNG))
        assert.deepStrictEqual(there.asked, [digest])
        // Another picture goes over the same connection.
        assert.isNull(yield* Effect.promise(() => pictures.read('home_1', 'f'.repeat(64))))
        assert.strictEqual(there.open.mock.calls.length, 1)
      }),
    ),
  )

  it.live('opens the connection again once it went, and opens none it was told to forget until a picture is wanted', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const digest = digestOf(PNG)
        const there = yield* home(new Map([[digest, PNG]]))
        const pictures = homePictures(there.open)
        yield* Effect.addFinalizer(() => Effect.sync(pictures.stop))
        assert.isTrue((yield* Effect.promise(() => pictures.read('home_1', digest)))?.equals(PNG))
        // The home restarted: its end of the connection closed.
        there.ports[0]?.port1.close()
        assert.isTrue((yield* Effect.promise(() => pictures.read('home_1', digest)))?.equals(PNG))
        assert.strictEqual(there.open.mock.calls.length, 2)
        pictures.forget('home_1')
        assert.strictEqual(there.open.mock.calls.length, 2)
      }),
    ),
  )

  it.live('says nothing of a home no window is connected to', () =>
    Effect.gen(function* () {
      const pictures = homePictures(() => Promise.reject(new Error('No window is connected to this home.')))
      assert.isNull(yield* Effect.promise(() => pictures.read('home_1', digestOf(PNG))))
      pictures.stop()
    }),
  )
})

describe('serving a home’s picture', () => {
  it('fetches one it doesn’t hold, keeps it, and serves it after without asking again', async () => {
    const root = mkdtempSync(join(tmpdir(), 'althar-home-pictures-'))
    const fetch = vi.fn(async () => PNG)
    const serve = servePicture(root, vi.fn(), fetch)
    const first = await serve(new Request(pictureUrl(digestOf(PNG))))
    expect(first.status).toBe(200)
    expect(first.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await first.arrayBuffer()).equals(PNG)).toBe(true)
    const again = await serve(new Request(pictureUrl(digestOf(PNG))))
    expect(Buffer.from(await again.arrayBuffer()).equals(PNG)).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('serves nothing under a digest its bytes aren’t, nor what the home doesn’t keep', async () => {
    const root = mkdtempSync(join(tmpdir(), 'althar-home-pictures-'))
    const other = Buffer.concat([PNG, Buffer.from([0])])
    const serve = servePicture(root, vi.fn(), async (digest) => (digest === digestOf(PNG) ? other : null))
    expect((await serve(new Request(pictureUrl(digestOf(PNG))))).status).toBe(404)
    expect((await serve(new Request(pictureUrl('a'.repeat(64))))).status).toBe(404)
    // And kept none of it.
    const fetch = vi.fn(async () => null)
    expect((await servePicture(root, vi.fn(), fetch)(new Request(pictureUrl(digestOf(PNG))))).status).toBe(404)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
