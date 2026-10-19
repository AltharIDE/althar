import { readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { describe, expect, it } from 'vitest'

import { type AgentDefinition, agents } from '../src/registry'
import { claudeWho, type SignInFlowEvent, type SignInFlowOptions, startSignInFlow } from '../src/signInFlow'

/*
 * Each agent's sign-in, run against a stand-in for its login: a script that
 * says what the real one says, so no browser opens and no sign-in happens.
 */

/** Claude Code's login: its fallback page, a code from stdin (bad turned down), then its status. */
const CLAUDE_LOGIN = `
process.stdout.write('Opening browser to sign in…\\n')
setTimeout(() => process.stdout.write("If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true\\n"), 20)
process.stdin.on('data', (data) => {
  const code = String(data).trim()
  if (code === 'bad') return process.stderr.write('Invalid code. Please make sure the full code was copied.\\n')
  if (code === 'stop') { process.stderr.write('Login failed: network\\n'); process.exit(1) }
  process.exit(0)
})`

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

/**
 * Antigravity's ACP server: answers initialize; on authenticate prints the
 * page to open, as it does, on stdout or stderr, then answers as the browser
 * would have it. Its temporary folder is where it says.
 */
const ACP_SERVER = (ending: 'success' | 'subscription', stream: 'stdout' | 'stderr' | 'split') => `
let buffer = ''
const say = (message) => process.stdout.write(JSON.stringify(message) + '\\n')
process.stderr.write('temp ' + process.env.TMPDIR + '\\n')
process.stdin.on('data', (data) => {
  buffer += data
  for (let at = buffer.indexOf('\\n'); at >= 0; at = buffer.indexOf('\\n')) {
    const message = JSON.parse(buffer.slice(0, at))
    buffer = buffer.slice(at + 1)
    if (message.method === 'initialize') say({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1, authMethods: [{ id: message.params.clientInfo.name === 'althar' ? 'oauth-personal' : 'x', name: 'Log in with Google' }] } })
    if (message.method === 'authenticate') {
      if (message.params.methodId !== 'oauth-personal') return say({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'no such method' } })
      ${
        stream === 'split'
          ? // Its line in two writes, apart, as a pipe may hand it on.
            "process.stderr.write('Open the following link to authenticate the ACP server: https://accounts.google.com/o/oau'); setTimeout(() => process.stderr.write('th2/v2/auth?state=s1\\n'), 20)"
          : `process.${stream}.write('Open the following link to authenticate the ACP server: https://accounts.google.com/o/oauth2/v2/auth?state=s1\\n')`
      }
      setTimeout(() => say(${ending === 'success' ? "{ jsonrpc: '2.0', id: message.id, result: {} }" : "{ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'Internal error: SUBSCRIPTION_REQUIRED' } }"}), 30)
    }
  }
})
setInterval(() => {}, 1000)`

const antigravity = (
  ending: 'success' | 'subscription' = 'success',
  stream: 'stdout' | 'stderr' | 'split' = 'stderr',
): AgentDefinition => ({
  ...agents.antigravity,
  signIn: {
    ...agents.antigravity.signIn,
    inApp: {
      kind: 'acp-authenticate',
      ways: ['browser'],
      run: () => ({ command: 'bun', args: ['-e', ACP_SERVER(ending, stream)], privateTemp: true }),
      method: 'oauth-personal',
      link: /Open the following link to authenticate the ACP server:\s*(\S+)/,
    },
  },
})

const claude = (login = CLAUDE_LOGIN): AgentDefinition => ({
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
  then: (said: ReadonlyArray<SignInFlowEvent>, handle: { paste: (code: string) => void; cancel: () => void }) => void = () => {},
) =>
  new Promise<ReadonlyArray<SignInFlowEvent>>((resolve) => {
    const said: SignInFlowEvent[] = []
    const handle = startSignInFlow(
      agent,
      (event) => {
        said.push(event)
        then(said, handle ?? { paste: () => {}, cancel: () => {} })
        if (event.kind === 'done' || event.kind === 'failed') resolve(said)
      },
      options,
    )
    if (handle === null) resolve(said)
  })

describe('signing in inside Althar', () => {
  it('runs Claude Code’s login: the browser, its page for a code, a code turned down, and who it signed in as', async () => {
    let pasted = 0
    const said = await run(claude(), { way: 'browser' }, (events, handle) => {
      const last = events.at(-1)
      if (last?.kind === 'browser' && last.paste && pasted === 0) {
        pasted += 1
        handle.paste('bad')
      }
      if (last?.kind === 'refused' && pasted === 1) {
        pasted += 1
        handle.paste(' good ')
      }
    })
    expect(said).toEqual([
      { kind: 'browser', link: null, paste: false },
      { kind: 'browser', link: 'https://claude.com/cai/oauth/authorize?code=true', paste: true },
      { kind: 'refused', message: 'Invalid code. Please make sure the full code was copied.' },
      { kind: 'done', who: 'you@meridian.dev', plan: 'Claude Max' },
    ])
  })

  it('says why Claude Code’s login stopped, in its words', async () => {
    const said = await run(claude(), { way: 'browser' }, (events, handle) => {
      if (events.at(-1)?.kind === 'browser' && events.length === 2) handle.paste('stop')
    })
    expect(said.at(-1)).toEqual({ kind: 'failed', message: 'Login failed: network' })
  })

  it('opens Codex’s page in the browser itself, and says who signed in, minding only its own sign-in', async () => {
    const opened: string[] = []
    const said = await run(codex(), { way: 'browser', openUrl: (url) => void opened.push(url) })
    expect(opened).toEqual(['https://auth.openai.com/oauth/authorize?x=1'])
    expect(said).toEqual([
      { kind: 'browser', link: 'https://auth.openai.com/oauth/authorize?x=1', paste: false },
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

  it('signs Antigravity in over ACP: opens the page it prints, on either stream and however its line arrives, and ends when it answers', async () => {
    for (const stream of ['stderr', 'stdout', 'split'] as const) {
      const opened: string[] = []
      const said = await run(antigravity('success', stream), { way: 'browser', openUrl: (url) => void opened.push(url) })
      expect(opened).toEqual(['https://accounts.google.com/o/oauth2/v2/auth?state=s1'])
      expect(said).toEqual([
        { kind: 'browser', link: 'https://accounts.google.com/o/oauth2/v2/auth?state=s1', paste: false },
        { kind: 'done', who: null, plan: null },
      ])
    }
  })

  it('says, in the person’s words, that Antigravity turned the account down, and leaves no temporary folder', async () => {
    const before = readdirSync(tmpdir()).filter((name) => name.startsWith('althar-agent-')).length
    const said = await run(antigravity('subscription'), { way: 'browser' })
    expect(said.at(-1)).toEqual({ kind: 'failed', message: 'Google Antigravity needs an eligible subscription on this account.' })
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(readdirSync(tmpdir()).filter((name) => name.startsWith('althar-agent-')).length).toBeLessThanOrEqual(before)
  })

  it('has Antigravity sign in only inside Althar, as it has no command of its own', () => {
    expect(agents.antigravity.signIn.login).toBe('')
    expect(agents.antigravity.signIn.inApp?.kind).toBe('acp-authenticate')
    expect(agents.antigravity.signIn.inApp?.ways).toEqual(['browser'])
    expect(startSignInFlow(agents.antigravity, () => {}, { way: 'device' })).toBeNull()
  })

  it('stops when cancelled, saying nothing more', async () => {
    const said: SignInFlowEvent[] = []
    const handle = startSignInFlow(codex(), (event) => void said.push(event), { way: 'device' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    handle?.cancel()
    handle?.paste('ignored')
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(said.filter((event) => event.kind === 'done' || event.kind === 'failed')).toEqual([])
  })

  it('gives up after its time, and offers nothing where the agent runs no sign-in of its own or not that way', async () => {
    const said = await run(claude(`setTimeout(() => {}, 10000)`), { way: 'browser', timeout: 50 })
    expect(said.at(-1)).toEqual({ kind: 'failed', message: 'The sign-in wasn’t finished in time.' })
    expect(startSignInFlow(agents.opencode, () => {}, { way: 'browser' })).toBeNull()
    expect(startSignInFlow(claude(), () => {}, { way: 'device' })).toBeNull()
  })

  it('reads who Claude Code is signed in as, and its plan, where it says', () => {
    expect(claudeWho('{"email":"you@meridian.dev","subscriptionType":"pro"}')).toEqual({ who: 'you@meridian.dev', plan: 'Claude Pro' })
    expect(claudeWho('{"loggedIn":true}')).toEqual({ who: null, plan: null })
    expect(claudeWho('null')).toEqual({ who: null, plan: null })
    expect(claudeWho('not json')).toEqual({ who: null, plan: null })
  })
})
