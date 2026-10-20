import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import { Api, ApiError, clientProtocol, emitterPort } from '@althar/contracts'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { RpcClient } from 'effect/rpc'

import { connection, services } from '../src/Api'
import { Secrets } from '../src/Secrets'

import { fakeAgents, fakeConnectors, ROOMY } from './support'

/*
 * What the window says when the person writes to a thread that went while
 * it was open: a message, or one sent with a switch of agent.
 */

const commandId = () => `cmd_${randomBytes(16).toString('hex')}`

/** The runtime serving the API on one end of a channel, and a client on the other. */
const connected = Effect.gen(function* () {
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
      artifactsRoot: mkdtempSync(join(tmpdir(), 'althar-artifacts-')),
      busy: { machine: ROOMY },
      checksAppear: Duration.zero,
    }),
  )
  yield* Effect.forkScoped(Layer.launch(connection(emitterPort(channel.port1, (data) => data))).pipe(Effect.provideContext(context)))
  const protocol = yield* Layer.build(clientProtocol(emitterPort(channel.port2, (data) => data)))
  return yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
})

/** What a call that can't be done says, as the window shows it. */
const refused = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.map(Effect.flip(effect), (error) => {
    assert.instanceOf(error, ApiError)
    return error instanceof ApiError ? error.message : ''
  })

describe('writing to a thread that has gone, from the window', () => {
  it.live('says it isn’t there, for a message and for one sent with a switch of agent', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* connected
        assert.strictEqual(
          yield* refused(client.Send({ commandId: commandId(), threadId: 'thr_gone', body: 'Still there?', disposition: 'after_current' })),
          "That task isn't there any more.",
        )
        assert.match(
          yield* refused(
            client.SwitchAgent({ commandId: commandId(), threadId: 'thr_gone', agentId: 'codex', body: 'Take it from here.' }),
          ),
          /^That task.* isn't there any more\.$/,
        )
      }),
    ),
  )
})
