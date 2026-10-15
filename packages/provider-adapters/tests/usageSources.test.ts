import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { agents } from '../src/registry'
import { extractString, readTokenField } from '../src/credentialStore'
import { buildUsageReader, MIN_INTERVAL, type UsagePolicy, usageReader } from '../src/usageRead'
import {
  allowedEndpoints,
  type EndpointSource,
  endpointProblem,
  endpointSources,
  openCodeCannotList,
  openCodeCredentials,
  readOpenCodeCredentials,
  chatGptUsageWindows,
  resolveOpenCodeCredential,
  type UsagePair,
  usagePairs,
} from '../src/usageSources'
import { majorOf } from '../src/version'

/*
 * The contract of the usage read (ADR-045): every subscription has a source and a
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
  const fetch: NonNullable<UsagePolicy['fetch']> = async (url, init) => {
    seen.push({ url, method: init.method, headers: init.headers, redirect: init.redirect })
    const r = typeof reply === 'function' ? reply() : reply
    if ('throws' in r && r.throws) throw new Error(`connect failed with ${init.headers.Authorization}`)
    return { status: r.status ?? 200, json: async () => r.body ?? ANSWER }
  }
  return { seen, fetch }
}

/** The registry with its endpoint sources confirmed, as a spike would, and `patch` applied to each: for the reader's own tests. */
const confirmedPairs = (patch: Partial<EndpointSource> = {}): UsagePair[] =>
  usagePairs.map((pair) => ({
    ...pair,
    sources: pair.sources.map((source) => (source.kind === 'endpoint' ? { ...source, confirmed: true, ...patch } : source)),
  }))

const codex = (home: string) => ({ agent: 'codex' as const, provider: 'openai', home })
const reader = (policy: UsagePolicy = {}, patch: Partial<EndpointSource> = {}) =>
  buildUsageReader({ pairs: confirmedPairs(patch), ...policy })

