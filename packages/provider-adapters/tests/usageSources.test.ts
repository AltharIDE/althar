import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { agents } from '../src/registry'
import { createUsageReader, MIN_INTERVAL, type UsageReaderDeps } from '../src/usageRead'
import {
  allowedEndpoints,
  type EndpointSource,
  endpointProblem,
  endpointSources,
  openCodeCredentials,
  chatGptUsageWindows,
  usagePairs,
} from '../src/usageSources'

/*
 * The contract of the usage read (ADR-043): every subscription has a source and a
 * way to be told from a key, every endpoint is on the allowlist, and the
 * reader does only what the ADR lets it, against a fake home, token and server.
 */

const TOKEN = 'fake-token-9f3b2c71'
const SRC = join(__dirname, '../src')

describe('every pair has a source', () => {
  it('is declared for each agent’s subscription, with the way it is told from a key', () => {
    for (const agent of Object.keys(agents)) {
      expect(
        usagePairs.some((pair) => pair.agent === agent && pair.pays === 'plan'),
        `${agent} has a plan pair`,
      ).toBe(true)
    }
    for (const pair of usagePairs.filter((p) => p.pays === 'plan')) {
      expect(pair.sources.length, `${pair.agent}/${pair.provider} has a source`).toBeGreaterThan(0)
      expect(pair.classification, `${pair.agent}/${pair.provider} says how it is classified`).toBeTruthy()
    }
  })

  it('classifies a pair by something the agent has: a sign-in status, or OpenCode’s auth list', () => {
    for (const pair of usagePairs) {
      if (pair.classification === 'status') expect(agents[pair.agent].signIn.paidBy, `${pair.agent} reports how it is paid`).toBeDefined()
    }
    // OpenCode’s status is its auth list, read per provider, not the whole account as a key.
    expect(usagePairs.filter((p) => p.agent === 'opencode').every((p) => p.classification === 'auth_list')).toBe(true)
  })

  it('lists the gaps that wait for a spike, so a new one cannot slip in', () => {
    const spikes = usagePairs
      .filter((pair) => pair.pays === 'plan' && pair.sources.every((source) => source.kind === 'spike'))
      .map((pair) => `${pair.agent}/${pair.provider}`)
    expect(spikes.sort()).toEqual(['opencode/github-copilot', 'opencode/google', 'opencode/opencode'])
  })

  it('has no Claude endpoint', () => {
    const claude = usagePairs.filter((pair) => pair.agent === 'claude-code')
    expect(claude.flatMap((pair) => pair.sources).some((source) => source.kind === 'endpoint')).toBe(false)
  })
})

describe('the allowlist', () => {
  it('holds every endpoint of the registry: https, a GET, one host and path, none an Anthropic host', () => {
    expect(endpointSources().length).toBeGreaterThan(0)
    for (const source of endpointSources()) expect(endpointProblem(source), source.id).toBeNull()
    for (const entry of allowedEndpoints) expect(entry.host).not.toMatch(/anthropic|claude/i)
  })

  const base = endpointSources()[0]!
  const with_ = (change: Partial<EndpointSource>): EndpointSource => ({ ...base, ...change })

  it('turns away a source that is http, has a port or a query, is not a GET, or is not on the list', () => {
    expect(endpointProblem(with_({ url: 'http://chatgpt.com/backend-api/wham/usage' }))).toMatch(/https/)
    expect(endpointProblem(with_({ url: 'https://chatgpt.com:8443/backend-api/wham/usage' }))).toMatch(/more than a host/)
    expect(endpointProblem(with_({ url: 'https://chatgpt.com/backend-api/wham/usage?x=1' }))).toMatch(/more than a host/)
    expect(endpointProblem(with_({ url: 'https://u:p@chatgpt.com/backend-api/wham/usage' }))).toMatch(/more than a host/)
    expect(endpointProblem(with_({ url: 'https://example.com/backend-api/wham/usage' }))).toMatch(/allowlist/)
    expect(endpointProblem(with_({ url: 'https://chatgpt.com/other' }))).toMatch(/allowlist/)
    expect(endpointProblem(with_({ method: 'POST' as 'GET' }))).toMatch(/GET/)
    expect(endpointProblem(with_({ url: 'nope' }))).toMatch(/not a URL/)
  })

  it('never lets an Anthropic host in, even if listed', () => {
    const anthropic = { host: 'api.anthropic.com', path: '/api/oauth/usage' }
    expect(endpointProblem(with_({ url: 'https://api.anthropic.com/api/oauth/usage' }), [anthropic])).toMatch(/Anthropic/)
    expect(endpointProblem(with_({ url: 'https://claude.ai/api/usage' }), [{ host: 'claude.ai', path: '/api/usage' }])).toMatch(/Anthropic/)
  })
})

