import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AgentDefinition } from '@althar/provider-adapters'
import { fakeAgent } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer, Schedule } from 'effect'

import { Accounts } from '../src/Accounts'
import { AccountSignIns, type AccountSignInState, NoSignInHere } from '../src/AccountSignIns'
import { type AgentEntry, Agents } from '../src/Config'
import * as Runtime from '../src/Runtime'
import { Secrets } from '../src/Secrets'
import { definition, fakeConnectors } from './support'

/*
 * Signing an account in inside Althar: the agent's own login, here a stand-in
 * for Codex's app-server that answers as the real one does, so nothing signs
 * in and no browser opens.
 */

const SERVER = `
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
        ? { loginId: 'l1', authUrl: 'https://auth.openai.com/oauth/authorize?x=1' }
        : { loginId: 'l1', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'LNBY-V0Q5J' } })
      if (process.env.FAKE_FINISH === '1') setTimeout(() => say({ method: 'account/login/completed', params: { loginId: 'l1', success: true } }), 50)
    }
    if (message.method === 'account/read') say({ id: message.id, result: { account: { email: 'dana@northwind.io', planType: 'team' } } })
  }
})`

/* Claude Code's login: a page to open, codes pasted on stdin, one refused, and then given up on. */
const CLAUDE = `
process.stdout.write('If the browser didn\\'t open, visit: https://claude.ai/oauth/authorize?x=1\\n')
process.stdin.on('data', (data) => {
  if (String(data).trim() === 'wrong') process.stderr.write('Invalid code. Try again.\\n')
  else {
    process.stderr.write('Login was not completed.\\n')
    process.exit(1)
  }
})`

const claudeSigningIn = (): AgentDefinition => {
  const base = definition('claude-code')
  return {
    ...base,
    signIn: { ...base.signIn, inApp: { kind: 'claude-login', ways: ['browser'], run: () => ({ command: 'bun', args: ['-e', CLAUDE] }) } },
  }
}

const signingIn = (finish: boolean): AgentDefinition => {
  const base = definition('codex')
  return {
    ...base,
    signIn: {
      ...base.signIn,
      inApp: {
        kind: 'codex-app-server',
        ways: ['browser', 'device'],
        run: () => ({ command: 'sh', args: ['-c', `FAKE_FINISH=${finish ? 1 : 0} exec bun -e "$0"`, SERVER] }),
      },
    },
  }
}

const layer = (finish: boolean, opened: string[], claude = definition('claude-code')) =>
  Runtime.layer({
    database: ':memory:',
    worktreeRoot: mkdtempSync(join(tmpdir(), 'althar-worktrees-')),
    accountsRoot: mkdtempSync(join(tmpdir(), 'althar-accounts-')),
    openUrl: (url) => Effect.sync(() => void opened.push(url)).pipe(Effect.as(true)),
    appVersion: '0.0.0-test',
    deviceName: 'Test Mac',
    agents: Layer.succeed(
      Agents,
      Agents.from(
        ['codex', 'claude-code'].map((agentId): AgentEntry => ({
          definition: agentId === 'codex' ? signingIn(finish) : claude,
          transport: () => ({ _tag: 'InProcess', agent: fakeAgent({}) }),
        })),
      ),
    ),
    secrets: Secrets.memory(),
    connectors: fakeConnectors({}),
  })

const settled = (state: AccountSignInState) => state.state !== 'starting'

/** Asks how a sign-in stands until it says what the test waits for. */
const until = (read: Effect.Effect<AccountSignInState>, done: (state: AccountSignInState) => boolean, within = Duration.seconds(5)) =>
  read.pipe(Effect.repeat({ until: done, schedule: Schedule.spaced(Duration.millis(20)) }), Effect.timeout(within))