describe('the usage reader', () => {
  it('makes one GET to the allowlisted host and path, carrying the token, and reads the windows', async () => {
    const home = fakeHome()
    const { seen, fetch } = server({})
    const read = await reader({ fetch }).read('codex-chatgpt', codex(home))
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
      await reader({ fetch: server(reply).fetch }).read('codex-chatgpt', codex(home))
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
      results.push(await reader({ fetch: server(reply).fetch }).read('codex-chatgpt', codex(fakeHome())))
    }
    const out = JSON.stringify(results) + logs.join('\n') + written.join('')
    expect(out).not.toContain(TOKEN)
    expect(out).not.toContain('fake-refresh-0000')
  })

  it('follows no redirect, and says the address moved', async () => {
    const { seen, fetch } = server({ status: 302 })
    const read = await reader({ fetch }).read('codex-chatgpt', codex(fakeHome()))
    expect(seen).toHaveLength(1)
    expect(read).toMatchObject({ kind: 'fault', fault: 'source_changed' })
  })

  it('says sign in again for a refused token or none, and does not try to refresh it', async () => {
    for (const status of [401, 403]) {
      const { seen, fetch } = server({ status })
      expect(await reader({ fetch }).read('codex-chatgpt', codex(fakeHome()))).toMatchObject({ kind: 'fault', fault: 'sign_in_again' })
      expect(seen).toHaveLength(1)
    }
    const none = server({})
    for (const auth of [{}, { tokens: {} }, { tokens: { access_token: '' } }, { tokens: { access_token: 5 } }]) {
      expect(await reader({ fetch: none.fetch }).read('codex-chatgpt', codex(fakeHome(auth)))).toMatchObject({ fault: 'sign_in_again' })
    }
    expect(none.seen).toHaveLength(0)
    const missing = mkdtempSync(join(tmpdir(), 'althar-usage-'))
    homes.push(missing)
    expect(await reader({ fetch: none.fetch }).read('codex-chatgpt', codex(missing))).toMatchObject({ fault: 'sign_in_again' })
  })

  it('never reads a file outside the account’s home, nor one that is a link out of it', async () => {
    const home = fakeHome()
    const { seen, fetch } = server({})
    const token = { file: '../auth.json', path: ['tokens', 'access_token'] }
    expect(await reader({ fetch }, { token }).read('codex-chatgpt', codex(home))).toMatchObject({ fault: 'sign_in_again' })
    expect(await reader({ fetch }, { token: { file: '/etc/passwd', path: [] } }).read('codex-chatgpt', codex(home))).toMatchObject({
      fault: 'sign_in_again',
    })
    // Another account's sign-in, linked in as this one's auth.json.
    const other = fakeHome({ tokens: { access_token: 'another-accounts-token' } })
    const linked = fakeHome()
    rmSync(join(linked, 'auth.json'))
    symlinkSync(join(other, 'auth.json'), join(linked, 'auth.json'))
    expect(await reader({ fetch }).read('codex-chatgpt', codex(linked))).toMatchObject({ fault: 'sign_in_again' })
    // A folder that is a link out of the home.
    const folder = fakeHome()
    mkdirSync(join(other, 'dir'))
    writeFileSync(join(other, 'dir', 'auth.json'), JSON.stringify({ tokens: { access_token: 'another-accounts-token' } }))
    symlinkSync(join(other, 'dir'), join(folder, 'dir'))
    expect(
      await reader({ fetch }, { token: { file: 'dir/auth.json', path: ['tokens', 'access_token'] } }).read('codex-chatgpt', codex(folder)),
    ).toMatchObject({
      fault: 'sign_in_again',
    })
    expect(seen).toHaveLength(0)
  })

  it('reads a home that is itself reached through a link', async () => {
    const real = fakeHome()
    const via = mkdtempSync(join(tmpdir(), 'althar-usage-'))
    homes.push(via)
    const link = join(via, 'home')
    symlinkSync(real, link)
    const { seen, fetch } = server({})
    expect(await reader({ fetch }).read('codex-chatgpt', codex(link))).toMatchObject({ kind: 'usage' })
    expect(seen).toHaveLength(1)
  })

  it('says source changed for another shape, and never "no limits"', async () => {
    for (const body of [
      { odd: true },
      { rate_limit: 'x' },
      { rate_limit: {} },
      { rate_limit: { primary_window: { used_percent: 'a lot' } } },
    ]) {
      expect(await reader({ fetch: server({ body }).fetch }).read('codex-chatgpt', codex(fakeHome()))).toMatchObject({
        kind: 'fault',
        fault: 'source_changed',
      })
    }
  })

  it('says unreachable for a failed call or an error status, with fixed words', async () => {
    for (const reply of [{ throws: true }, { status: 500 }, { status: 404 }]) {
      const read = await reader({ fetch: server(reply).fetch }).read('codex-chatgpt', codex(fakeHome()))
      expect(read).toMatchObject({ kind: 'fault', fault: 'unreachable' })
      expect(JSON.stringify(read)).not.toContain('Bearer')
    }
  })

  it('asks an account at most once a minute, and keeps the windows', async () => {
    let time = Date.parse('2026-10-15T12:00:00Z')
    const { seen, fetch } = server({})
    const r = reader({ fetch, now: () => new Date(time) })
    const home = fakeHome()
    await r.read('codex-chatgpt', codex(home))
    time += MIN_INTERVAL - 1
    expect(await r.read('codex-chatgpt', codex(home))).toMatchObject({ kind: 'usage', stale: true })
    expect(seen).toHaveLength(1)
    time += 2
    expect(await r.read('codex-chatgpt', codex(home))).toMatchObject({ kind: 'usage', stale: false })
    expect(seen).toHaveLength(2)
    // Another account is its own.
    await r.read('codex-chatgpt', codex(fakeHome()))
    expect(seen).toHaveLength(3)
  })

  it('makes one call for readers asking together, and none inside the minute after', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const seen: string[] = []
    const fetch: NonNullable<UsagePolicy['fetch']> = async (url) => {
      seen.push(url)
      await gate
      return { status: 200, json: async () => ANSWER }
    }
    const r = reader({ fetch })
    const home = fakeHome()
    const together = Promise.all([1, 2, 3, 4, 5].map(() => r.read('codex-chatgpt', codex(home))))
    await new Promise((resolve) => setTimeout(resolve, 30))
    release()
    const reads = await together
    expect(seen).toHaveLength(1)
    expect(reads.every((read) => read.kind === 'usage')).toBe(true)
    await r.read('codex-chatgpt', codex(home))
    expect(seen).toHaveLength(1)
  })

  it('backs off after a 429, longer each time, showing the last windows meanwhile', async () => {
    let time = Date.parse('2026-10-15T12:00:00Z')
    let status = 200
    const { seen, fetch } = server(() => ({ status }))
    const r = reader({ fetch, now: () => new Date(time) })
    const home = fakeHome()
    await r.read('codex-chatgpt', codex(home))
    time += MIN_INTERVAL
    status = 429
    const first = await r.read('codex-chatgpt', codex(home))
    expect(first).toMatchObject({ kind: 'fault', fault: 'unreachable', last: { source: 'endpoint' } })
    time += MIN_INTERVAL + 1
    expect(await r.read('codex-chatgpt', codex(home))).toMatchObject({ kind: 'usage', stale: true })
    expect(seen).toHaveLength(2)
    time += MIN_INTERVAL * 2
    await r.read('codex-chatgpt', codex(home))
    expect(seen).toHaveLength(3)
  })

  it('refuses a source not confirmed by a spike, and one off the allowlist', async () => {
    const { seen, fetch } = server({})
    const home = fakeHome()
    expect(await buildUsageReader({ fetch }).read('codex-chatgpt', codex(home))).toMatchObject({
      fault: 'no_source',
      message: expect.stringContaining('not been confirmed'),
    })
    expect(await reader({ fetch }, { url: 'https://api.anthropic.com/api/oauth/usage' }).read('codex-chatgpt', codex(home))).toMatchObject({
      fault: 'no_source',
      message: expect.stringContaining('not allowed'),
    })
    expect(seen).toHaveLength(0)
  })

  it('reads a source for one version only when the version is known to match, never when unknown', async () => {
    const { seen, fetch } = server({})
    const opencode = (home: string, agentMajor?: number) => ({
      agent: 'opencode' as const,
      provider: 'openai',
      home,
      ...(agentMajor === undefined ? {} : { agentMajor }),
    })
    const r = reader({ fetch })
    const home = fakeHome()
    expect(await r.read('opencode-chatgpt', opencode(home))).toMatchObject({
      fault: 'no_source',
      message: expect.stringContaining('version 1'),
    })
    expect(await r.read('opencode-chatgpt', opencode(home, 2))).toMatchObject({
      fault: 'no_source',
      message: expect.stringContaining('version 1'),
    })
    expect(seen).toHaveLength(0)
    expect(await r.read('opencode-chatgpt', opencode(home, 1))).toMatchObject({ kind: 'usage' })
    expect(seen).toHaveLength(1)
  })

  it('takes a source from the registry, for the account’s own pair, and never one a caller supplies', async () => {
    const { seen, fetch } = server({})
    const r = reader({ fetch })
    const home = fakeHome()
    // A source of another agent, a source that does not exist, a Claude account, and a key pair: none is read.
    expect(await r.read('opencode-chatgpt', { ...codex(home), agentMajor: 1 })).toMatchObject({
      message: expect.stringContaining('no such usage source'),
    })
    expect(await r.read('nope', codex(home))).toMatchObject({ message: expect.stringContaining('no such usage source') })
    expect(await r.read('codex-chatgpt', { agent: 'claude-code', provider: 'anthropic', home })).toMatchObject({
      message: expect.stringContaining('no such usage source'),
    })
    expect(await r.read('codex-chatgpt', { agent: 'codex', provider: 'other', home })).toMatchObject({
      message: expect.stringContaining('no such usage source'),
    })
    expect(seen).toHaveLength(0)
  })

  it('cannot be changed at run time: the registry and the allowlist are frozen all the way down', async () => {
    const frozen = (value: unknown): boolean =>
      typeof value !== 'object' || value === null || (Object.isFrozen(value) && Object.values(value).every(frozen))
    expect(frozen(usagePairs)).toBe(true)
    expect(frozen(allowedEndpoints)).toBe(true)
    const source = endpointSources()[0]!
    const mutate = (change: () => void) => expect(change).toThrow(TypeError)
    mutate(() => ((source as { url: string }).url = 'https://evil.example/steal'))
    mutate(() => ((source as { confirmed: boolean }).confirmed = true))
    mutate(() => (source.token.path as string[]).push('x'))
    mutate(() => (allowedEndpoints as Array<{ host: string; path: string }>).push({ host: 'evil.example', path: '/steal' }))
    mutate(() => ((allowedEndpoints[0] as { host: string }).host = 'evil.example'))
    mutate(() => (usagePairs as UsagePair[]).push(usagePairs[0]!))
    // And so the production reader still refuses, and sends nothing.
    const { seen, fetch } = server({})
    expect(await buildUsageReader({ fetch }).read('codex-chatgpt', codex(fakeHome()))).toMatchObject({ kind: 'fault' })
    expect(seen).toHaveLength(0)
  })

  it('has no way to widen the allowlist or supply a source from outside the package', () => {
    const index = readFileSync(join(SRC, 'index.ts'), 'utf8')
    expect(index).toMatch(/usageReader/)
    expect(index).not.toMatch(/buildUsageReader|UsagePolicy|MIN_INTERVAL/)
    expect(Object.keys(usageReader)).toEqual(['read'])
  })

  it('reads no source of the registry yet: none is confirmed', async () => {
    expect(endpointSources().every((source) => !source.confirmed)).toBe(true)
    const { seen, fetch } = server({})
    expect(await buildUsageReader({ fetch }).read('codex-chatgpt', codex(fakeHome()))).toMatchObject({ kind: 'fault' })
    expect(seen).toHaveLength(0)
  })
})

