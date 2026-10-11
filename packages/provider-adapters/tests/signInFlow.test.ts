import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { type AgentDefinition, agents } from '../src/registry'
import { claudeWho, type SignInFlowEvent, type SignInFlowHandle, type SignInFlowOptions, startSignInFlow } from '../src/signInFlow'

/*
 * Each agent's sign-in, run against a stand-in for its login: a script that
 * says what the real one says, so no browser opens and no sign-in happens.
 */

/**
 * Claude Code's login: it says to open the browser, and prints its page for a
 * code, which the real one reads from its input. Whatever reaches its input
 * is kept in `heard`, for the test to read. Then the browser comes back, the
 * login fails, or it waits.
 */
const CLAUDE_LOGIN = (heard: string, ending: 'signed in' | 'failed' | 'waits') => `
const fs = require('node:fs')
fs.writeFileSync(${JSON.stringify(heard)}, '')
process.stdin.on('data', (data) => fs.appendFileSync(${JSON.stringify(heard)}, data))
process.stdout.write('Opening browser to sign in…\\n')
process.stdout.write("If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true\\n")
${
  ending === 'signed in'
    ? 'setTimeout(() => process.exit(0), 100)'
    : ending === 'failed'
      ? "setTimeout(() => { process.stderr.write('Login failed: network\\n'); process.exit(1) }, 100)"
      : 'setInterval(() => {}, 1000)'
}`

/** A file for what reaches Claude Code's input. */
const heardFile = () => join(mkdtempSync(join(tmpdir(), 'althar-claude-login-')), 'heard')

const CLAUDE_STATUS = `console.log(JSON.stringify({ loggedIn: true, email: 'you@meridian.dev', subscriptionType: 'max' }))`

/** Codex's app-server: answers initialize, a sign-in started either way, and says how it ended. */
const CODEX_SERVER = (ending: 'success' | 'failure') => `
let buffer = ''
const say = (message) => process.stdout.write(JSON.stringify(message) + '\\n')
process.stdin.on('data', (data) => {
  buffer += data
  for (let at = buffer.indexOf('\\n'); at >= 0; at = buffer.indexOf('\\n')) {
    const message = JSON.parse(buffer.slice(0, at))
    buffer = buffer.slice(at + 1)
    if (message.method === 'initialize') say({ id: message.id, result: {} })
    if (message.method === 'account/login/start') {
      say({ id: message.id, result: message.params.type === 'chatgpt'
        ? { type: 'chatgpt', loginId: 'l1', authUrl: 'https://auth.openai.com/oauth/authorize?x=1' }
        : { type: 'chatgptDeviceCode', loginId: 'l1', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'LNBY-V0Q5J' } })
      setTimeout(() => {
        say({ method: 'account/login/completed', params: { loginId: 'other', success: true } })
        say({ method: 'account/login/completed', params: ${ending === 'success' ? "{ loginId: 'l1', success: true }" : "{ loginId: 'l1', success: false, error: 'Login was not completed' }"} })
      }, 30)
    }
    if (message.method === 'account/read') say({ id: message.id, result: { account: { type: 'chatgpt', email: 'dana@northwind.io', planType: 'pro' } } })
    if (message.method === 'account/login/cancel') process.exit(0)
  }
})`

/* A Codex that answers, then stops reading: under Node, whose closed pipe breaks the next write, as a native app-server's does. */
const CODEX_DEAF = `
process.stdin.once('data', (data) => {
  const message = JSON.parse(String(data).split('\\n')[0])
  process.stdin.pause()
  require('node:fs').closeSync(0)
  process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + '\\n')
  setTimeout(() => process.exit(0), 2000)
})`

const claude = (login: string): AgentDefinition => ({
  ...agents['claude-code'],
  signIn: {
    ...agents['claude-code'].signIn,
    status: () => ({ command: 'bun', args: ['-e', CLAUDE_STATUS] }),
    inApp: { kind: 'claude-login', ways: ['browser'], run: () => ({ command: 'bun', args: ['-e', login] }) },
  },
})

const codex = (ending: 'success' | 'failure' = 'success'): AgentDefinition => ({
  ...agents.codex,
  signIn: {
    ...agents.codex.signIn,
    inApp: { kind: 'codex-app-server', ways: ['browser', 'device'], run: () => ({ command: 'bun', args: ['-e', CODEX_SERVER(ending)] }) },
  },
})

/** Runs a sign-in, collecting what it says, until it ends; `then` acts on what it said so far. */
const run = (
  agent: AgentDefinition,
  options: SignInFlowOptions,
  then: (said: ReadonlyArray<SignInFlowEvent>, handle: SignInFlowHandle) => void = () => {},
) =>
  new Promise<ReadonlyArray<SignInFlowEvent>>((resolve) => {
    const said: SignInFlowEvent[] = []
    const handle = startSignInFlow(
      agent,
      (event) => {
        said.push(event)
        then(said, handle ?? { cancel: () => {} })
        if (event.kind === 'done' || event.kind === 'failed') resolve(said)
      },
      options,
    )
    if (handle === null) resolve(said)
  })

