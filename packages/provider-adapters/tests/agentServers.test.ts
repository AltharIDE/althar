import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { mcpCallOf } from '../src/mcpCalls'
import {
  agentServers,
  asWritten,
  claudeServersIn,
  codexServersIn,
  isReference,
  openCodeServersIn,
  parseJsonc,
  referenceOf,
  repositoryServers,
  runsOf,
  sameServer,
  serverFiles,
} from '../src/agentServers'

describe('the person’s agents’ settings, read', () => {
  it('reads JSON with comments and trailing commas, keeping what looks like a comment inside a string', () => {
    expect(
      parseJsonc('{\n  // a note\n  "url": "https://example.com/mcp", /* another */\n  "quote": "a \\"//\\" b",\n  "list": [1, 2,],\n}'),
    ).toEqual({ url: 'https://example.com/mcp', quote: 'a "//" b', list: [1, 2] })
    expect(parseJsonc('{ "mcp": { oops')).toBeUndefined()
  })

  it('reads a tool’s name in each agent’s form, and quickly however long a name it is given', () => {
    expect(mcpCallOf('mcp__my_server__merge_pull_request')).toEqual({ server: 'my_server', tool: 'merge_pull_request' })
    expect(mcpCallOf('mcp.linear.update_issue')).toEqual({ server: 'linear', tool: 'update_issue' })
    expect(mcpCallOf(`mcp__-__${'-__-'.repeat(20_000)}`)).toEqual({ server: '-', tool: '-__-'.repeat(20_000) })
    expect(mcpCallOf('mcp__a b__c')).toBeUndefined()
  })

  it('takes a token named each agent’s way as the same set-up', () => {
    expect(
      sameServer(
        { name: 'api', transport: 'http', url: 'https://api.example/mcp', headers: { Authorization: 'Bearer ${ONE}' } },
        { name: 'api', transport: 'http', url: 'https://api.example/mcp', tokenVariable: 'ONE' },
      ),
    ).toBe(true)
    expect(
      sameServer(
        { name: 'a', transport: 'stdio', command: 'a', env: { MODE: 'one' } },
        { name: 'a', transport: 'stdio', command: 'a', env: { MODE: 'two' } },
      ),
    ).toBe(false)
  })
})

