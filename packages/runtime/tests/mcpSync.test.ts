import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { agentServers } from '@althar/provider-adapters'
import { describe, expect, it } from 'vitest'

import { keepOut, pickWay, putBack, reconcile, readRecord, syncState, type SyncIo, turnOff, turnOn, undoSince } from '../src/mcpSync'

/*
 * Keeping the person's agents' MCP servers the same, against a temporary
 * home: never the real `~/.claude.json`, `~/.codex` or `~/.config/opencode`.
 * Each agent's own command is a fake that writes its file as the agent
 * would, and records what it was asked.
 */

const withoutTransport = (spec: Record<string, unknown>) => Object.fromEntries(Object.entries(spec).filter(([key]) => key !== 'transport'))

/** A config as TOML, as far as these tests need: tables of strings, numbers, booleans and lists of strings, a table deep. */
const stringify = (config: Record<string, unknown>): string => {
  const value = (each: unknown): string =>
    Array.isArray(each) ? `[${each.map(value).join(', ')}]` : typeof each === 'string' ? JSON.stringify(each) : String(each)
  const lines: Array<string> = []
  const table = (path: string, entries: Record<string, unknown>) => {
    const plain = Object.entries(entries).filter(([, each]) => typeof each !== 'object' || Array.isArray(each))
    if (path !== '') lines.push(`[${path}]`)
    for (const [key, each] of plain) lines.push(`${key} = ${value(each)}`)
    for (const [key, each] of Object.entries(entries))
      if (typeof each === 'object' && each !== null && !Array.isArray(each))
        table(path === '' ? key : `${path}.${key}`, each as Record<string, unknown>)
  }
  table('', config)
  return `${lines.join('\n')}\n`
}

const GITHUB_NPX = { type: 'stdio', command: 'npx', args: ['-y', '@github/github-mcp-server'], env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' } }

const homeWith = (files: { claude?: unknown; codex?: Record<string, unknown>; opencode?: string }) => {
  const home = mkdtempSync(join(tmpdir(), 'althar-sync-'))
  if (files.claude !== undefined) writeFileSync(join(home, '.claude.json'), JSON.stringify(files.claude, null, 2))
  if (files.codex !== undefined) {
    mkdirSync(join(home, '.codex'), { recursive: true })
    writeFileSync(join(home, '.codex', 'config.toml'), stringify(files.codex))
  }
  if (files.opencode !== undefined) {
    mkdirSync(join(home, '.config', 'opencode'), { recursive: true })
    writeFileSync(join(home, '.config', 'opencode', 'opencode.json'), files.opencode)
  }
  return home
}

/** Claude Code's and Codex's commands, as they write their own files; each call kept. */
const fakeAgents = (home: string) => {
  const calls: Array<string> = []
  const claudeFile = join(home, '.claude.json')
  const codexFile = join(home, '.codex', 'config.toml')
  /** Codex's config as its file says it now, read back the way Althar reads it. */
  const codexConfig = (): Record<string, unknown> => {
    const found = agentServers('codex', { homeDir: home }).servers
    return {
      mcp_servers: Object.fromEntries(
        found.map(({ name, tokenVariable, off, ...spec }) => [
          name,
          {
            ...withoutTransport(spec),
            ...(tokenVariable === undefined ? {} : { bearer_token_env_var: tokenVariable }),
            ...(off === true ? { enabled: false } : {}),
          },
        ]),
      ),
    }
  }
  const run: SyncIo['run'] = async (command, args) => {
    calls.push([command, ...args].join(' '))
    if (command === 'claude') {
      const config = existsSync(claudeFile) ? (JSON.parse(readFileSync(claudeFile, 'utf8')) as Record<string, any>) : {}
      const servers = { ...config['mcpServers'] }
      if (args[1] === 'add-json') servers[args[4]!] = JSON.parse(args[5]!)
      else if (args[1] === 'remove') delete servers[args[4]!]
      writeFileSync(claudeFile, JSON.stringify({ ...config, mcpServers: servers }, null, 2))
      return { code: 0, output: '' }
    }
    const config = codexConfig()
    const servers: Record<string, unknown> = { ...(config['mcp_servers'] as Record<string, unknown> | undefined) }
    if (args[1] === 'add') {
      const name = args[2]!
      const rest = args.slice(3)
      const url = rest.indexOf('--url')
      if (url >= 0) {
        const bearer = rest.indexOf('--bearer-token-env-var')
        servers[name] = { url: rest[url + 1], ...(bearer >= 0 ? { bearer_token_env_var: rest[bearer + 1] } : {}) }
      } else {
        const dash = rest.indexOf('--')
        const env = Object.fromEntries(
          rest.slice(0, dash).flatMap((arg, at, all) => (arg === '--env' ? [all[at + 1]!.split('=') as [string, string]] : [])),
        )
        const [cmd, ...cmdArgs] = rest.slice(dash + 1)
        servers[name] = { command: cmd, args: cmdArgs, ...(Object.keys(env).length === 0 ? {} : { env }) }
      }
    } else if (args[1] === 'remove') delete servers[args[2]!]
    mkdirSync(join(home, '.codex'), { recursive: true })
    writeFileSync(codexFile, stringify({ ...config, mcp_servers: servers }))
    return { code: 0, output: '' }
  }
  let tick = 0
  const io: SyncIo = {
    home: { homeDir: home, env: {} },
    folder: join(home, 'althar-profile'),
    run,
    now: () => `2026-11-07T10:00:${String(tick++).padStart(2, '0')}.000Z`,
  }
  return { io, calls }
}

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
})