describe('signing in inside Althar', () => {
  it('never writes to Claude Code’s login: not while it waits, not once it signs in, not when it is stopped', async () => {
    // Signed in in the browser: who as, and nothing reached its input. Althar has no way to give it one.
    const heard = heardFile()
    let handed: ReadonlyArray<string> = []
    const said = await run(
      claude(CLAUDE_LOGIN(heard, 'signed in')),
      { way: 'browser' },
      (_said, handle) => void (handed = Object.keys(handle)),
    )
    expect(said).toEqual([
      { kind: 'browser', link: null },
      { kind: 'done', who: 'you@meridian.dev', plan: 'Claude Max' },
    ])
    expect(readFileSync(heard, 'utf8')).toBe('')
    expect(handed).toEqual(['cancel'])

    // Stopped while it waits on the browser: nothing more is said, and still nothing reached it.
    const waiting = heardFile()
    const events: SignInFlowEvent[] = []
    const handle = startSignInFlow(claude(CLAUDE_LOGIN(waiting, 'waits')), (event) => void events.push(event), { way: 'browser' })
    for (let tries = 0; tries < 100 && !existsSync(waiting); tries++) await new Promise((resolve) => setTimeout(resolve, 20))
    handle?.cancel()
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(events).toEqual([{ kind: 'browser', link: null }])
    expect(readFileSync(waiting, 'utf8')).toBe('')
  })

  it('says why Claude Code’s login stopped, in its words, and never its page for a code', async () => {
    const said = await run(claude(CLAUDE_LOGIN(heardFile(), 'failed')), { way: 'browser' })
    expect(said.at(-1)).toEqual({ kind: 'failed', message: 'Login failed: network' })
    const quiet = await run(
      claude(
        `process.stdout.write("If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true\\n"); process.exit(1)`,
      ),
      { way: 'browser' },
    )
    expect(quiet.at(-1)).toEqual({ kind: 'failed', message: 'Claude Code stopped signing in.' })
  })

  it('opens Codex’s page in the browser itself, and says who signed in, minding only its own sign-in', async () => {
    const opened: string[] = []
    const said = await run(codex(), { way: 'browser', openUrl: (url) => void opened.push(url) })
    expect(opened).toEqual(['https://auth.openai.com/oauth/authorize?x=1'])
    expect(said).toEqual([
      { kind: 'browser', link: 'https://auth.openai.com/oauth/authorize?x=1' },
      { kind: 'done', who: 'dana@northwind.io', plan: 'ChatGPT Pro' },
    ])
  })

  it('gives Codex’s one-time code and its page, and says when it wasn’t finished', async () => {
    const said = await run(codex('failure'), { way: 'device' })
    expect(said).toEqual([
      { kind: 'device', code: 'LNBY-V0Q5J', page: 'https://auth.openai.com/codex/device', minutes: 15 },
      { kind: 'failed', message: 'Login was not completed' },
    ])
  })

  it('ends, rather than taking Althar down, when Codex stops reading mid-way', async () => {
    const deaf: AgentDefinition = {
      ...agents.codex,
      signIn: {
        ...agents.codex.signIn,
        inApp: { kind: 'codex-app-server', ways: ['browser'], run: () => ({ command: 'node', args: ['-e', CODEX_DEAF] }) },
      },
    }
    const said = await run(deaf, { way: 'browser' })
    expect(said.at(-1)?.kind).toBe('failed')
  })

  it('stops when cancelled, saying nothing more', async () => {
    const said: SignInFlowEvent[] = []
    const handle = startSignInFlow(codex(), (event) => void said.push(event), { way: 'device' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    handle?.cancel()
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(said.filter((event) => event.kind === 'done' || event.kind === 'failed')).toEqual([])
  })

  it('gives up after its time, and offers nothing where the agent runs no sign-in of its own or not that way', async () => {
    const said = await run(claude(`setTimeout(() => {}, 10000)`), { way: 'browser', timeout: 50 })
    expect(said.at(-1)).toEqual({ kind: 'failed', message: 'The sign-in wasn’t finished in time.' })
    expect(startSignInFlow(agents.opencode, () => {}, { way: 'browser' })).toBeNull()
    expect(startSignInFlow(claude('process.exit(0)'), () => {}, { way: 'device' })).toBeNull()
  })

  it('reads who Claude Code is signed in as, and its plan, where it says', () => {
    expect(claudeWho('{"email":"you@meridian.dev","subscriptionType":"pro"}')).toEqual({ who: 'you@meridian.dev', plan: 'Claude Pro' })
    expect(claudeWho('{"loggedIn":true}')).toEqual({ who: null, plan: null })
    expect(claudeWho('null')).toEqual({ who: null, plan: null })
    expect(claudeWho('not json')).toEqual({ who: null, plan: null })
  })
})