describe('each agent’s servers, read into one shape', () => {
  const homes: string[] = []
  const home = () => {
    const dir = mkdtempSync(join(tmpdir(), 'althar-servers-'))
    homes.push(dir)
    return dir
  }
  const put = (path: string, text: string) => {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, text)
  }
  afterEach(() => {
    for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('reads Claude Code’s servers: a command, an address over HTTP or SSE, and skips what is neither', () => {
    expect(
      claudeServersIn({
        mcpServers: {
          local: { command: 'npx', args: ['-y', 'x'], env: { A: '1', B: 2 } },
          web: { url: 'https://a.example/mcp', headers: { Authorization: 'Bearer ${T}' } },
          stream: { type: 'sse', url: 'https://b.example/sse' },
          empty: {},
          bad: 'nope',
        },
      }),
    ).toEqual([
      { name: 'local', transport: 'stdio', command: 'npx', args: ['-y', 'x'], env: { A: '1' } },
      { name: 'web', transport: 'http', url: 'https://a.example/mcp', headers: { Authorization: 'Bearer ${T}' } },
      { name: 'stream', transport: 'sse', url: 'https://b.example/sse' },
    ])
    expect(claudeServersIn(undefined)).toEqual([])
  })

  it('reads Codex’s servers, with the ones it has turned off', () => {
    expect(
      codexServersIn({
        mcp_servers: {
          web: { url: 'https://a.example/mcp', bearer_token_env_var: 'TOKEN', http_headers: { X: 'y' }, enabled: false },
          local: { command: 'run', args: ['a'], env: { K: 'v' } },
          empty: {},
          bad: 3,
        },
      }),
    ).toEqual([
      { name: 'web', transport: 'http', url: 'https://a.example/mcp', tokenVariable: 'TOKEN', headers: { X: 'y' }, off: true },
      { name: 'local', transport: 'stdio', command: 'run', args: ['a'], env: { K: 'v' } },
    ])
  })

  it('reads OpenCode’s servers: a command as one list, or a remote address', () => {
    expect(
      openCodeServersIn({
        mcp: {
          remote: { type: 'remote', url: 'https://a.example/mcp', headers: { X: 'y' }, enabled: false },
          local: { type: 'local', command: ['bunx', 'a', 'b'], environment: { K: 'v' } },
          bare: { command: ['solo'] },
          empty: { command: [] },
          bad: 1,
        },
      }),
    ).toEqual([
      { name: 'remote', transport: 'http', url: 'https://a.example/mcp', headers: { X: 'y' }, off: true },
      { name: 'local', transport: 'stdio', command: 'bunx', args: ['a', 'b'], env: { K: 'v' } },
      { name: 'bare', transport: 'stdio', command: 'solo' },
    ])
  })

  it('finds each agent’s file where its folder is moved, and where it is not', () => {
    const homeDir = home()
    const plain = serverFiles({ homeDir })
    expect(plain.claude).toEqual({ file: '~/.claude.json', path: join(homeDir, '.claude.json') })
    expect(plain.codex).toEqual({ file: '~/.codex/config.toml', path: join(homeDir, '.codex', 'config.toml') })
    expect(plain.opencode.path).toBe(join(homeDir, '.config', 'opencode', 'opencode.json'))
    const elsewhere = home()
    const codexHome = join(elsewhere, 'codex')
    const xdgHome = join(elsewhere, 'xdg')
    const moved = serverFiles({
      homeDir,
      env: { CLAUDE_CONFIG_DIR: join(homeDir, 'c'), CODEX_HOME: codexHome, XDG_CONFIG_HOME: xdgHome },
    })
    expect(moved.claude).toEqual({ file: join('~', 'c', '.claude.json'), path: join(homeDir, 'c', '.claude.json') })
    expect(moved.codex).toEqual({ file: join(codexHome, 'config.toml'), path: join(codexHome, 'config.toml') })
    expect(moved.opencode.path).toBe(join(xdgHome, 'opencode', 'opencode.json'))
  })

  it('reads each agent’s file from disk, and says what it could not read', () => {
    const homeDir = home()
    expect(agentServers('claude', { homeDir })).toMatchObject({ servers: [] })
    expect(agentServers('claude', { homeDir }).problem).toBeUndefined()

    put(join(homeDir, '.claude.json'), JSON.stringify({ mcpServers: { a: { command: 'a' } } }))
    expect(agentServers('claude', { homeDir }).servers).toEqual([{ name: 'a', transport: 'stdio', command: 'a' }])
    put(join(homeDir, '.claude.json'), '{ nope')
    expect(agentServers('claude', { homeDir }).problem).toBe('it isn’t JSON Althar can read')

    put(join(homeDir, '.codex', 'config.toml'), '[mcp_servers.b]\ncommand = "b"\n')
    expect(agentServers('codex', { homeDir }).servers).toEqual([{ name: 'b', transport: 'stdio', command: 'b' }])
    put(join(homeDir, '.codex', 'config.toml'), 'a = 1\nb = = 2\n')
    expect(agentServers('codex', { homeDir }).problem).toMatch(/^it (has a mistake on line \d+|isn’t TOML Althar can read)$/)

    const config = join(homeDir, '.config', 'opencode')
    put(join(config, 'opencode.jsonc'), '{ // note\n "mcp": { "c": { "command": ["c"], }, }, }')
    const found = agentServers('opencode', { homeDir })
    expect(found.servers).toEqual([{ name: 'c', transport: 'stdio', command: 'c' }])
    expect(found.file).toBe(join('~', '.config', 'opencode', 'opencode.jsonc'))
    put(join(config, 'opencode.jsonc'), '{ oops')
    expect(agentServers('opencode', { homeDir }).problem).toBe('it isn’t JSON Althar can read')
  })

  it('reads a repository’s own .mcp.json, and nothing where it is missing or broken', () => {
    const root = home()
    expect(repositoryServers(root)).toEqual([])
    put(join(root, '.mcp.json'), '{ nope')
    expect(repositoryServers(root)).toEqual([])
    put(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { r: { url: 'https://r.example' } } }))
    expect(repositoryServers(root)).toEqual([{ name: 'r', transport: 'http', url: 'https://r.example' }])
  })

  it('tells a reference to a variable from a secret, and what a server runs', () => {
    for (const ref of ['${A_1}', '{env:A_1}', '$A_1']) {
      expect(isReference(ref)).toBe(true)
      expect(referenceOf(ref)).toBe('A_1')
    }
    expect(isReference('sk-secret')).toBe(false)
    expect(referenceOf('sk-secret')).toBeUndefined()
    expect(runsOf({ name: 'a', transport: 'stdio', command: 'npx', args: ['-y', 'x'] })).toBe('npx -y x')
    expect(runsOf({ name: 'a', transport: 'http', url: 'https://a.example' })).toBe('https://a.example')
    expect(runsOf({ name: 'a', transport: 'stdio' })).toBe('')
  })

  it('takes a server as written only while it is set up the same and not turned off', () => {
    const written = { name: 'a', transport: 'http', url: 'https://a.example', headers: { authorization: 'Bearer ${T}' } } as const
    expect(sameServer(written, { ...written, transport: 'sse', headers: { Authorization: 'Bearer {env:T}' } })).toBe(true)
    expect(asWritten(written, written)).toBe(true)
    expect(asWritten({ ...written, off: true }, written)).toBe(false)
  })
})
