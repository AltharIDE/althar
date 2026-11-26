import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import { Api, ApiError, clientProtocol, emitterPort, SOCKET_CALLS } from '@althar/contracts'
import { SCREENSHOT_PNG } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { RpcClient } from 'effect/rpc'

import { connection, services } from '../src/Api'
import { artifactPath } from '../src/artifactFiles'
import { Secrets } from '../src/Secrets'

import { fakeAgents, fakeConnectors, ROOMY } from './support'

/*
 * A picture a thread shows, read by its digest through the API: how a window
 * on another computer, or a phone, draws what the home keeps (`ReadPicture`).
 */

/** The runtime serving the API over a channel, with an artifact store of the test's own, and a client on the other end. */
const connected = Effect.gen(function* () {
  const root = mkdtempSync(join(tmpdir(), 'althar-artifacts-'))
  const channel = new MessageChannel()
  yield* Effect.addFinalizer(() => Effect.sync(() => channel.port1.close()))
  const context = yield* Layer.build(
    services({
      database: ':memory:',
      worktreeRoot: mkdtempSync(join(tmpdir(), 'althar-worktrees-')),
      appVersion: '0.0.0-test',
      deviceName: 'Test Mac',
      agents: fakeAgents(),
      secrets: Secrets.memory(),
      connectors: fakeConnectors({}),
      accountsRoot: mkdtempSync(join(tmpdir(), 'althar-accounts-')),
      artifactsRoot: root,
      busy: { machine: ROOMY },
      checksAppear: Duration.zero,
    }),
  )
  yield* Effect.forkScoped(
    Layer.launch(
      connection(
        emitterPort(channel.port1, (data) => data),
        { kind: 'window' },
      ),
    ).pipe(Effect.provideContext(context)),
  )
  const protocol = yield* Layer.build(clientProtocol(emitterPort(channel.port2, (data) => data)))
  const client = yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
  /** Keeps bytes in the store as the runtime does, by their digest. */
  const keep = (bytes: Uint8Array) => {
    const digest = createHash('sha256').update(bytes).digest('hex')
    const path = artifactPath(root, digest)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, bytes)
    return digest
  }
  return { client, keep }
})

describe('reading a picture a thread shows', () => {
  it.live('gives a kept picture’s bytes by its digest, and is a call a home’s other windows and phones may make', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, keep } = yield* connected
        const png = Buffer.from(SCREENSHOT_PNG, 'base64')
        const read = yield* client.ReadPicture({ digest: keep(png) })
        assert.strictEqual(read.mediaType, 'image/png')
        assert.deepStrictEqual(Buffer.from(read.bodyBase64, 'base64'), png)
        assert.include(SOCKET_CALLS, 'ReadPicture')
      }),
    ),
  )

  it.live('gives nothing that isn’t a picture the window draws, nor one it doesn’t keep', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, keep } = yield* connected
        // A command's output, or a canvas's page, is kept the same way: never served as a picture.
        const page = keep(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))
        for (const digest of [page, 'f'.repeat(64)]) {
          const error = yield* Effect.flip(client.ReadPicture({ digest }))
          assert.instanceOf(error, ApiError)
          assert.strictEqual(error instanceof ApiError ? error.reason : '', 'NotFound')
        }
      }),
    ),
  )
})
