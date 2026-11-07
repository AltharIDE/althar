import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { agentServers } from '@althar/provider-adapters'

import { fakeAgents, GITHUB_NPX, homeWith, stringify } from './agentHome'
import { describe, expect, it } from 'vitest'

import { keepOut, pickWay, putBack, reconcile, readRecord, syncState, type SyncIo, turnOff, turnOn, undoSince } from '../src/mcpSync'

/*
 * Keeping the person's agents' MCP servers the same, against a temporary
 * home: never the real `~/.claude.json`, `~/.codex` or `~/.config/opencode`.
 * Each agent's own command is a fake that writes its file as the agent
 * would, and records what it was asked.
 */

const names = (home: string, agent: 'claude' | 'codex' | 'opencode') =>
  agentServers(agent, { homeDir: home })
    .servers.map((server) => server.name)
    .sort()

describe('keeping the agents’ MCP servers the same', () => {
  it('says what it would add to each agent before it starts, and writes nothing while it is off', async () => {
    const home = homeWith({
      claude: { mcpServers: { linear: { type: 'http', url: 'https://mcp.linear.app/mcp' } }, numStartups: 41 },
      codex: { model: 'gpt-6.1', mcp_servers: { context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp'] } } },
    })
    const { io, calls } = fakeAgents(home)
    const { plan } = syncState(io)
    expect(plan.adds.map((each) => `${each.spec.name}→${each.agent}`).sort()).toEqual([
      'context7→claude',
      'context7→opencode',
      'linear→codex',
      'linear→opencode',
    ])
    expect(calls).toEqual([])
    expect(names(home, 'codex')).toEqual(['context7'])
  })

  it('writes each server through the agent’s own command, OpenCode’s in its file with its comments kept, and copies the file first', async () => {
    const home = homeWith({
      claude: { mcpServers: { linear: { type: 'http', url: 'https://mcp.linear.app/mcp' } } },
      codex: { mcp_servers: { context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp'] } } },
      opencode: '{\n  // the person’s own note\n  "theme": "system"\n}\n',
    })
    const { io, calls } = fakeAgents(home)
    const { errors } = await turnOn(io)
    expect(errors).toEqual([])
    expect(calls).toContain('codex mcp add linear --url https://mcp.linear.app/mcp')
    expect(calls).toContain(
      'claude mcp add-json --scope user context7 {"type":"stdio","command":"npx","args":["-y","@upstash/context7-mcp"]}',
    )
    expect(names(home, 'claude')).toEqual(['context7', 'linear'])
    expect(names(home, 'codex')).toEqual(['context7', 'linear'])
    expect(names(home, 'opencode')).toEqual(['context7', 'linear'])
    const openCode = readFileSync(join(home, '.config', 'opencode', 'opencode.json'), 'utf8')
    expect(openCode).toContain('// the person’s own note')
    expect(openCode).toContain('"theme": "system"')
    // A copy of each file it changed, as it was before.
    const backups = readdirSync(join(io.folder, 'backups'))
    expect(backups.length).toBe(3)
    expect(readRecord(io).added.length).toBe(4)
  })

  it('takes back out only what it added, and only while it is as Althar wrote it; the person’s own stay', async () => {
    const home = homeWith({
      claude: { mcpServers: { linear: { type: 'http', url: 'https://mcp.linear.app/mcp' }, mine: { command: 'my-server' } } },
    })
    const { io } = fakeAgents(home)
    await turnOn(io)
    expect(names(home, 'codex')).toEqual(['linear', 'mine'])
    // The person changes how linear runs in Codex since: that one is theirs now.
    writeFileSync(
      join(home, '.codex', 'config.toml'),
      stringify({ mcp_servers: { linear: { url: 'https://mcp.linear.app/sse-proxy' }, mine: { command: 'my-server' } } }),
    )
    await turnOff(io, true)
    expect(names(home, 'codex')).toEqual(['linear'])
    expect(names(home, 'opencode')).toEqual([])
    expect(names(home, 'claude')).toEqual(['linear', 'mine'])
    expect(readRecord(io).on).toBe(false)
  })

  it('leaves what it added in, the person’s now, when turned off with Leave them in', async () => {
    const home = homeWith({ claude: { mcpServers: { mine: { command: 'my-server' } } } })
    const { io } = fakeAgents(home)
    await turnOn(io)
    await turnOff(io, false)
    expect(names(home, 'codex')).toEqual(['mine'])
    expect(readRecord(io).added).toEqual([])
  })

  it('keeps a server out of one agent from its chip, and never adds back one the person took out', async () => {
    const home = homeWith({ claude: { mcpServers: { a: { command: 'a' }, b: { command: 'b' } } } })
    const { io } = fakeAgents(home)
    await turnOn(io)
    await keepOut(io, 'codex', 'a')
    expect(names(home, 'codex')).toEqual(['b'])
    // The person takes b out of OpenCode by hand.
    writeFileSync(join(home, '.config', 'opencode', 'opencode.json'), JSON.stringify({ mcp: { a: { type: 'local', command: ['a'] } } }))
    const { record } = await reconcile(io)
    expect(names(home, 'opencode')).toEqual(['a'])
    expect(record.keptOut.opencode).toEqual(['b'])
    expect(record.since[0]).toMatchObject({ kind: 'tookOut', server: 'b', from: 'opencode' })
    await putBack(io, 'codex', 'a')
    expect(names(home, 'codex')).toEqual(['a', 'b'])
  })

  it('copies a server the person added to one agent since, and undoes the copy', async () => {
    const home = homeWith({ claude: { mcpServers: { a: { command: 'a' } } } })
    const { io } = fakeAgents(home)
    await turnOn(io)
    const claude = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')) as Record<string, any>
    claude['mcpServers'].notion = { type: 'http', url: 'https://mcp.notion.com/mcp' }
    writeFileSync(join(home, '.claude.json'), JSON.stringify(claude))
    const { record } = await reconcile(io)
    expect(names(home, 'codex')).toEqual(['a', 'notion'])
    const copied = record.since.find((each) => each.kind === 'copied')
    expect(copied).toMatchObject({ server: 'notion', from: 'claude', to: ['codex', 'opencode'] })
    await undoSince(io, copied!.id)
    expect(names(home, 'codex')).toEqual(['a'])
    expect(names(home, 'claude')).toContain('notion')
    expect(readRecord(io).keptOut.codex).toEqual(['notion'])
  })

  it('waits on the person’s pick for a server set up two ways, and changes the other agent’s once they pick', async () => {
    const home = homeWith({
      claude: { mcpServers: { github: GITHUB_NPX } },
      codex: { mcp_servers: { github: { command: 'docker', args: ['run', '-i', 'ghcr.io/github/github-mcp-server'] } } },
    })
    const { io } = fakeAgents(home)
    await turnOn(io)
    expect(syncState(io).plan.settle).toContainEqual(expect.objectContaining({ kind: 'differs', server: 'github' }))
    expect(names(home, 'opencode')).toEqual([])
    await pickWay(io, 'github', 'codex')
    const claude = agentServers('claude', { homeDir: home }).servers.find((each) => each.name === 'github')
    expect(claude?.command).toBe('docker')
    expect(names(home, 'opencode')).toEqual(['github'])
  })

  it('never copies a secret written out in a file, and carries a token as the name of its variable', async () => {
    const home = homeWith({
      claude: {
        mcpServers: {
          plain: { command: 'srv', env: { API_TOKEN: 'ghp_live_value' } },
          named: { type: 'http', url: 'https://api.example.com/mcp', headers: { Authorization: 'Bearer ${EXAMPLE_TOKEN}' } },
        },
      },
    })
    const { io, calls } = fakeAgents(home)
    await turnOn(io)
    expect(names(home, 'codex')).toEqual(['named'])
    expect(calls).toContain('codex mcp add named --url https://api.example.com/mcp --bearer-token-env-var EXAMPLE_TOKEN')
    expect(readFileSync(join(home, '.config', 'opencode', 'opencode.json'), 'utf8')).toContain('Bearer {env:EXAMPLE_TOKEN}')
    expect(JSON.stringify(readFileSync(join(home, '.codex', 'config.toml'), 'utf8'))).not.toContain('ghp_live_value')
    expect(syncState(io).plan.settle).toContainEqual({ kind: 'cant', server: 'plain', agent: 'codex', why: 'secret' })
  })

  it('leaves alone a file it can’t read, and says so', async () => {
    const home = homeWith({ claude: { mcpServers: { a: { command: 'a' } } }, opencode: '{ "mcp": { oops' })
    const { io } = fakeAgents(home)
    await turnOn(io)
    expect(readFileSync(join(home, '.config', 'opencode', 'opencode.json'), 'utf8')).toBe('{ "mcp": { oops')
    expect(syncState(io).plan.settle).toContainEqual(expect.objectContaining({ kind: 'unreadable', agent: 'opencode' }))
    expect(names(home, 'codex')).toEqual(['a'])
  })
  it('leaves a server the person changed since, beyond its command: its environment, headers, token or off', async () => {
    const home = homeWith({
      claude: { mcpServers: { a: { command: 'a', env: { MODE: 'one' } }, b: { type: 'http', url: 'https://b.example/mcp' } } },
    })
    const { io } = fakeAgents(home)
    await turnOn(io)
    expect(names(home, 'codex')).toEqual(['a', 'b'])
    // The person gives a its own environment in Codex, and turns b off there.
    writeFileSync(
      join(home, '.codex', 'config.toml'),
      stringify({ mcp_servers: { a: { command: 'a', env: { MODE: 'two' } }, b: { url: 'https://b.example/mcp', enabled: false } } }),
    )
    await turnOff(io, true)
    expect(names(home, 'codex')).toEqual(['a', 'b'])
    // OpenCode's are still as Althar wrote them: they come out.
    expect(names(home, 'opencode')).toEqual([])
  })

  it('tells servers apart by their whole set-up, not only their command, and waits on the person for one set up two ways', () => {
    const home = homeWith({
      claude: { mcpServers: { api: { type: 'http', url: 'https://api.example/mcp', headers: { Authorization: 'Bearer ${ONE}' } } } },
      codex: { mcp_servers: { api: { url: 'https://api.example/mcp', bearer_token_env_var: 'TWO' } } },
    })
    const { io } = fakeAgents(home)
    expect(syncState(io).plan.settle).toContainEqual(expect.objectContaining({ kind: 'differs', server: 'api' }))
    // The same token, written each agent's way, is one set-up.
    const same = homeWith({
      claude: { mcpServers: { api: { type: 'http', url: 'https://api.example/mcp', headers: { Authorization: 'Bearer ${ONE}' } } } },
      codex: { mcp_servers: { api: { url: 'https://api.example/mcp', bearer_token_env_var: 'ONE' } } },
    })
    expect(syncState(fakeAgents(same).io).plan.settle).toEqual([])
  })

  it('takes a server back out from its chip only while it is as Althar wrote it, and keeps it out either way', async () => {
    const home = homeWith({ claude: { mcpServers: { a: { command: 'a' } } } })
    const { io } = fakeAgents(home)
    await turnOn(io)
    // The person points a at another command in Codex: theirs now.
    writeFileSync(join(home, '.codex', 'config.toml'), stringify({ mcp_servers: { a: { command: 'a-mine' } } }))
    await keepOut(io, 'codex', 'a')
    expect(agentServers('codex', { homeDir: home }).servers[0]?.command).toBe('a-mine')
    expect(readRecord(io).added.some((each) => each.agent === 'codex')).toBe(false)
    expect(readRecord(io).keptOut.codex).toEqual(['a'])
    // OpenCode's is as written: its chip takes it out.
    await keepOut(io, 'opencode', 'a')
    expect(names(home, 'opencode')).toEqual([])
  })

  it('never copies a secret by a pick: the other agent keeps its own way, and the secret waits under To settle', async () => {
    const home = homeWith({
      claude: { mcpServers: { tool: { command: 'tool', env: { API_TOKEN: 'live_value' } } } },
      codex: { mcp_servers: { tool: { command: 'tool-other' } } },
    })
    const { io } = fakeAgents(home)
    await turnOn(io)
    await pickWay(io, 'tool', 'claude')
    expect(agentServers('codex', { homeDir: home }).servers[0]?.command).toBe('tool-other')
    expect(readFileSync(join(home, '.codex', 'config.toml'), 'utf8')).not.toContain('live_value')
    expect(syncState(io).plan.settle).toContainEqual({ kind: 'cant', server: 'tool', agent: 'codex', why: 'secret' })
  })

  it('keeps what an agent’s command couldn’t do, says it, and keeps what it couldn’t take back to take back again', async () => {
    const home = homeWith({ claude: { mcpServers: { a: { command: 'a' } } } })
    const working = fakeAgents(home)
    await turnOn(working.io)
    expect(names(home, 'codex')).toEqual(['a'])
    const broken = fakeAgents(home, ['codex'])
    const { errors } = await turnOff({ ...broken.io, now: working.io.now }, true)
    expect(errors).toEqual(["Codex: codex: couldn't write its settings"])
    expect(readRecord(working.io).errors).toEqual(errors)
    expect(readRecord(working.io).added.map((each) => each.agent)).toEqual(['codex'])
    expect(names(home, 'opencode')).toEqual([])
    // Once Codex's command works, taking it back goes through.
    await turnOff(working.io, true)
    expect(names(home, 'codex')).toEqual([])
    expect(readRecord(working.io).added).toEqual([])
  })
})
