import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import { Api, clientProtocol, emitterPort } from '@althar/contracts'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { RpcClient } from 'effect/rpc'

import { connection, services } from '../src/Api'
import type { RuntimeOptions } from '../src/Config'
import { readHealth } from '../src/mcpHealth'
import { Secrets } from '../src/Secrets'
import { homeWith } from './agentHome'
import { fakeAgents, fakeConnectors, ROOMY } from './support'

/*
 * Settings' check of how the person's servers stand, through the API: each agent's own list command asked, in a home
 * of the test's own with a fake of each, and what they said kept for the tiles; a runtime that doesn't read the
 * person's agents asks none.
 */

const commandId = () => `cmd_${randomBytes(16).toString('hex')}`

const connected = (agentConfigs: RuntimeOptions['agentConfigs']) =>
  Effect.gen(function* () {
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
        busy: { machine: ROOMY },
        checksAppear: Duration.zero,
        ...(agentConfigs === undefined ? {} : { agentConfigs }),
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
    return yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
  })

describe('checking the person’s servers, through the API', () => {
  it.live('asks each agent’s own list command, and keeps what they said', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const home = homeWith({})
        const folder = join(home, 'althar-profile')
        const calls: Array<string> = []
        const run: NonNullable<NonNullable<RuntimeOptions['agentConfigs']>['run']> = async (command, args) => {
          calls.push([command, ...args].join(' '))
          if (command === 'claude') return { code: 0, output: 'linear: https://mcp.linear.app/mcp (HTTP) - ⚠ Needs authentication\n' }
          if (command === 'opencode') return { code: 0, output: '✗ notion  failed: Connection closed\n' }
          return { code: 127, output: 'Its `codex` command isn’t on this computer.' }
        }
        const client = yield* connected({ homeDir: home, folder, run, env: {} })
        yield* client.CheckServers({ commandId: commandId() })
        assert.deepStrictEqual(calls.sort(), ['claude mcp list', 'codex mcp list --json', 'opencode mcp list'])
        const kept = readHealth({ folder })
        assert.isNotNull(kept.checkedAt)
        assert.deepStrictEqual(Object.fromEntries(Object.entries(kept.servers).map(([name, agents]) => [name, Object.keys(agents)])), {
          linear: ['claude'],
          notion: ['opencode'],
        })
        assert.strictEqual(kept.servers['notion']?.opencode?.why, 'Connection closed')
      }),
    ),
  )

  it.live('asks none where this runtime doesn’t read the person’s agents', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* connected(undefined)
        // Nothing to ask with, and nothing refused: the tiles read what was kept, which is nothing.
        assert.isUndefined(yield* client.CheckServers({ commandId: commandId() }))
      }),
    ),
  )
})
