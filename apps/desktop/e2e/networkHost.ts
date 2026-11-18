/** Standalone host fixture: real SQLite, private API, HTTPS/WSS, pairing and revocation; no provider accounts. */
import { join } from 'node:path'

import { Agents } from '@althar/runtime'
import { apiClient, openLocalConnection } from '@althar/transport-node'
import { Effect, Layer, Logger } from 'effect'

import { HostError } from '../../host/src/errors'
import { configureNetwork } from '../../host/src/network'
import { initializeHome, serveHome } from '../../host/src/home'
import { parseOptions } from '../../host/src/options'
import { issuePairing, listConnectionDevices, revokeConnectionDevice } from '../../host/src/pairing'

const action = process.argv[2]
const root = process.argv[3] ?? ''
const profile = join(root, 'profile')
const args = ['--profile', profile, '--key-file', join(root, 'master-key')]
const dependencies = {
  agents: Layer.succeed(Agents, Agents.from([])),
  agentConfigs: { homeDir: join(root, 'agent-home'), folder: join(root, 'agent-sync') },
}
const stop = new AbortController()
process.once('SIGTERM', () => stop.abort())
process.once('SIGINT', () => stop.abort())
const options = parseOptions(['init', ...args, '--project', join(root, 'remote-project')], {}, root)

const command = Effect.gen(function* () {
  if (action === 'pair') {
    const result = yield* issuePairing(options)
    process.stdout.write(JSON.stringify(result))
    return
  }
  if (action === 'revoke') {
    yield* revokeConnectionDevice({ ...options, revokeDeviceId: process.argv[4] ?? '' })
    return
  }
  if (action === 'devices') {
    process.stdout.write(JSON.stringify(yield* listConnectionDevices(options)))
    return
  }
  const initialized = yield* initializeHome(options, dependencies)
  const port = Number(process.argv[4])
  yield* configureNetwork({
    ...options,
    network: {
      version: 1,
      address: '127.0.0.1',
      port,
      origin: `https://127.0.0.1:${port}`,
      certificate: join(root, 'certificate.pem'),
      key: join(root, 'key.pem'),
    },
  })
  yield* serveHome(
    options,
    (ready) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { api } = yield* apiClient(yield* openLocalConnection(profile, ready.homeId))
          const projectId = initialized.projects[0]
          if (projectId === undefined) throw new Error('No fixture project')
          // A fixed command id also proves a restart does not duplicate this recorded task.
          const task = yield* api.CreateTask({ commandId: `cmd_${'1'.repeat(32)}`, projectId, title: 'A server task' })
          process.stdout.write(`${JSON.stringify({ ...ready, projectId, taskId: task.id })}\n`)
        }),
      ).pipe(Effect.mapError(() => new HostError({ code: 'InvalidConfig', message: 'The fixture could not create its recorded task.' }))),
    dependencies,
  )
})
await Effect.runPromise(command.pipe(Effect.provide(Logger.layer([]))), { signal: stop.signal }).catch((error: unknown) => {
  if (!stop.signal.aborted) {
    console.error(error)
    process.exitCode = 1
  }
})
