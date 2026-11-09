import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  checkHealth,
  emptyHealth,
  type HealthRecord,
  noteServerStatus,
  parseClaudeList,
  parseCodexJson,
  parseCodexTable,
  parseOpenCodeList,
  readHealth,
} from '../src/mcpHealth'
import type { Run, SyncIo } from '../src/mcpSync'

/*
 * How the person's servers stand in each of their agents, read from each agent's own list command: the parsers against
 * what each prints (as Claude Code 2.1, Codex 0.166 and OpenCode print it, and older forms), and the check that asks
 * them, with a fake of each command, keeping what they said in a folder of the test's own.
 */

const ESC = '\u001b'
const CLAUDE = [
  'Checking MCP server health…',
  '',
  'linear: https://mcp.linear.app/mcp (HTTP) - ⚠ Needs authentication',
  'playwright: npx @playwright/mcp@latest - ✓ Connected',
  'notion: https://mcp.notion.com/mcp (HTTP) - ✗ Failed to connect',
  'bogus: definitely-not-a-command x - y - ✘ Failed to connect — ENOENT: Executable not found in $PATH: "definitely-not-a-command"',
  'remote: https://example.com/mcp (HTTP) - ✘ Failed to connect — HTTP 502: Streamable HTTP error: Error POSTing to endpoint:',
  '      upstream went away',
  'plugin:github:github: https://api.githubcopilot.com/mcp (HTTP) - ✓ Connected',
  'claude.ai Gmail: https://gmail.mcp.claude.com/mcp - ⏸ Pending approval',
  'odd: something - ⁇ Beyond words',
  'not a server line at all',
].join('\n')

describe('Claude Code’s list', () => {
  it('reads each server’s status, the reason a start failed, and the last " - " as its status', () => {
    const found = parseClaudeList(CLAUDE)!
    expect(Object.fromEntries(found)).toEqual({
      linear: { status: 'needs-auth' },
      playwright: { status: 'connected' },
      notion: { status: 'failed' },
      bogus: { status: 'failed', why: 'ENOENT: Executable not found in $PATH: "definitely-not-a-command"' },
      remote: { status: 'failed', why: 'HTTP 502: Streamable HTTP error: Error POSTing to endpoint: upstream went away' },
      github: { status: 'connected' },
      'claude.ai Gmail': { status: 'unknown' },
      odd: { status: 'unknown' },
    })
  })

  it('reads it through the colours a terminal gives it', () => {
    const coloured = `${ESC}[1mlinear${ESC}[22m: https://mcp.linear.app/mcp (HTTP) - ${ESC}[33m⚠ Needs authentication${ESC}[39m\r\n`
    expect(Object.fromEntries(parseClaudeList(coloured)!)).toEqual({ linear: { status: 'needs-auth' } })
  })

  it('keeps the person’s own server over a plugin’s of the same name, either way round', () => {
    const plugin = 'plugin:x:github: https://a (HTTP) - ✗ Failed to connect'
    const own = 'github: https://b (HTTP) - ✓ Connected'
    expect(parseClaudeList(`${own}\n${plugin}`)?.get('github')).toEqual({ status: 'connected' })
    expect(parseClaudeList(`${plugin}\n${own}`)?.get('github')).toEqual({ status: 'connected' })
  })

  it('adds a reason’s next line to a failure, and not to one that started', () => {
    const found = parseClaudeList('a: b - ✗ Failed to connect — first\n  second\nc: d - ✓ Connected\n  not a reason')!
    expect(found.get('a')).toEqual({ status: 'failed', why: 'first second' })
    expect(found.get('c')).toEqual({ status: 'connected' })
    // A plugin named with nothing after its last colon keeps that as its name.
    expect(parseClaudeList('plugin:: c - ✓ Connected')?.get('plugin:')).toEqual({ status: 'connected' })
  })

  it('cuts a long reason to 300 characters', () => {
    const why = parseClaudeList(`a: b - ✗ Failed to connect — ${'x'.repeat(400)}`)?.get('a')?.why ?? ''
    expect(why).toHaveLength(300)
    expect(why.endsWith('…')).toBe(true)
  })

  it('reads an empty list as none, and garbage as nothing readable', () => {
    expect(parseClaudeList('No MCP servers configured. Use `claude mcp add` to add a server.\n')?.size).toBe(0)
    expect(parseClaudeList('')).toBeUndefined()
    expect(parseClaudeList('Segmentation fault\n\u0000\u0001')).toBeUndefined()
  })
})