describe('taking one string out of a credential file', () => {
  const FILE = JSON.stringify({
    OPENAI_API_KEY: 'sk-sibling-key',
    other: { tokens: { access_token: 'wrong-place' } },
    tokens: { id_token: 'id-sibling', refresh_token: 'refresh-sibling', access_token: 'right', arr: [1, { access_token: 'in-array' }] },
    after: { access_token: 'also-wrong' },
  })
  const PATH = ['tokens', 'access_token']

  it('finds the string on the path, and no other', () => {
    expect(extractString([FILE], PATH)).toBe('right')
    expect(extractString([JSON.stringify({ other: { tokens: { access_token: 'x' } } })], PATH)).toBeNull()
    expect(extractString([JSON.stringify({ tokens: [{ access_token: 'x' }] })], PATH)).toBeNull()
    expect(extractString([JSON.stringify({ tokens: { access_token: 5 } })], PATH)).toBeNull()
    expect(extractString([JSON.stringify({ tokens: { access_token: null } })], PATH)).toBeNull()
    expect(extractString([JSON.stringify({ tokens: { access_token: '' } })], PATH)).toBeNull()
    expect(extractString(['{"tokens":{"access_token":"cut'], PATH)).toBeNull()
    expect(extractString(['not json'], PATH)).toBeNull()
  })

  it('reads the same however the text is cut into pieces, and decodes the string it returns', () => {
    for (const size of [1, 2, 3, 7, 50]) {
      const pieces = FILE.match(new RegExp(`.{1,${size}}`, 'gs')) ?? []
      expect(extractString(pieces, PATH), `pieces of ${size}`).toBe('right')
    }
    expect(extractString(['{"tokens":{"access_token":"a\\"b\\u00e9"}}'], PATH)).toBe('a"bé')
  })

  it('never builds a value that is not the token: the parser sees only the one string', async () => {
    const home = fakeHome(JSON.parse(FILE))
    const parse = vi.spyOn(JSON, 'parse')
    expect(await readTokenField(home, { file: 'auth.json', path: PATH })).toBe('right')
    const parsed = parse.mock.calls.map(([text]) => String(text))
    expect(parsed).toEqual(['"right"'])
  })

  it('does not look at the rest of a long file once it has the token', async () => {
    const home = fakeHome()
    writeFileSync(join(home, 'auth.json'), `{"tokens":{"access_token":"first"},"pad":"${'x'.repeat(200_000)}"}`)
    expect(await readTokenField(home, { file: 'auth.json', path: PATH })).toBe('first')
  })

  it('takes a key with an escape, or a very long one, for no key on the path', () => {
    expect(extractString(['{"tok\\u0065ns":{"access_token":"x"}}'], PATH)).toBeNull()
    expect(extractString([JSON.stringify({ ['k'.repeat(500)]: { access_token: 'x' }, tokens: { access_token: 'ok' } })], PATH)).toBe('ok')
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

describe('every OpenCode sign-in lands on a declared pair', () => {
  const credential = (provider: string, method: string) =>
    openCodeCredentials(JSON.stringify([{ id: provider, name: provider, connections: [{ type: 'credential', method, label: 'x' }] }]))![0]!

  it('covers the plan providers the registry declares, and a key as a key', () => {
    for (const provider of ['openai', 'opencode', 'github-copilot', 'google']) {
      const pair = usagePairs.find((p) => p.agent === 'opencode' && p.provider === provider)!
      expect(pair.sources.length).toBeGreaterThan(0)
      expect(resolveOpenCodeCredential({ provider, pays: 'plan' })).toMatchObject({ kind: 'covered', pair: { provider } })
    }
    expect(resolveOpenCodeCredential(credential('openai', 'key'))).toMatchObject({ kind: 'covered', pair: { pays: 'key' } })
  })

  it('makes a fault of a plan provider with no pair, and of a method it cannot classify, never a quiet cover', () => {
    expect(resolveOpenCodeCredential({ provider: 'brand-new-plan', pays: 'plan' })).toEqual({ kind: 'no_pair', provider: 'brand-new-plan' })
    expect(resolveOpenCodeCredential(credential('openai', 'something-new'))).toEqual({ kind: 'cannot_classify' })
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

  it('is asked only of OpenCode 2 and later, by the major its --version says', () => {
    // OpenCode 1.19.0's `auth list` has no --standalone or --format: it exits 1 and prints its help.
    expect(openCodeCannotList('OpenCode', majorOf('1.19.0') ?? undefined)).toBe(
      'OpenCode 1 can’t tell plans from API keys: it doesn’t list which of its sign-ins are which, so Althar can’t show a plan’s usage.',
    )
    expect(openCodeCannotList('OpenCode', undefined)).toContain('couldn’t tell which version of OpenCode')
    expect(openCodeCannotList('OpenCode', majorOf('2.0.29') ?? undefined)).toBeNull()
    expect(openCodeCannotList('OpenCode', 3)).toBeNull()
  })
})

describe('listing an OpenCode account’s sign-ins', () => {
  const listing = (script: string) => ({
    ...agents.opencode,
    signIn: { ...agents.opencode.signIn, credentials: () => ({ command: 'bun', args: ['-e', script] }) },
  })

  it('reads what the listing prints, in the account’s home', async () => {
    const script = `console.log(JSON.stringify([{ id: 'openai', name: process.env.XDG_DATA_HOME, connections: [{ type: 'credential', method: 'chatgpt-browser', label: 'x' }] }]))`
    expect(await readOpenCodeCredentials(listing(script), { home: { XDG_DATA_HOME: '/accounts/a' } })).toEqual({
      kind: 'credentials',
      credentials: [{ provider: 'openai', pays: 'plan' }],
    })
  })

  it('is a fault, never "no sign-ins", for a failing command, another shape, or no listing', async () => {
    expect(await readOpenCodeCredentials(listing('process.exit(1)'))).toMatchObject({ kind: 'failed' })
    expect(await readOpenCodeCredentials(listing(`console.log('└  2 credentials')`))).toMatchObject({ kind: 'failed' })
    expect(await readOpenCodeCredentials(agents.codex)).toMatchObject({ kind: 'failed' })
  })

  it('is asked of OpenCode only, with the flag that keeps it to the account’s own home', () => {
    expect(agents.opencode.signIn.credentials?.('node').args).toEqual(['auth', 'list', '--standalone', '--format', 'json'])
    expect(agents['claude-code'].signIn.credentials).toBeUndefined()
    expect(agents.codex.signIn.credentials).toBeUndefined()
  })
})
