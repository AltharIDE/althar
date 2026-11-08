import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { agentServers, type AgentServers, type ServerSpec } from '@althar/provider-adapters'
import { describe, expect, it } from 'vitest'

import { fakeAgents, homeWith } from './agentHome'
import {
  claudeJson,
  codexArgs,
  emptyRecord,
  openCodeEntry,
  pickWay,
  planSync,
  readRecord,
  reconcile,
  signIn,
  turnOn,
  undoSince,
} from '../src/mcpSync'

/*
 * How sync writes each kind of server in each agent's own way, what it can't
 * carry to Codex, and the steps around it (a server left apart, a sign-in,
 * Undo of what the person took out), against a temporary home.
 */

const names = (home: string, agent: 'claude' | 'codex' | 'opencode') =>
  agentServers(agent, { homeDir: home })
    .servers.map((server) => server.name)
    .sort()

const agents = (claude: ReadonlyArray<ServerSpec>, codex: ReadonlyArray<ServerSpec> = []): ReadonlyArray<AgentServers> => [
  { agent: 'claude', file: '~/.claude.json', path: '/nowhere/.claude.json', servers: claude },
  { agent: 'codex', file: '~/.codex/config.toml', path: '/nowhere/config.toml', servers: codex },
  { agent: 'opencode', file: '~/.config/opencode/opencode.json', path: '/nowhere/opencode.json', servers: [] },
]

describe('each agent’s way of writing a server', () => {
  const remote: ServerSpec = {
    name: 'api',
    transport: 'http',
    url: 'https://api.example/mcp',
    headers: { Authorization: 'Bearer {env:API_TOKEN}', 'X-Team': 'web' },
  }
  const local: ServerSpec = { name: 'tool', transport: 'stdio', command: 'tool', args: ['--fast'], env: { MODE: '$MODE', LEVEL: 'two' } }

  it('is Claude Code’s add-json, with references written its way', () => {
    expect(claudeJson(local)).toEqual({ type: 'stdio', command: 'tool', args: ['--fast'], env: { MODE: '${MODE}', LEVEL: 'two' } })
    expect(claudeJson({ name: 'bare', transport: 'stdio', command: 'bare' })).toEqual({ type: 'stdio', command: 'bare', args: [] })
    expect(claudeJson(remote)).toEqual({
      type: 'http',
      url: 'https://api.example/mcp',
      headers: { Authorization: 'Bearer ${API_TOKEN}', 'X-Team': 'web' },
    })
    expect(claudeJson({ name: 'b', transport: 'http', url: 'https://b.example/mcp', tokenVariable: 'B_TOKEN' })).toEqual({
      type: 'http',
      url: 'https://b.example/mcp',
      headers: { Authorization: 'Bearer ${B_TOKEN}' },
    })
    expect(claudeJson({ name: 'c', transport: 'sse', url: 'https://c.example/sse' })).toEqual({ type: 'sse', url: 'https://c.example/sse' })
  })

  it('is Codex’s mcp add, with a bearer token by its variable', () => {
    expect(codexArgs(local)).toEqual(['mcp', 'add', 'tool', '--env', 'MODE=$MODE', '--env', 'LEVEL=two', '--', 'tool', '--fast'])
    expect(codexArgs({ name: 'bare', transport: 'stdio' })).toEqual(['mcp', 'add', 'bare', '--', ''])
    expect(codexArgs(remote)).toEqual(['mcp', 'add', 'api', '--url', 'https://api.example/mcp', '--bearer-token-env-var', 'API_TOKEN'])
    expect(codexArgs({ name: 'l', transport: 'http', url: 'https://l.example/mcp', headers: { authorization: 'Bearer ${L}' } })).toEqual([
      'mcp',
      'add',
      'l',
      '--url',
      'https://l.example/mcp',
      '--bearer-token-env-var',
      'L',
    ])
    expect(codexArgs({ name: 'n', transport: 'http' })).toEqual(['mcp', 'add', 'n', '--url', ''])
  })

  it('is OpenCode’s entry, with references written its way', () => {
    expect(openCodeEntry(local)).toEqual({ type: 'local', command: ['tool', '--fast'], environment: { MODE: '{env:MODE}', LEVEL: 'two' } })
    expect(openCodeEntry({ name: 'bare', transport: 'stdio' })).toEqual({ type: 'local', command: [''] })
    expect(openCodeEntry(remote)).toEqual({
      type: 'remote',
      url: 'https://api.example/mcp',
      headers: { Authorization: 'Bearer {env:API_TOKEN}', 'X-Team': 'web' },
    })
    expect(openCodeEntry({ name: 'b', transport: 'http', url: 'https://b.example/mcp', tokenVariable: 'B_TOKEN' })).toEqual({
      type: 'remote',
      url: 'https://b.example/mcp',
      headers: { Authorization: 'Bearer {env:B_TOKEN}' },
    })
    expect(openCodeEntry({ name: 'c', transport: 'http', url: 'https://c.example/mcp' })).toEqual({
      type: 'remote',
      url: 'https://c.example/mcp',
    })
  })
})