const CODEX_JSON = JSON.stringify([
  { name: 'bogus', enabled: true, transport: { type: 'stdio', command: 'x', args: ['a - b'] }, auth_status: 'unsupported' },
  {
    name: 'linear',
    enabled: true,
    transport: { type: 'streamable_http', url: 'https://mcp.linear.app/mcp' },
    auth_status: 'not_logged_in',
  },
  { name: 'tok', enabled: true, transport: { type: 'streamable_http', url: 'https://a' }, auth_status: 'bearer_token' },
  { name: 'oauth', enabled: true, transport: { type: 'streamable_http', url: 'https://b' }, auth_status: 'o_auth' },
  { name: 'later', enabled: true, transport: { type: 'streamable_http', url: 'https://c' }, auth_status: 'something_new' },
  { name: 'bare', enabled: true },
  { enabled: true },
  'odd',
])

describe('Codex’s list', () => {
  it('reads a sign-in it needs, and nothing of a start it didn’t try', () => {
    expect(Object.fromEntries(parseCodexJson(CODEX_JSON)!)).toEqual({
      bogus: { status: 'unknown', signIn: 'none' },
      linear: { status: 'needs-auth' },
      tok: { status: 'unknown', signIn: 'yes' },
      oauth: { status: 'unknown', signIn: 'yes' },
      later: { status: 'unknown' },
      bare: { status: 'unknown' },
    })
    expect(parseCodexJson('[]')?.size).toBe(0)
    expect(parseCodexJson('{"servers": []}')).toBeUndefined()
    expect(parseCodexJson('garbage')).toBeUndefined()
  })

  it('reads the table an older Codex prints, by its columns', () => {
    const table = [
      'Name   Command                   Args   Env  Cwd  Status   Auth       ',
      'bogus  definitely-not-a-command  a - b  -    -    enabled  Unsupported',
      '',
      'Name    Url                           Bearer Token Env Var  Status   Auth         ',
      'linear  https://mcp.linear.app/mcp    -                     enabled  Not logged in',
      'tok     https://example.invalid/mcp2  X_TOKEN               enabled  Bearer token ',
      '        https://orphan.invalid         -                     enabled  Unsupported  ',
      '',
      'Name  Command  Args',
      'old   x        -',
    ].join('\n')
    expect(Object.fromEntries(parseCodexTable(table)!)).toEqual({
      bogus: { status: 'unknown', signIn: 'none' },
      linear: { status: 'needs-auth' },
      tok: { status: 'unknown', signIn: 'yes' },
      old: { status: 'unknown' },
    })
    expect(parseCodexTable('No MCP servers configured yet. Try `codex mcp add my-tool -- my-command`.')?.size).toBe(0)
    expect(parseCodexTable('panic at the disco')).toBeUndefined()
  })
})

describe('OpenCode’s list', () => {
  it('reads each server’s mark and words, as OpenCode prints them now', () => {
    const list = [
      '✓ github  connected',
      '⚠ linear  needs authentication',
      '✗ notion  failed: Connection closed',
      '  by the server',
      '○ off     disabled',
    ]
    expect(Object.fromEntries(parseOpenCodeList(list.join('\n'))!)).toEqual({
      github: { status: 'connected' },
      linear: { status: 'needs-auth' },
      notion: { status: 'failed', why: 'Connection closed by the server' },
      off: { status: 'unknown' },
    })
  })

  it('reads the framed list an older OpenCode drew, in colour', () => {
    const list = [
      `${ESC}[90m┌${ESC}[39m  MCP Servers`,
      '│',
      `●  ${ESC}[32m✓${ESC}[39m github ${ESC}[90mconnected${ESC}[39m`,
      '│      npx -y @github/github-mcp-server',
      '│',
      '●  ⚠ linear needs authentication',
      '│',
      '●  ✗ notion failed',
      '│      MCP error -32000: Connection closed',
      '│',
      '└  3 server(s)',
    ]
    expect(Object.fromEntries(parseOpenCodeList(list.join('\n'))!)).toEqual({
      github: { status: 'connected' },
      linear: { status: 'needs-auth' },
      notion: { status: 'failed', why: 'MCP error -32000: Connection closed' },
    })
  })

  it('reads an empty list as none, and garbage as nothing readable', () => {
    expect(parseOpenCodeList('No MCP servers configured\n')?.size).toBe(0)
    expect(parseOpenCodeList('┌  MCP Servers\n│\n▲  No MCP servers configured\n└  Done')?.size).toBe(0)
    expect(parseOpenCodeList('Error: Server process exited with code 1\n    at spawn (unknown)')).toBeUndefined()
  })
})

