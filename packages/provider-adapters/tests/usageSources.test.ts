import { describe, expect, it } from 'vitest'

import { agents } from '../src/registry'
import {
  openCodeCannotList,
  openCodeCredentials,
  readOpenCodeCredentials,
  resolveOpenCodeCredential,
  usagePairs,
} from '../src/usageSources'
import { majorOf } from '../src/version'

/*
 * The contract of the usage sources: every subscription has a source and a
 * way to be told from a key, and OpenCode's sign-ins are told apart by its own
 * listing.
 */

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
    expect(spikes.sort()).toEqual([
      'antigravity/google',
      'copilot/github',
      'grok/xai',
      'junie/jetbrains',
      'kimi/moonshot',
      'mistral-vibe/mistral',
      'opencode/github-copilot',
      'opencode/google',
      'opencode/openai',
      'opencode/opencode',
      'qwen-code/qwen',
    ])
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