/* The reader, against a fake home, token and server. */

const homes: string[] = []
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
  vi.restoreAllMocks()
})

const fakeHome = (auth: unknown = { tokens: { access_token: TOKEN, refresh_token: 'fake-refresh-0000' } }) => {
  const home = mkdtempSync(join(tmpdir(), 'althar-usage-'))
  homes.push(home)
  mkdirSync(join(home, 'sessions'))
  writeFileSync(join(home, 'auth.json'), JSON.stringify(auth))
  writeFileSync(join(home, 'config.toml'), 'model = "x"\n')
  writeFileSync(join(home, 'sessions', 'a.jsonl'), '{}\n')
  return home
}

/** Every file in the home, with a digest and the time it was last changed: nothing may differ afterwards. */
const snapshot = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return snapshot(path)
      return [`${path} ${createHash('sha256').update(readFileSync(path)).digest('hex')} ${statSync(path).mtimeMs}`]
    })
    .sort()

const ANSWER = {
  rate_limit: {
    primary_window: { used_percent: 42, reset_at: 1_760_540_400, limit_window_seconds: 18_000 },
    secondary_window: { used_percent: 10, reset_at: 1_761_000_000, limit_window_seconds: 604_800 },
  },
}

interface Seen {
  url: string
  method: string
  headers: Record<string, string>
  redirect: string
}

const server = (reply: { status?: number; body?: unknown; throws?: boolean } | (() => { status?: number; body?: unknown })) => {
  const seen: Seen[] = []
  const fetch: NonNullable<UsageReaderDeps['fetch']> = async (url, init) => {
    seen.push({ url, method: init.method, headers: init.headers, redirect: init.redirect })
    const r = typeof reply === 'function' ? reply() : reply
    if ('throws' in r && r.throws) throw new Error(`connect failed with ${init.headers.Authorization}`)
    return { status: r.status ?? 200, json: async () => r.body ?? ANSWER }
  }
  return { seen, fetch }
}

const confirmed = (): EndpointSource => ({ ...endpointSources()[0]!, confirmed: true })

