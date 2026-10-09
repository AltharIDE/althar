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