describe('what sync can’t carry, and what it leaves', () => {
  it('can’t give Codex an SSE server, headers other than a bearer token by its variable, or a command’s environment by name', () => {
    const plan = planSync(
      emptyRecord,
      agents([
        { name: 'events', transport: 'sse', url: 'https://events.example/sse' },
        { name: 'team', transport: 'http', url: 'https://team.example/mcp', headers: { 'X-Team': 'web' } },
        { name: 'plain', transport: 'http', url: 'https://plain.example/mcp', headers: { Authorization: 'Bearer abc' } },
        { name: 'named', transport: 'stdio', command: 'named', env: { HOME_DIR: '${HOME}' } },
        { name: 'fine', transport: 'stdio', command: 'fine', env: { MODE: 'one' } },
      ]),
    )
    const cant = plan.settle.flatMap((each) => (each.kind === 'cant' ? [`${each.server}:${each.agent}:${each.why}`] : []))
    // A token written out is a secret, which goes nowhere.
    expect(cant.sort()).toEqual([
      'events:codex:sse',
      'named:codex:reference',
      'plain:codex:secret',
      'plain:opencode:secret',
      'team:codex:headers',
    ])
    expect(plan.here['events']).toEqual({ claude: 'in', codex: 'cant', opencode: 'missing' })
    expect(plan.adds.filter((each) => each.agent === 'codex').map((each) => each.spec.name)).toEqual(['fine'])
    expect(plan.adds.filter((each) => each.agent === 'opencode').map((each) => each.spec.name)).toEqual(['events', 'fine', 'named', 'team'])
  })

  it('leaves a server set up two ways alone once the person keeps it apart', () => {
    const two = agents([{ name: 'gh', transport: 'stdio', command: 'one' }], [{ name: 'gh', transport: 'stdio', command: 'two' }])
    expect(planSync(emptyRecord, two).settle).toContainEqual(expect.objectContaining({ kind: 'differs', server: 'gh' }))
    const apart = planSync({ ...emptyRecord, picks: { gh: 'apart' } }, two)
    expect(apart.settle).toEqual([])
    expect(apart.adds).toEqual([])
    expect(apart.here['gh']).toEqual({ claude: 'in', codex: 'in', opencode: 'missing' })
  })

  it('leaves a picked way off the agent where the person turned theirs off, or kept it out', () => {
    const plan = planSync({ ...emptyRecord, picks: { gh: 'claude' }, keptOut: { claude: [], codex: [], opencode: ['gh'] } }, [
      { agent: 'claude', file: 'c', path: 'c', servers: [{ name: 'gh', transport: 'stdio', command: 'one' }] },
      { agent: 'codex', file: 'x', path: 'x', servers: [{ name: 'gh', transport: 'stdio', command: 'two', off: true }] },
      { agent: 'opencode', file: 'o', path: 'o', servers: [{ name: 'gh', transport: 'stdio', command: 'three' }] },
    ])
    expect(plan.replaces).toEqual([])
    expect(plan.settle).toEqual([])
  })

  it('waits on a sign-in for a remote server it copied, until the person starts it, in each agent', () => {
    const home = homeWith({})
    const { io } = fakeAgents(home)
    const copied = {
      ...emptyRecord,
      added: [
        { agent: 'codex' as const, spec: { name: 'linear', transport: 'http' as const, url: 'https://mcp.linear.app/mcp' }, at: io.now() },
        {
          agent: 'opencode' as const,
          spec: { name: 'linear', transport: 'http' as const, url: 'https://mcp.linear.app/mcp' },
          at: io.now(),
        },
      ],
    }
    expect(planSync(copied, agents([])).settle).toEqual([{ kind: 'signIn', server: 'linear', agents: ['codex', 'opencode'] }])
    expect(signIn(io, 'codex', 'linear')).toBe('codex mcp login linear')
    expect(signIn(io, 'claude', 'linear')).toBe('claude mcp login linear')
    expect(signIn(io, 'opencode', 'linear')).toBeUndefined()
    const signedIn = readRecord(io).signedIn
    expect(planSync({ ...copied, signedIn }, agents([])).settle).toEqual([])
  })
})