describe('the usage reader', () => {
  it('makes one GET to the allowlisted host and path, carrying the token, and reads the windows', async () => {
    const home = fakeHome()
    const { seen, fetch } = server({})
    const read = await createUsageReader({ fetch }).read(confirmed(), { home })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ url: 'https://chatgpt.com/backend-api/wham/usage', method: 'GET', redirect: 'manual' })
    expect(seen[0]!.headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(read).toMatchObject({ kind: 'usage', stale: false, usage: { source: 'endpoint' } })
    if (read.kind === 'usage') expect(read.usage.windows.map((w) => w.kind)).toEqual(['five_hour', 'weekly'])
  })

  it('leaves the home exactly as it was: nothing written, refreshed or touched', async () => {
    const home = fakeHome()
    const before = snapshot(home)
    for (const reply of [{}, { status: 401 }, { status: 429 }, { status: 500 }, { body: { odd: true } }, { throws: true }]) {
      await createUsageReader({ fetch: server(reply).fetch }).read(confirmed(), { home })
    }
    expect(snapshot(home)).toEqual(before)
  })

  it('puts the token nowhere that comes out: the result, a fault, the console, or the registry', async () => {
    const logs: string[] = []
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const)
      vi.spyOn(console, method).mockImplementation((...a) => void logs.push(a.join(' ')))
    const written: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => (written.push(String(chunk)), true)) as never)
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => (written.push(String(chunk)), true)) as never)
    const results: unknown[] = []
    for (const reply of [
      {},
      { status: 401 },
      { status: 403 },
      { status: 429 },
      { status: 302 },
      { status: 500 },
      { body: { odd: true } },
      { throws: true },
    ]) {
      results.push(await createUsageReader({ fetch: server(reply).fetch }).read(confirmed(), { home: fakeHome() }))
    }
    const out = JSON.stringify(results) + logs.join('\n') + written.join('')
    expect(out).not.toContain(TOKEN)
    expect(out).not.toContain('fake-refresh-0000')
  })

  it('follows no redirect, and says the address moved', async () => {
    const { seen, fetch } = server({ status: 302 })
    const read = await createUsageReader({ fetch }).read(confirmed(), { home: fakeHome() })
    expect(seen).toHaveLength(1)
    expect(read).toMatchObject({ kind: 'fault', fault: 'source_changed' })
  })

  it('says sign in again for a refused token or none, and does not try to refresh it', async () => {
    for (const status of [401, 403]) {
      const { seen, fetch } = server({ status })
      expect(await createUsageReader({ fetch }).read(confirmed(), { home: fakeHome() })).toMatchObject({
        kind: 'fault',
        fault: 'sign_in_again',
      })
      expect(seen).toHaveLength(1)
    }
    const none = server({})
    for (const auth of [{}, { tokens: {} }, { tokens: { access_token: '' } }, { tokens: { access_token: 5 } }]) {
      expect(await createUsageReader({ fetch: none.fetch }).read(confirmed(), { home: fakeHome(auth) })).toMatchObject({
        fault: 'sign_in_again',
      })
    }
    expect(none.seen).toHaveLength(0)
    const missing = mkdtempSync(join(tmpdir(), 'althar-usage-'))
    homes.push(missing)
    expect(await createUsageReader({ fetch: none.fetch }).read(confirmed(), { home: missing })).toMatchObject({ fault: 'sign_in_again' })
  })

  it('never reads a file outside the account’s home', async () => {
    const home = fakeHome()
    const outside = { ...confirmed(), token: { file: '../auth.json', path: ['tokens', 'access_token'] } }
    const { seen, fetch } = server({})
    expect(await createUsageReader({ fetch }).read(outside, { home })).toMatchObject({ fault: 'sign_in_again' })
    expect(await createUsageReader({ fetch }).read({ ...outside, token: { file: '/etc/passwd', path: [] } }, { home })).toMatchObject({
      fault: 'sign_in_again',
    })
    expect(seen).toHaveLength(0)
  })

  it('says source changed for another shape, and never "no limits"', async () => {
    for (const body of [
      { odd: true },
      { rate_limit: 'x' },
      { rate_limit: {} },
      { rate_limit: { primary_window: { used_percent: 'a lot' } } },
    ]) {
      expect(await createUsageReader({ fetch: server({ body }).fetch }).read(confirmed(), { home: fakeHome() })).toMatchObject({
        kind: 'fault',
        fault: 'source_changed',
      })
    }
  })

  it('says unreachable for a failed call or an error status, with fixed words', async () => {
    for (const reply of [{ throws: true }, { status: 500 }, { status: 404 }]) {
      const read = await createUsageReader({ fetch: server(reply).fetch }).read(confirmed(), { home: fakeHome() })
      expect(read).toMatchObject({ kind: 'fault', fault: 'unreachable' })
      expect(JSON.stringify(read)).not.toContain('Bearer')
    }
  })

  it('asks an account at most once a minute, and keeps the windows', async () => {
    let time = Date.parse('2026-10-15T12:00:00Z')
    const { seen, fetch } = server({})
    const reader = createUsageReader({ fetch, now: () => new Date(time) })
    const home = fakeHome()
    await reader.read(confirmed(), { home })
    time += MIN_INTERVAL - 1
    expect(await reader.read(confirmed(), { home })).toMatchObject({ kind: 'usage', stale: true })
    expect(seen).toHaveLength(1)
    time += 2
    expect(await reader.read(confirmed(), { home })).toMatchObject({ kind: 'usage', stale: false })
    expect(seen).toHaveLength(2)
    // Another account is its own.
    await reader.read(confirmed(), { home: fakeHome() })
    expect(seen).toHaveLength(3)
  })

  it('backs off after a 429, longer each time, showing the last windows meanwhile', async () => {
    let time = Date.parse('2026-10-15T12:00:00Z')
    let status = 200
    const { seen, fetch } = server(() => ({ status }))
    const reader = createUsageReader({ fetch, now: () => new Date(time) })
    const home = fakeHome()
    await reader.read(confirmed(), { home })
    time += MIN_INTERVAL
    status = 429
    const first = await reader.read(confirmed(), { home })
    expect(first).toMatchObject({ kind: 'fault', fault: 'unreachable', last: { source: 'endpoint' } })
    time += MIN_INTERVAL + 1
    expect(await reader.read(confirmed(), { home })).toMatchObject({ kind: 'usage', stale: true })
    expect(seen).toHaveLength(2)
    time += MIN_INTERVAL * 2
    await reader.read(confirmed(), { home })
    expect(seen).toHaveLength(3)
  })

  it('refuses a source not confirmed by a spike, one off the allowlist, and one for another major version', async () => {
    const { seen, fetch } = server({})
    const reader = createUsageReader({ fetch })
    const home = fakeHome()
    expect(await reader.read(endpointSources()[0]!, { home })).toMatchObject({
      fault: 'unreachable',
      message: expect.stringContaining('not been confirmed'),
    })
    expect(await reader.read({ ...confirmed(), url: 'https://api.anthropic.com/api/oauth/usage' }, { home })).toMatchObject({
      fault: 'unreachable',
      message: expect.stringContaining('not allowed'),
    })
    const opencode = endpointSources().find((s) => s.id === 'opencode-chatgpt')!
    expect(await reader.read({ ...opencode, confirmed: true }, { home, agentMajor: 2 })).toMatchObject({
      fault: 'unreachable',
      message: expect.stringContaining('version 1'),
    })
    expect(seen).toHaveLength(0)
  })

  it('reads no source of the registry yet: none is confirmed', () => {
    expect(endpointSources().every((source) => !source.confirmed)).toBe(true)
  })
})

