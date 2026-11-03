import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { waitFor } from '@althar/testing'

import { type AgentDefinition, agents, type LaunchSpec } from '../src/registry'
import { type SignInFlowEvent, type SignInFlowHandle, type SignInFlowOptions, startSignInFlow } from '../src/signInFlow'

/*
 * The ways an agent's own sign-in goes otherwise than planned, each run
 * against a stand-in that says what the agent would: an app-server that
 * refuses or says too little, a login that stops without a word, a command
 * that lives out on the device, a page printed on a line never ended.
 */

/**
 * A Codex app-server that answers each method as `plan` says. Given a `marker`, it holds on through a kill long enough to
 * read a cancel and tell of it there, and stops by itself after ten seconds whatever happens.
 */
const CODEX = (plan: Readonly<Record<string, unknown>>, marker = '') => `
const plan = ${JSON.stringify(plan)}
let buffer = ''
const say = (message) => process.stdout.write(JSON.stringify(message) + '\\n')
${marker === '' ? '' : "process.on('SIGTERM', () => {}); setTimeout(() => process.exit(0), 10000)"}
process.stdin.on('data', (data) => {
  buffer += data
  for (let at = buffer.indexOf('\\n'); at >= 0; at = buffer.indexOf('\\n')) {
    const message = JSON.parse(buffer.slice(0, at))
    buffer = buffer.slice(at + 1)
    if (message.method === 'account/login/cancel') {
      require('node:fs').writeFileSync(${JSON.stringify(marker)}, message.params.loginId)
      process.exit(0)
    }
    const answer = plan[message.method]
    if (answer === undefined || message.id === undefined) continue
    say({ id: message.id, ...answer })
    if (message.method === 'account/login/start') for (const later of plan.later ?? []) say(later)
  }
})
setInterval(() => {}, 1000)`

const codex = (plan: Readonly<Record<string, unknown>>, marker?: string): AgentDefinition => ({
  ...agents.codex,
  signIn: {
    ...agents.codex.signIn,
    inApp: { kind: 'codex-app-server', ways: ['browser', 'device'], run: () => ({ command: 'bun', args: ['-e', CODEX(plan, marker)] }) },
  },
})

/** A test whose stand-in closes its own end of a pipe while it runs, which Althar sees on a Mac and Linux only. */
const pipeClosed = it.skipIf(process.platform === 'win32')

const STARTED = { result: { loginId: 'l1', authUrl: 'https://auth.openai.com/oauth/authorize?x=1' } }
const SIGNED_IN = { method: 'account/login/completed', params: { loginId: 'l1', success: true } }

const claude = (run: () => LaunchSpec, status?: () => LaunchSpec): AgentDefinition => {
  const { status: _status, ...signIn } = agents['claude-code'].signIn
  return {
    ...agents['claude-code'],
    signIn: { ...signIn, ...(status === undefined ? {} : { status }), inApp: { kind: 'claude-login', ways: ['browser'], run } },
  }
}

const CLAUDE_STATUS = `console.log(JSON.stringify({ email: 'you@meridian.dev', subscriptionType: 'pro' }))`

/** Runs a sign-in, collecting what it says, until it ends; `then` acts on what it said so far. */
const run = (
  agent: AgentDefinition,
  options: SignInFlowOptions,
  then: (said: ReadonlyArray<SignInFlowEvent>, handle: SignInFlowHandle) => void = () => {},
) =>
  new Promise<{ readonly said: ReadonlyArray<SignInFlowEvent>; readonly handle: SignInFlowHandle | null }>((resolve) => {
    const said: SignInFlowEvent[] = []
    const handle: SignInFlowHandle | null = startSignInFlow(
      agent,
      (event) => {
        said.push(event)
        if (handle !== null) then(said, handle)
        if (event.kind === 'done' || event.kind === 'failed') resolve({ said, handle })
      },
      options,
    )
    if (handle === null) resolve({ said, handle })
  })

const folders: Array<string> = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