describe('the steps around sync', () => {
  it('only looks while it is off: what each agent has is kept as seen, and nothing is written', async () => {
    const home = homeWith({ claude: { mcpServers: { a: { command: 'a' } } } })
    const { io, calls } = fakeAgents(home)
    const { record, errors } = await reconcile(io)
    expect(errors).toEqual([])
    expect(record.seen.claude).toEqual(['a'])
    expect(record.looked).toBe(true)
    expect(calls).toEqual([])
    expect(names(home, 'codex')).toEqual([])
  })

  it('puts back what the person took out with Undo, once, and does nothing for a line it doesn’t know', async () => {
    const home = homeWith({ claude: { mcpServers: { a: { command: 'a' } } } })
    const { io } = fakeAgents(home)
    await turnOn(io)
    expect(names(home, 'codex')).toEqual(['a'])
    // The person takes a out of Codex by hand.
    writeFileSync(join(home, '.codex', 'config.toml'), '')
    const { record } = await reconcile(io)
    const tookOut = record.since.find((each) => each.kind === 'tookOut')
    expect(tookOut).toMatchObject({ server: 'a', from: 'codex' })
    await undoSince(io, 'no such line')
    await undoSince(io, tookOut!.id)
    expect(names(home, 'codex')).toEqual(['a'])
    expect(readRecord(io).keptOut.codex).toEqual([])
    expect(readRecord(io).since.find((each) => each.id === tookOut!.id)?.undone).toBe(true)
    // A second Undo of the same line does nothing more.
    writeFileSync(join(home, '.codex', 'config.toml'), '')
    await undoSince(io, tookOut!.id)
    expect(names(home, 'codex')).toEqual([])
  })

  it('says why an agent’s command failed in its last line, and goes on with the rest', async () => {
    const home = homeWith({ claude: { mcpServers: { a: { command: 'a' } } } })
    const { io } = fakeAgents(home)
    const failing = { ...io, run: async () => ({ code: 2, output: 'warming up\nno permission to write\n' }) }
    const { errors } = await turnOn(failing)
    expect(errors).toEqual(['Codex: no permission to write'])
    expect(names(home, 'opencode')).toEqual(['a'])
  })

  it('says a failure that isn’t an error in its own words', async () => {
    const home = homeWith({ claude: { mcpServers: { a: { command: 'a' } } } })
    const { io } = fakeAgents(home)
    const throwing = {
      ...io,
      run: () => {
        throw 'spawn failed'
      },
    }
    const { errors } = await turnOn(throwing)
    expect(errors).toEqual(['spawn failed'])
  })

  it('keeps a pick for a server it hasn’t written yet', async () => {
    const home = homeWith({
      claude: { mcpServers: { gh: { command: 'one' } } },
      codex: { mcp_servers: { gh: { command: 'two' } } },
    })
    const { io } = fakeAgents(home)
    await pickWay(io, 'gh', 'apart')
    expect(readRecord(io).picks).toEqual({ gh: 'apart' })
    expect(names(home, 'opencode')).toEqual([])
  })
})