type Answer = { readonly code: number; readonly output: string } | 'throws' | (() => Promise<{ code: number; output: string }>)

/** A fake of each agent's own command: what each answers, and each call kept. */
const agents = (answers: Readonly<Record<string, Answer>>, folder = join(mkdtempSync(join(tmpdir(), 'althar-health-')), 'profile')) => {
  const calls: Array<string> = []
  let clock = Date.parse('2026-11-08T10:00:00.000Z')
  const run: Run = async (command, args) => {
    const line = [command, ...args].join(' ')
    calls.push(line)
    const answer = answers[line] ?? answers[command] ?? { code: 127, output: `Its \`${command}\` command isn’t on this computer.` }
    if (answer === 'throws') throw new Error('it broke')
    return typeof answer === 'function' ? answer() : answer
  }
  const io: SyncIo = { home: { homeDir: folder, env: {} }, folder, run, now: () => new Date(clock).toISOString() }
  return { io, calls, later: (millis: number) => (clock += millis) }
}

const HOUR = 60 * 60 * 1000

describe('asking the agents how their servers stand', () => {
  it('asks each agent at once and keeps what each said, by server and agent', async () => {
    const { io, calls } = agents({
      claude: { code: 0, output: CLAUDE },
      'codex mcp list --json': { code: 0, output: CODEX_JSON },
      opencode: { code: 0, output: '✗ notion  failed: Connection closed' },
    })
    const record = await checkHealth(io)
    expect(calls.sort()).toEqual(['claude mcp list', 'codex mcp list --json', 'opencode mcp list'])
    expect(record.checkedAt).toBe('2026-11-08T10:00:00.000Z')
    expect(record.servers['linear']).toEqual({
      claude: { status: 'needs-auth', at: '2026-11-08T10:00:00.000Z' },
      codex: { status: 'needs-auth', at: '2026-11-08T10:00:00.000Z' },
    })
    expect(record.servers['notion']?.opencode).toEqual({ status: 'failed', why: 'Connection closed', at: '2026-11-08T10:00:00.000Z' })
    expect(readHealth(io)).toEqual(record)
    // Written whole, with nothing left beside it.
    expect(readdirSync(io.folder)).toEqual(['mcp-health.json'])
  })

  it('asks none twice at once: a second check while one runs gets the first one’s answer', async () => {
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => (release = resolve))
    const { io, calls } = agents({
      claude: async () => {
        await held
        return { code: 0, output: 'a: b - ✓ Connected' }
      },
    })
    const one = checkHealth(io)
    const two = checkHealth(io)
    release!()
    const [first, second] = await Promise.all([one, two])
    expect(second).toBe(first)
    expect(calls.filter((call) => call.startsWith('claude'))).toHaveLength(1)
    // Once it is done, the next check asks again.
    await checkHealth(io)
    expect(calls.filter((call) => call.startsWith('claude'))).toHaveLength(2)
  })

  it('keeps what an agent that couldn’t be asked said last, for a day', async () => {
    const answers: Record<string, Answer> = {
      claude: { code: 0, output: 'a: b - ✓ Connected\nc: d - ✗ Failed to connect — boom' },
      opencode: { code: 0, output: '✓ a  connected' },
    }
    const { io, later } = agents(answers)
    await checkHealth(io)
    later(HOUR)
    // Claude Code fails now, and OpenCode no longer lists `a`.
    answers['claude'] = { code: 1, output: 'Error: something' }
    answers['opencode'] = { code: 0, output: 'No MCP servers configured' }
    const next = await checkHealth(io)
    expect(next.servers).toEqual({
      a: { claude: { status: 'connected', at: '2026-11-08T10:00:00.000Z' } },
      c: { claude: { status: 'failed', why: 'boom', at: '2026-11-08T10:00:00.000Z' } },
    })
    expect(next.checkedAt).toBe('2026-11-08T11:00:00.000Z')
    later(24 * HOUR)
    expect((await checkHealth(io)).servers).toEqual({})
  })

  it('asks none that isn’t on this computer, nor one that times out, fails or throws, and says no reason for it', async () => {
    const { io } = agents({
      // As `runIn` gives back a command killed at its 60 seconds: not 0, with what it said so far.
      claude: { code: 1, output: 'Checking MCP server health…\n\nlinear: https://a (HTTP) - ✓ Connec' },
      'codex mcp list --json': 'throws',
    })
    expect(await checkHealth(io)).toEqual({ checkedAt: '2026-11-08T10:00:00.000Z', servers: {} })
  })

  it('falls back to the table where Codex refuses --json, and to nothing where it fails otherwise', async () => {
    const refused = agents({
      'codex mcp list --json': { code: 2, output: "error: unexpected argument '--json' found" },
      'codex mcp list': { code: 0, output: 'Name    Url        Status   Auth\nlinear  https://a  enabled  Not logged in' },
    })
    expect((await checkHealth(refused.io)).servers).toEqual({ linear: { codex: { status: 'needs-auth', at: '2026-11-08T10:00:00.000Z' } } })
    const broken = agents({ 'codex mcp list --json': { code: 1, output: 'Error: config.toml has a mistake' } })
    await checkHealth(broken.io)
    expect(broken.calls).not.toContain('codex mcp list')
    // An older Codex whose table fails too says nothing.
    const failed = agents({
      'codex mcp list --json': { code: 2, output: "error: unexpected argument '--json' found" },
      'codex mcp list': { code: 1, output: 'error: config.toml has a mistake' },
    })
    expect((await checkHealth(failed.io)).servers).toEqual({})
    expect(failed.calls).toContain('codex mcp list')
  })

  it('reads a damaged record as empty, and checks over it', async () => {
    const { io } = agents({ opencode: { code: 0, output: '✓ a  connected' } })
    mkdirSync(io.folder, { recursive: true })
    writeFileSync(join(io.folder, 'mcp-health.json'), '{"checkedAt": "2026-11-0')
    expect(readHealth(io)).toEqual(emptyHealth)
    writeFileSync(
      join(io.folder, 'mcp-health.json'),
      JSON.stringify({ checkedAt: 4, servers: { a: { claude: { status: 'odd' } }, b: 'x' } }),
    )
    expect(readHealth(io)).toEqual(emptyHealth)
    writeFileSync(join(io.folder, 'mcp-health.json'), '[]')
    expect(readHealth(io)).toEqual(emptyHealth)
    expect((await checkHealth(io)).servers).toEqual({ a: { opencode: { status: 'connected', at: '2026-11-08T10:00:00.000Z' } } })
  })

  it('keeps what was there where its folder can’t be written to, and never throws', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'althar-health-'))
    // A file where its folder would be.
    writeFileSync(join(parent, 'profile'), 'not a folder')
    const { io } = agents({ claude: { code: 0, output: 'a: b - ✓ Connected' } }, join(parent, 'profile'))
    expect(await checkHealth(io)).toEqual(emptyHealth)
    expect(() => noteServerStatus(io, 'claude', 'a', 'failed', 'boom')).not.toThrow()
  })

  it('keeps what a session said of a server as it worked, with a failure’s words, and what a check says after', async () => {
    const answers: Record<string, Answer> = {}
    const { io, later } = agents(answers)
    noteServerStatus(io, 'claude', 'notion', 'failed', '  MCP server notion failed to start:\n Connection closed ')
    noteServerStatus(io, 'claude', 'linear', 'needs-auth', 'Sign in to linear')
    noteServerStatus(io, 'claude', 'github', 'pending')
    noteServerStatus(io, 'claude', 'github', 'disabled')
    const kept: HealthRecord = readHealth(io)
    expect(kept).toEqual({
      checkedAt: null,
      servers: {
        notion: {
          claude: { status: 'failed', why: 'MCP server notion failed to start: Connection closed', at: '2026-11-08T10:00:00.000Z' },
        },
        linear: { claude: { status: 'needs-auth', at: '2026-11-08T10:00:00.000Z' } },
      },
    })
    later(HOUR)
    answers['claude'] = { code: 0, output: 'notion: https://n (HTTP) - ✓ Connected' }
    expect((await checkHealth(io)).servers).toEqual({ notion: { claude: { status: 'connected', at: '2026-11-08T11:00:00.000Z' } } })
    // One session's word on top of a check's, the rest kept.
    noteServerStatus(io, 'codex', 'notion', 'connected')
    expect(Object.keys(readHealth(io).servers['notion'] ?? {})).toEqual(['claude', 'codex'])
    expect(JSON.parse(readFileSync(join(io.folder, 'mcp-health.json'), 'utf8')).checkedAt).toBe('2026-11-08T11:00:00.000Z')
  })
})