describe('signing in inside Althar, when it goes otherwise', () => {
  it('says Codex’s own words when it refuses to start, and that it refused where it gives none', async () => {
    const worded = await run(codex({ initialize: { error: { code: -32600, message: 'Unsupported client' } } }), { way: 'browser' })
    expect(worded.said).toEqual([{ kind: 'failed', message: 'Unsupported client' }])
    const wordless = await run(codex({ initialize: { error: { code: -32600 } } }), { way: 'browser' })
    expect(wordless.said).toEqual([{ kind: 'failed', message: 'Codex refused.' }])
  })

  it('says why Codex didn’t start signing in: its words, nothing at all, or no way to sign in', async () => {
    const initialize = { result: {} }
    const refused = await run(codex({ initialize, 'account/login/start': { error: { message: 'Sign-in is turned off' } } }), {
      way: 'browser',
    })
    expect(refused.said).toEqual([{ kind: 'failed', message: 'Sign-in is turned off' }])
    const silent = await run(codex({ initialize, 'account/login/start': { result: null } }), { way: 'browser' })
    expect(silent.said).toEqual([{ kind: 'failed', message: 'Codex didn’t start signing in.' }])
    const wayless = await run(codex({ initialize, 'account/login/start': { result: { loginId: 7, type: 'chatgpt' } } }), { way: 'device' })
    expect(wayless.said).toEqual([{ kind: 'failed', message: 'Codex didn’t say how to sign in.' }])
  })

  it('minds only Codex’s word that its sign-in ended, and says it didn’t finish where Codex gives no reason', async () => {
    const { said } = await run(
      codex({
        initialize: { result: {} },
        'account/login/start': STARTED,
        later: [
          { method: 'account/updated', params: { authMode: 'chatgpt' } },
          { method: 'account/login/completed' },
          { method: 'account/login/completed', params: { loginId: 'l1', success: false } },
        ],
      }),
      { way: 'browser' },
    )
    expect(said).toEqual([
      { kind: 'browser', link: 'https://auth.openai.com/oauth/authorize?x=1', paste: false },
      { kind: 'failed', message: 'Codex didn’t finish signing in.' },
    ])
  })

  it('signs in as no one in particular where Codex’s account says nothing of who or what plan', async () => {
    const { said, handle } = await run(
      codex({ initialize: { result: {} }, 'account/login/start': STARTED, later: [SIGNED_IN], 'account/read': { result: {} } }),
      { way: 'browser' },
    )
    expect(said.at(-1)).toEqual({ kind: 'done', who: null, plan: null })
    // Over, a cancel does nothing more.
    handle?.cancel()
    expect(said).toHaveLength(2)
  })

  it('tells Codex to stop the sign-in it started when cancelled, and says nothing more', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'althar-sign-in-'))
    folders.push(folder)
    const marker = join(folder, 'cancelled')
    const said: SignInFlowEvent[] = []
    const agent = codex(
      {
        initialize: { result: {} },
        'account/login/start': {
          result: { loginId: 'l1', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'LNBY-V0Q5J' },
        },
      },
      marker,
    )
    await new Promise<void>((resolve) => {
      const handle = startSignInFlow(
        agent,
        (event) => {
          said.push(event)
          if (event.kind === 'device') {
            handle?.cancel()
            resolve()
          }
        },
        { way: 'device' },
      )
    })
    // What the fake was told to stop, once it has written it: the file is there a moment before what is in it.
    expect(await waitFor(() => (existsSync(marker) ? readFileSync(marker, 'utf8') : ''))).toBe('l1')
    expect(said.map((event) => event.kind)).toEqual(['device'])
  })

  it('says what Claude Code last printed when its login stops, or that it stopped where it printed nothing', async () => {
    const printed = await run(
      claude(() => ({ command: 'bun', args: ['-e', `process.stdout.write('Opening browser to sign in…\\n\\n'); process.exit(1)`] })),
      { way: 'browser' },
    )
    expect(printed.said.at(-1)).toEqual({ kind: 'failed', message: 'Opening browser to sign in…' })
    const quiet = await run(
      claude(() => ({ command: 'bun', args: ['-e', 'process.exit(1)'] })),
      { way: 'browser' },
    )
    expect(quiet.said.at(-1)).toEqual({ kind: 'failed', message: 'Claude Code stopped signing in.' })
  })

  it('signs Claude Code in as no one in particular where it has no status to ask', async () => {
    const { said } = await run(
      claude(() => ({ command: 'bun', args: ['-e', 'process.exit(0)'] })),
      { way: 'browser' },
    )
    expect(said).toEqual([
      { kind: 'browser', link: null, paste: false },
      { kind: 'done', who: null, plan: null },
    ])
  })

  it('runs a login and its status out on the device, with the environment it assembled and the account’s home', async () => {
    const seen: Array<Readonly<Record<string, string | undefined>>> = []
    const onDevice = (args: ReadonlyArray<string>) => (at: { readonly env: Readonly<Record<string, string | undefined>> }) => {
      seen.push(at.env)
      return { command: 'bun', args }
    }
    const agent = claude(
      () => ({ command: 'flatpak-spawn-missing', args: [], onDevice: onDevice(['-e', 'process.exit(0)']) }),
      () => ({ command: 'flatpak-spawn-missing', args: [], onDevice: onDevice(['-e', CLAUDE_STATUS]) }),
    )
    const { said } = await run(agent, { way: 'browser', home: { CLAUDE_CONFIG_DIR: '/accounts/work/.claude' } })
    expect(said.at(-1)).toEqual({ kind: 'done', who: 'you@meridian.dev', plan: 'Claude Pro' })
    expect(seen.map((env) => env.CLAUDE_CONFIG_DIR)).toEqual(['/accounts/work/.claude', '/accounts/work/.claude'])
  })

  it('opens no page and says nothing for one the agent prints after a cancel, while it has a moment to stop', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'althar-sign-in-'))
    folders.push(folder)
    const asked = join(folder, 'asked')
    const printed = join(folder, 'printed')
    const server = `
const fs = require('node:fs')
let buffer = ''
const say = (message) => process.stdout.write(JSON.stringify(message) + '\\n')
process.stdin.on('data', (data) => {
  buffer += data
  for (let at = buffer.indexOf('\\n'); at >= 0; at = buffer.indexOf('\\n')) {
    const message = JSON.parse(buffer.slice(0, at))
    buffer = buffer.slice(at + 1)
    if (message.method === 'initialize') say({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1 } })
    if (message.method === 'authenticate') {
      fs.writeFileSync(${JSON.stringify(asked)}, '')
      setTimeout(() => {
        process.stderr.write('Open the following link to authenticate the ACP server: https://accounts.google.com/o/oauth2/v2/auth?state=s3\\n')
        fs.writeFileSync(${JSON.stringify(printed)}, '')
      }, 200)
    }
  }
})
setInterval(() => {}, 1000)`
    const agent: AgentDefinition = {
      ...agents.antigravity,
      signIn: {
        ...agents.antigravity.signIn,
        inApp: {
          kind: 'acp-authenticate',
          ways: ['browser'],
          run: () => ({ command: 'node', args: ['-e', server] }),
          method: 'oauth-personal',
          link: /Open the following link to authenticate the ACP server:\s*(\S+)/,
        },
      },
    }
    const until = (path: string) => waitFor(() => existsSync(path))
    const opened: string[] = []
    const said: SignInFlowEvent[] = []
    const handle = startSignInFlow(agent, (event) => void said.push(event), { way: 'browser', openUrl: (url) => void opened.push(url) })
    // Cancelled while it authenticates, it prints its page after, before it is killed.
    await until(asked)
    handle?.cancel()
    await until(printed)
    expect(existsSync(printed)).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(opened).toEqual([])
    expect(said).toEqual([])
  })

  // Not on Windows: there a Node stand-in closing its own end of a pipe (fd 2) doesn't close it for Althar while it
  // runs, as the Windows checks on #342 showed, so the stream never ends before the answer; the code is the same there.
  pipeClosed('opens the page an ACP agent printed on a last line it never ended, once that stream closes', async () => {
    const server = `
const fs = require('node:fs')
let buffer = ''
const say = (message) => process.stdout.write(JSON.stringify(message) + '\\n')
process.stdin.on('data', (data) => {
  buffer += data
  for (let at = buffer.indexOf('\\n'); at >= 0; at = buffer.indexOf('\\n')) {
    const message = JSON.parse(buffer.slice(0, at))
    buffer = buffer.slice(at + 1)
    if (message.method === 'initialize') say({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1 } })
    if (message.method === 'authenticate') {
      fs.writeSync(2, 'Open the following link to authenticate the ACP server: https://accounts.google.com/o/oauth2/v2/auth?state=s2')
      fs.closeSync(2)
      setTimeout(() => say({ jsonrpc: '2.0', id: message.id, result: {} }), 100)
    }
  }
})
setInterval(() => {}, 1000)`
    const agent: AgentDefinition = {
      ...agents.antigravity,
      signIn: {
        ...agents.antigravity.signIn,
        inApp: {
          kind: 'acp-authenticate',
          ways: ['browser'],
          run: () => ({ command: 'node', args: ['-e', server] }),
          method: 'oauth-personal',
          link: /Open the following link to authenticate the ACP server:\s*(\S+)/,
        },
      },
    }
    const opened: string[] = []
    const { said } = await run(agent, { way: 'browser', openUrl: (url) => void opened.push(url) })
    expect(opened).toEqual(['https://accounts.google.com/o/oauth2/v2/auth?state=s2'])
    expect(said).toEqual([
      { kind: 'browser', link: 'https://accounts.google.com/o/oauth2/v2/auth?state=s2', paste: false },
      { kind: 'done', who: null, plan: null },
    ])
  })
})
