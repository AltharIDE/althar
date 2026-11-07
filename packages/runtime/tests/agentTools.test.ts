import { randomBytes } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
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

const connected = (agentConfigs: RuntimeOptions['agentConfigs'], openTerminal?: RuntimeOptions['openTerminal']) =>
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
        ...(openTerminal === undefined ? {} : { openTerminal }),
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
        const client = yield* connected({ homeDir: home, folder: io.folder, run: io.run, env: {} })
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
        const client = yield* connected({ homeDir: home, folder: io.folder, run: io.run, env: {} })
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
        const client = yield* connected({ homeDir: home, folder: io.folder, run: io.run, env: {} })
        yield* client.SetToolSync({ commandId: commandId(), kind: 'server', on: true, takeBack: false })
        const tools = yield* client.GetAgentTools({ projectId: null })
        assert.deepStrictEqual(tools.serverSync.errors, ["Codex: codex: couldn't write its settings"])
        // OpenCode got it; Codex didn't, and its file is as it was.
        assert.deepStrictEqual(tools.serverSync.targets.find((one) => one.agent === 'opencode')?.adds, ['a'])
        assert.deepStrictEqual(agentServers('codex', { homeDir: home }).servers, [])
      }),
    ),
  )
  it.live('keeps saying a chip’s take-back that failed, and takes it back once the agent’s command works', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const home = homeWith({ claude: { mcpServers: { a: { command: 'a' } } } })
        const working = fakeCommands(home)
        let broken = false
        const run: NonNullable<RuntimeOptions['agentConfigs']>['run'] = (command, args) =>
          broken && command === 'codex' && args[1] === 'remove'
            ? Promise.resolve({ code: 1, output: "codex: couldn't write its settings" })
            : working.io.run(command, args)
        const client = yield* connected({ homeDir: home, folder: working.io.folder, run, env: {} })
        yield* client.SetToolSync({ commandId: commandId(), kind: 'server', on: true, takeBack: false })
        broken = true
        yield* client.SetToolKeptOut({ commandId: commandId(), kind: 'server', agent: 'codex', name: 'a', out: true })
        const after = yield* client.GetAgentTools({ projectId: null })
        assert.deepStrictEqual(after.serverSync.errors, ["Codex: codex: couldn't write its settings"])
        assert.deepStrictEqual(
          agentServers('codex', { homeDir: home }).servers.map((one) => one.name),
          ['a'],
        )
        broken = false
        const again = yield* client.GetAgentTools({ projectId: null })
        assert.deepStrictEqual(again.serverSync.errors, [])
        assert.deepStrictEqual(agentServers('codex', { homeDir: home }).servers, [])
      }),
    ),
  )

  it.live('keeps skills the same, and puts back, picks, undoes and signs in through the API', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const home = realpathSync(
          homeWith({
            claude: { mcpServers: { a: { command: 'a' }, linear: { type: 'http', url: 'https://mcp.linear.app/mcp' } } },
            codex: { mcp_servers: { twice: { command: 'two' } } },
          }),
        )
        const claude = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')) as { mcpServers: Record<string, unknown> }
        claude.mcpServers['twice'] = { command: 'one' }
        writeFileSync(join(home, '.claude.json'), JSON.stringify(claude))
        mkdirSync(join(home, '.claude', 'skills', 'notes'), { recursive: true })
        writeFileSync(join(home, '.claude', 'skills', 'notes', 'SKILL.md'), '---\nname: notes\n---\n')
        const { io } = fakeCommands(home)
        const opened: Array<string> = []
        const client = yield* connected({ homeDir: home, folder: io.folder, run: io.run, env: {} }, (line) =>
          Effect.sync(() => {
            opened.push(line)
            return true
          }),
        )
        const codexHas = () => agentServers('codex', { homeDir: home }).servers.map((one) => one.name)

        yield* client.SetToolSync({ commandId: commandId(), kind: 'skill', on: true, takeBack: false })
        const link = join(home, '.agents', 'skills', 'notes')
        assert.isTrue(lstatSync(link).isSymbolicLink())
        yield* client.SetToolKeptOut({ commandId: commandId(), kind: 'skill', agent: 'codex', name: 'notes', out: true })
        assert.isFalse(existsSync(link))
        yield* client.SetToolKeptOut({ commandId: commandId(), kind: 'skill', agent: 'codex', name: 'notes', out: false })
        assert.isTrue(lstatSync(link).isSymbolicLink())
        yield* client.PickToolWay({ commandId: commandId(), kind: 'skill', name: 'notes', way: 'apart' })
        yield* client.SetToolSync({ commandId: commandId(), kind: 'skill', on: false, takeBack: true })
        assert.isFalse(existsSync(link))

        yield* client.SetToolSync({ commandId: commandId(), kind: 'server', on: true, takeBack: false })
        assert.includeMembers(codexHas(), ['a', 'linear'])
        yield* client.SetToolKeptOut({ commandId: commandId(), kind: 'server', agent: 'codex', name: 'a', out: true })
        assert.notInclude(codexHas(), 'a')
        yield* client.SetToolKeptOut({ commandId: commandId(), kind: 'server', agent: 'codex', name: 'a', out: false })
        assert.include(codexHas(), 'a')
        yield* client.PickToolWay({ commandId: commandId(), kind: 'server', name: 'twice', way: 'claude' })
        assert.strictEqual(agentServers('codex', { homeDir: home }).servers.find((one) => one.name === 'twice')?.command, 'one')

        // The person takes a out of Codex by hand, then undoes it from Since.
        writeFileSync(join(home, '.codex', 'config.toml'), '')
        const since = (yield* client.GetAgentTools({ projectId: null })).serverSync.since.find((one) => one.name === 'a')
        assert.strictEqual(since?.kind, 'tookOut')
        yield* client.UndoToolSync({ commandId: commandId(), id: since!.id })
        assert.include(codexHas(), 'a')

        yield* client.SignInToolServer({ commandId: commandId(), agent: 'codex', name: 'linear' })
        yield* client.SignInToolServer({ commandId: commandId(), agent: 'opencode', name: 'linear' })
        assert.deepStrictEqual(opened, ['codex mcp login linear'])
        const settle = (yield* client.GetAgentTools({ projectId: null })).serverSync.settle
        // Copied to Codex and OpenCode, and signed in to in both: nothing waits on it.
        assert.isFalse(settle.some((one) => one.kind === 'signIn'))
      }),
    ),
  )

  it.live('refuses to keep the agents the same where Althar reads none of their settings', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* connected(undefined)
        const failed = yield* client.SetToolSync({ commandId: commandId(), kind: 'server', on: true, takeBack: false }).pipe(Effect.flip)
        assert.isDefined(failed)
        yield* client.SignInToolServer({ commandId: commandId(), agent: 'codex', name: 'linear' })
        assert.isFalse((yield* client.GetAgentTools({ projectId: null })).enabled)
      }),
    ),
  )
})
