import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AgentDefinition } from '@althar/provider-adapters'
import { fakeAgent } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { until } from '@althar/testing/effect'

import { Accounts } from '../src/Accounts'
import { AccountSignIns } from '../src/AccountSignIns'
import { type AgentEntry, Agents } from '../src/Config'
import * as Runtime from '../src/Runtime'
import { Secrets } from '../src/Secrets'
import { definition, fakeConnectors } from './support'

/*
 * Signing an account in inside Althar where nothing opens a browser for it,
 * as the command-line client has it: the window shows the page to open, or
 * the code to type. A stand-in for Codex's app-server answers as the real
 * one does, so nothing signs in.
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
    if (message.method === 'account/login/start')
      say({ id: message.id, result: message.params.type === 'chatgpt'
        ? { loginId: 'l1', authUrl: 'https://auth.openai.com/oauth/authorize?x=1' }
        : { loginId: 'l1', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'LNBY-V0Q5J' } })
  }
})`

const codex = (): AgentDefinition => {
  const base = definition('codex')
  return {
    ...base,
    signIn: {
      ...base.signIn,
      inApp: { kind: 'codex-app-server', ways: ['browser', 'device'], run: () => ({ command: 'bun', args: ['-e', SERVER] }) },
    },
  }
}

/** The runtime with no way to open a page: nothing is given to open one with. */
const layer = Runtime.layer({
  database: ':memory:',
  worktreeRoot: mkdtempSync(join(tmpdir(), 'althar-worktrees-')),
  accountsRoot: mkdtempSync(join(tmpdir(), 'althar-accounts-')),
  appVersion: '0.0.0-test',
  deviceName: 'Test Mac',
  agents: Layer.succeed(
    Agents,
    Agents.from([{ definition: codex(), transport: () => ({ _tag: 'InProcess', agent: fakeAgent({}) }) } satisfies AgentEntry]),
  ),
  secrets: Secrets.memory(),
  connectors: fakeConnectors({}),
})

describe('signing in where nothing opens a browser', () => {
  it.live('shows the page to open, for the person to open it', () =>
    Effect.gen(function* () {
      const accounts = yield* Accounts
      const signIns = yield* AccountSignIns
      const [usual] = yield* accounts.of('codex')
      const { flowId } = yield* signIns.start({ accountId: usual?.id ?? '', way: 'browser' })
      assert.deepStrictEqual(yield* until(signIns.get(flowId), (state) => state.state === 'browser'), {
        state: 'browser',
        link: 'https://auth.openai.com/oauth/authorize?x=1',
        paste: false,
        refused: null,
      })
      yield* signIns.cancel(flowId)
    }).pipe(Effect.provide(layer)),
  )

  it.live('keeps the code to type as it is when one is pasted, and leaving one that was never started does nothing', () =>
    Effect.gen(function* () {
      const accounts = yield* Accounts
      const signIns = yield* AccountSignIns
      const [usual] = yield* accounts.of('codex')
      const { flowId } = yield* signIns.start({ accountId: usual?.id ?? '', way: 'device' })
      const device = yield* until(signIns.get(flowId), (state) => state.state === 'device')
      // A code pasted into a sign-in by a one-time code goes to the agent; what the window shows stays.
      yield* signIns.paste(flowId, 'LNBY-V0Q5J')
      assert.deepStrictEqual(yield* signIns.get(flowId), device)
      yield* signIns.cancel('signin_never')
      assert.deepStrictEqual(yield* signIns.get(flowId), device)
      yield* signIns.cancel(flowId)
      assert.deepStrictEqual(yield* signIns.get(flowId), { state: 'failed', message: 'This sign-in was left.' })
    }).pipe(Effect.provide(layer)),
  )
})
