import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AgentDefinition } from '@althar/provider-adapters'
import { fakeAgent } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer, Schedule } from 'effect'

import { Accounts } from '../src/Accounts'
import { AccountSignIns, type AccountSignInState } from '../src/AccountSignIns'
import { type AgentEntry, Agents } from '../src/Config'
import * as Runtime from '../src/Runtime'
import { Secrets } from '../src/Secrets'
import { definition, fakeConnectors } from './support'

/*
 * Signing accounts of two agents in inside Althar at once: one agent's
 * sign-in doesn't stop another's. Stand-ins for Codex's app-server and
 * Claude Code's login answer as the real ones do, so nothing signs in and no
 * browser opens.
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

describe('signing accounts of two agents in inside Althar', () => {
  it.live('leaves one agent’s sign-in under way while another’s starts', () => {
    const opened: string[] = []
    return Effect.gen(function* () {
      const accounts = yield* Accounts
      const signIns = yield* AccountSignIns
      const [codex] = yield* accounts.of('codex')
      const [claude] = yield* accounts.of('claude-code')
      if (codex === undefined || claude === undefined) return assert.fail('Each agent has its usual account')
      const first = yield* signIns.start({ accountId: codex.id, way: 'device' })
      assert.strictEqual((yield* until(signIns.get(first.flowId), settled)).state, 'device')
      const second = yield* signIns.start({ accountId: claude.id, way: 'browser' })
      assert.strictEqual((yield* until(signIns.get(second.flowId), settled)).state, 'browser')
      // Codex's still waits for its code.
      assert.strictEqual((yield* signIns.get(first.flowId)).state, 'device')
      yield* signIns.cancel(first.flowId)
      yield* signIns.cancel(second.flowId)
    }).pipe(Effect.provide(layer(false, opened, claudeSigningIn())))
  })
})
