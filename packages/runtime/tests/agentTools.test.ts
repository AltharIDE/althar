import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import { Api, clientProtocol, emitterPort } from '@althar/contracts'
import { agentServers } from '@althar/provider-adapters'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { RpcClient } from 'effect/rpc'

import { connection, services } from '../src/Api'
import type { RuntimeOptions } from '../src/Config'
import { Secrets } from '../src/Secrets'
import { fakeAgents as fakeCommands, homeWith } from './agentHome'
import { fakeAgents, fakeConnectors, ROOMY } from './support'

/*
 * The person's MCP servers through the API, as Settings has them (ADR-097),
 * in a home of the test's own: the switch, a read of Settings that brings
 * the agents in step with what the person changed since, and what an agent's
 * command couldn't do, said there.
 */

const commandId = () => `cmd_${randomBytes(16).toString('hex')}`

const connected = (agentConfigs: NonNullable<RuntimeOptions['agentConfigs']>) =>
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
        agentConfigs,
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

describe('the person’s MCP servers, through the API', () => {
  it.live('lists each server with the roles it loads in, and keeps a role taken off', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const home = homeWith({ claude: { mcpServers: { linear: { type: 'http', url: 'https://mcp.linear.app/mcp' } } } })
        const { io } = fakeCommands(home)
        const client = yield* connected({ homeDir: home, folder: io.folder, run: io.run })
        const before = yield* client.GetAgentTools({ projectId: null })
        assert.deepStrictEqual(
          before.servers.map((one) => [one.name, one.roles]),
          [['linear', ['lead', 'reviewer', 'coordinator']]],
        )
        yield* client.SetToolRoles({ commandId: commandId(), kind: 'server', name: 'linear', roles: ['lead'], projectId: null })
        assert.deepStrictEqual((yield* client.GetAgentTools({ projectId: null })).servers[0]?.roles, ['lead'])
      }),
    ),
  )

  it.live('brings a server the person added since into the other agents as Settings reads them, while the switch is on', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const home = homeWith({ claude: { mcpServers: { a: { command: 'a' } } } })
        const { io } = fakeCommands(home)
        const client = yield* connected({ homeDir: home, folder: io.folder, run: io.run })
        yield* client.SetToolSync({ commandId: commandId(), kind: 'server', on: true, takeBack: false })
        // The person adds one to Claude Code, by hand.
        const claude = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')) as { mcpServers: Record<string, unknown> }
        claude.mcpServers['notion'] = { type: 'http', url: 'https://mcp.notion.com/mcp' }
        writeFileSync(join(home, '.claude.json'), JSON.stringify(claude))
        const tools = yield* client.GetAgentTools({ projectId: null })
        assert.deepStrictEqual(
          agentServers('codex', { homeDir: home }).servers.map((one) => one.name),
          ['a', 'notion'],
        )
        assert.deepStrictEqual(tools.serverSync.since[0]?.name, 'notion')
        assert.deepStrictEqual(tools.serverSync.since[0]?.to, ['codex', 'opencode'])
      }),
    ),
  )

  it.live('says what an agent’s command couldn’t do, and keeps what it couldn’t take back', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const home = homeWith({ claude: { mcpServers: { a: { command: 'a' } } } })
        const { io } = fakeCommands(home, ['codex'])
        const client = yield* connected({ homeDir: home, folder: io.folder, run: io.run })
        yield* client.SetToolSync({ commandId: commandId(), kind: 'server', on: true, takeBack: false })
        const tools = yield* client.GetAgentTools({ projectId: null })
        assert.deepStrictEqual(tools.serverSync.errors, ["Codex: codex: couldn't write its settings"])
        // OpenCode got it; Codex didn't, and its file is as it was.
        assert.deepStrictEqual(tools.serverSync.targets.find((one) => one.agent === 'opencode')?.adds, ['a'])
        assert.deepStrictEqual(agentServers('codex', { homeDir: home }).servers, [])
      }),
    ),
  )
})