describe('signing an account in inside Althar', () => {
  it.live('opens the page in the browser, says when it is done, and who signed in', () => {
    const opened: string[] = []
    return Effect.gen(function* () {
      const accounts = yield* Accounts
      const signIns = yield* AccountSignIns
      const [usual] = yield* accounts.of('codex')
      if (usual === undefined) return assert.fail('Codex has its usual account')
      const { flowId } = yield* signIns.start({ accountId: usual.id, way: 'browser' })
      const browser = yield* until(signIns.get(flowId), settled)
      assert.deepStrictEqual(browser, {
        state: 'browser',
        link: 'https://auth.openai.com/oauth/authorize?x=1',
        paste: false,
        refused: null,
      })
      assert.deepStrictEqual(opened, ['https://auth.openai.com/oauth/authorize?x=1'])
      const done = yield* until(signIns.get(flowId), (state) => state.state === 'done', Duration.seconds(10))
      assert.deepStrictEqual(done, { state: 'done', who: 'dana@northwind.io', plan: 'ChatGPT Team' })
    }).pipe(Effect.provide(layer(true, opened)))
  })

  it.live('gives a one-time code, signs an agent in one account at a time, and refuses a way it has none for', () => {
    const opened: string[] = []
    return Effect.gen(function* () {
      const accounts = yield* Accounts
      const signIns = yield* AccountSignIns
      const [usual] = yield* accounts.of('codex')
      if (usual === undefined) return assert.fail('Codex has its usual account')
      const first = yield* signIns.start({ accountId: usual.id, way: 'device' })
      const device = yield* until(signIns.get(first.flowId), settled)
      assert.strictEqual(device.state, 'device')
      if (device.state !== 'device') return
      assert.deepStrictEqual([device.code, device.page], ['LNBY-V0Q5J', 'https://auth.openai.com/codex/device'])
      assert.isTrue(new Date(device.expiresAt).getTime() > Date.now() + 14 * 60_000)
      // Another for the same agent stops the first; pasting into one that was left does nothing.
      const second = yield* signIns.start({ accountId: usual.id, way: 'browser' })
      assert.deepStrictEqual(yield* signIns.get(first.flowId), { state: 'failed', message: 'This sign-in was left.' })
      yield* signIns.paste(first.flowId, 'ignored')
      yield* until(signIns.get(second.flowId), settled)
      yield* signIns.paste(second.flowId, 'code')
      yield* signIns.cancel(second.flowId)
      assert.strictEqual((yield* signIns.get(second.flowId)).state, 'failed')
      // Claude Code here has no sign-in of its own that Althar runs.
      const [claude] = yield* accounts.of('claude-code')
      if (claude === undefined) return assert.fail('Claude Code has its usual account')
      assert.instanceOf(yield* Effect.flip(signIns.start({ accountId: claude.id, way: 'browser' })), NoSignInHere)
    }).pipe(Effect.provide(layer(false, opened)))
  })

  it.live('says when a pasted code is refused, takes another, and says why it failed', () =>
    Effect.gen(function* () {
      const accounts = yield* Accounts
      const signIns = yield* AccountSignIns
      const [usual] = yield* accounts.of('claude-code')
      if (usual === undefined) return assert.fail('Claude Code has its usual account')
      const { flowId } = yield* signIns.start({ accountId: usual.id, way: 'browser' })
      const browser = yield* until(signIns.get(flowId), (state) => state.state === 'browser' && state.link !== null)
      assert.deepStrictEqual(browser, { state: 'browser', link: 'https://claude.ai/oauth/authorize?x=1', paste: true, refused: null })
      yield* signIns.paste(flowId, 'wrong')
      const refused = yield* until(signIns.get(flowId), (state) => state.state === 'browser' && state.refused !== null)
      assert.deepStrictEqual(refused, {
        state: 'browser',
        link: 'https://claude.ai/oauth/authorize?x=1',
        paste: true,
        refused: 'Invalid code. Try again.',
      })
      // Another code clears it while it is tried.
      yield* signIns.paste(flowId, 'another')
      const failed = yield* until(signIns.get(flowId), (state) => state.state === 'failed')
      assert.deepStrictEqual(failed, { state: 'failed', message: 'Login was not completed.' })
    }).pipe(Effect.provide(layer(false, [], claudeSigningIn()))),
  )

  it.live('stops a sign-in still under way when the runtime stops', () => {
    const pidFile = join(mkdtempSync(join(tmpdir(), 'althar-signin-')), 'pid')
    const waiting = (): AgentDefinition => {
      const base = definition('claude-code')
      const script = `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`
      return {
        ...base,
        signIn: {
          ...base.signIn,
          inApp: { kind: 'claude-login', ways: ['browser'], run: () => ({ command: 'bun', args: ['-e', script] }) },
        },
      }
    }
    return Effect.gen(function* () {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const accounts = yield* Accounts
          const signIns = yield* AccountSignIns
          const [usual] = yield* accounts.of('claude-code')
          if (usual === undefined) return assert.fail('Claude Code has its usual account')
          yield* signIns.start({ accountId: usual.id, way: 'browser' })
          yield* Effect.promise(async () => {
            for (let tries = 0; tries < 100 && !existsSync(pidFile); tries++) await new Promise((r) => setTimeout(r, 20))
          })
        }).pipe(Effect.provide(layer(false, [], waiting()))),
      )
      const pid = Number(readFileSync(pidFile, 'utf8'))
      // Gone with the runtime: asking after it finds nothing.
      yield* Effect.promise(async () => {
        for (let tries = 0; tries < 100; tries++) {
          try {
            process.kill(pid, 0)
          } catch {
            return
          }
          await new Promise((r) => setTimeout(r, 20))
        }
      })
      assert.throws(() => process.kill(pid, 0))
    })
  })
})