describe('only the reader opens a credential store', () => {
  const files = readdirSync(SRC).filter((name) => name.endsWith('.ts'))

  it('is imported, as code, only by the reader, and not exported from the package', () => {
    for (const name of files.filter((n) => n !== 'usageRead.ts' && n !== 'credentialStore.ts')) {
      const imports = readFileSync(join(SRC, name), 'utf8').match(/^(import|export)\s.*credentialStore'.*$/gm) ?? []
      for (const line of imports) expect(line, `${name}: ${line}`).toMatch(/^import type /)
    }
    expect(readFileSync(join(SRC, 'index.ts'), 'utf8')).not.toMatch(/credentialStore/)
  })

  it('never writes, whatever else is read: the store has no write call', () => {
    const store = readFileSync(join(SRC, 'credentialStore.ts'), 'utf8')
    expect(store).not.toMatch(/writeFile|appendFile|rename|unlink|rm\(|mkdir|chmod|utimes|createWriteStream|copyFile/)
  })

  it('has no other file in the package that reads an agent’s auth.json', () => {
    for (const name of files.filter((n) => n !== 'credentialStore.ts' && n !== 'usageSources.ts')) {
      expect(readFileSync(join(SRC, name), 'utf8'), name).not.toMatch(/readFile[^\n]*auth\.json|auth\.json[^\n]*readFile/)
    }
  })
})

describe('ChatGPT’s usage answer', () => {
  it('reads each window by its length, whichever slot it arrives in', () => {
    const windows = chatGptUsageWindows({ rate_limit: { primary_window: ANSWER.rate_limit.secondary_window, secondary_window: null } })
    expect(windows).toMatchObject([{ kind: 'weekly', usedPercent: 10, minutes: 10_080 }])
  })
})

describe('OpenCode: plan or key per provider, from auth list', () => {
  const output = (...connections: Array<[string, string]>) =>
    JSON.stringify(connections.map(([id, method]) => ({ id, name: id, connections: [{ type: 'credential', method, label: 'x' }] })))

  it('tells a key from a ChatGPT plan, and leaves any other method unknown', () => {
    expect(openCodeCredentials(output(['openai', 'key'], ['openai', 'chatgpt-browser'], ['x', 'something-new']))).toEqual([
      { provider: 'openai', pays: 'key' },
      { provider: 'openai', pays: 'plan' },
      { provider: 'x', pays: 'unknown' },
    ])
  })

  it('has nothing for output that is not that shape, which 1.x’s count is', () => {
    expect(openCodeCredentials('└  2 credentials')).toBeNull()
    expect(openCodeCredentials('')).toBeNull()
    expect(openCodeCredentials('{"a":1}')).toBeNull()
    expect(openCodeCredentials('[{"id":1}]')).toBeNull()
    expect(openCodeCredentials('[{"id":"a"}]')).toBeNull()
  })
})
