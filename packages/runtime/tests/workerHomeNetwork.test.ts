import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connect } from 'node:tls'

import { assert, it } from '@effect/vitest'
import { Effect } from 'effect'

import { workerCertificates } from '../../worker-protocol/integration/worker-certificates'
import { configureWorkers, listenWorkers, workerCertificate } from '../src/workerHome/network'
import { workerTestDirectory } from './workerTestFiles'

const homeId = `home_${'1'.repeat(32)}`

const setup = () => {
  const root = workerTestDirectory()
  const paths = { profile: join(root, 'profile'), worktrees: join(root, 'worktrees') }
  mkdirSync(paths.profile, { mode: 0o700 })
  const certificate = workerCertificates(root)
  const configuration = {
    version: 1 as const,
    address: '127.0.0.1',
    port: 0,
    ca: certificate('home-ca.pem'),
    certificate: certificate('home.pem'),
    key: certificate('home.key'),
  }
  return { paths, configuration, certificate, root }
}

it.live('keeps worker listening opt-in and starts and releases the authenticated listener', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { paths, certificate, configuration } = setup()
      assert.isUndefined(yield* listenWorkers(paths, homeId))
      assert.deepStrictEqual(yield* configureWorkers(paths, configuration), { enabled: true })
      const port = yield* Effect.scoped(
        Effect.gen(function* () {
          const listener = yield* listenWorkers(paths, homeId)
          if (listener === undefined) return yield* Effect.die('The worker listener was not started')
          assert.isAbove(listener.port, 0)
          const authorized = yield* Effect.tryPromise(
            () =>
              new Promise<boolean>((resolve, reject) => {
                const client = connect({
                  host: configuration.address,
                  servername: 'localhost',
                  port: listener.port,
                  ca: readFileSync(configuration.ca),
                  cert: readFileSync(certificate('enrolled.pem')),
                  key: readFileSync(certificate('enrolled.key')),
                  ALPNProtocols: ['h2'],
                })
                client.once('error', reject)
                client.setTimeout(2_000, () => client.destroy(new Error('TLS handshake timed out')))
                client.once('secureConnect', () => {
                  resolve(client.authorized && client.alpnProtocol === 'h2')
                  client.destroy()
                })
              }),
          )
          assert.isTrue(authorized)
          yield* configureWorkers(paths, { ...configuration, port: listener.port })
          const conflict = yield* Effect.flip(listenWorkers(paths, homeId))
          assert.include(conflict.message, 'Could not start the worker listener')
          return listener.port
        }),
      )
      assert.strictEqual((yield* listenWorkers(paths, homeId))?.port, port)
      assert.deepStrictEqual(yield* configureWorkers(paths, undefined), { enabled: false })
      assert.isUndefined(yield* listenWorkers(paths, homeId))
    }),
  ),
)

it.live('validates worker certificates and private paths before replacing the saved configuration', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { paths, certificate, configuration } = setup()
      const verify = (given: string) =>
        Effect.tryPromise({
          try: () => workerCertificate(given),
          catch: (error) => (error instanceof Error ? error.message : String(error)),
        })
      assert.match(yield* verify(certificate('enrolled.pem')), /^[a-f0-9]{64}$/)
      for (const bad of [certificate('home-ca.pem'), certificate('absent.pem')]) {
        assert.include(yield* Effect.flip(verify(bad)), 'worker client certificate')
      }
      mkdirSync(paths.worktrees, { mode: 0o700 })
      const checkoutKey = join(paths.worktrees, 'key.pem')
      writeFileSync(checkoutKey, readFileSync(configuration.key), { mode: 0o600 })
      for (const invalid of [
        { address: 'localhost' },
        { ca: 'relative.pem' },
        { key: join(paths.profile, 'missing.pem') },
        { key: checkoutKey },
        { certificate: certificate('missing.pem') },
        { ca: certificate('enrolled.pem') },
        { key: certificate('enrolled.key') },
      ]) {
        yield* Effect.flip(configureWorkers(paths, { ...configuration, ...invalid }))
      }
      assert.isUndefined(yield* listenWorkers(paths, homeId))
      writeFileSync(join(paths.profile, 'workers.json'), '{', { mode: 0o600 })
      yield* Effect.flip(listenWorkers(paths, homeId))
    }),
  ),
)

it.live('keeps the local listener ready while a configured relay is offline', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { paths, configuration, certificate, root } = setup()
      const relay = join(root, 'relay.json')
      const tokenFile = join(root, 'relay-token')
      const url = `wss://localhost:1/v1/worker-relay/wrl_${'a'.repeat(32)}/home`
      const link = { url, tokenFile, caFile: certificate('home-ca.pem') }
      for (const bad of [{ tokenFile: 'relative' }, { caFile: certificate('absent.pem') }, { url: 'ws://localhost:1/worker-relay' }]) {
        writeFileSync(relay, JSON.stringify({ ...link, ...bad }), { mode: 0o600 })
        assert.include((yield* Effect.flip(configureWorkers(paths, { ...configuration, relay }))).message, 'private worker relay link')
      }
      writeFileSync(tokenFile, 'a'.repeat(43), { mode: 0o600 })
      writeFileSync(relay, JSON.stringify(link), { mode: 0o600 })
      yield* configureWorkers(paths, { ...configuration, address: '0.0.0.0', relay })
      assert.isAbove((yield* listenWorkers(paths, homeId))?.port ?? 0, 0)
    }),
  ),
)
