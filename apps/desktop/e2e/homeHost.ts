/** Isolated SSH fixture: the production stdio bridge reaches only this spec's private fake-agent runtime. */
import { API_VERSION } from '@althar/contracts'
import { openLocalConnection, apiClient, readLocalEndpoint } from '@althar/transport-node'
import { Effect, Logger } from 'effect'
import { serveStdio } from '../../host/src/stdioBridge'

const value = (flag: string) => process.argv[process.argv.indexOf(flag) + 1] ?? ''
const profile = value('--profile')
await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      if (process.argv[2] === 'status') {
        const endpoint = yield* readLocalEndpoint(profile)
        const { info } = yield* apiClient(yield* openLocalConnection(profile, endpoint.homeId))
        process.stdout.write(
          JSON.stringify({
            state: 'ready',
            homeId: info.identity.homeId,
            hostDeviceId: info.hostDeviceId,
            apiVersion: API_VERSION,
            version: 'SSH desktop fixture',
          }),
        )
      } else {
        yield* serveStdio(profile, value('--home-id'), Number(value('--client-api-version')), {
          input: process.stdin,
          output: process.stdout,
        })
      }
    }),
  ).pipe(Effect.provide(Logger.layer([]))),
)
