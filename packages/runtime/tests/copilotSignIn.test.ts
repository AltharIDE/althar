import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { agents, type AgentDefinition } from '@althar/provider-adapters'
import { fakeAgent } from '@althar/provider-adapters/testing'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { until } from '@althar/testing/effect'

import { Accounts } from '../src/Accounts'
import { AccountSignIns, NoSignInHere } from '../src/AccountSignIns'
import { Agents } from '../src/Config'
import * as Runtime from '../src/Runtime'
import { Secrets } from '../src/Secrets'
import { fakeConnectors } from './support'

const fixture = (finish = false, connected = false) => {
  const root = mkdtempSync(join(tmpdir(), 'althar-copilot-'))
  const hosts: Array<string | undefined> = []
  const native = agents['copilot-direct']
  const definition: AgentDefinition = {
    ...native,
    home: { ...native.home, usual: () => join(root, 'unused-engine-home') },
    signIn: {
      ...native.signIn,
      status: () => ({
        command: process.execPath,
        args: ['-e', `console.log(${JSON.stringify(connected ? '[{"id":"github-copilot","connections":[{"method":"device"}]}]' : '[]')})`],
      }),
      inApp: {
        kind: 'opencode-copilot',
        ways: ['browser'],
        run: (_node, host) => {
          hosts.push(host)
          return {
            command: process.execPath,
            args: [
              '-e',
              `console.log('Enter code: ABCD-1234'); console.log('https://${host ?? 'github.com'}/login/device'); ${finish ? '' : 'process.stdin.resume()'}`,
            ],
          }
        },
      },
    },
  }
  const layer = Runtime.layer({
    database: ':memory:',
    appVersion: '0.0.0-test',
    deviceName: 'Test computer',
    worktreeRoot: join(root, 'worktrees'),
    accountsRoot: join(root, 'accounts'),
    agents: Layer.succeed(Agents, Agents.from([{ definition, transport: () => ({ _tag: 'InProcess', agent: fakeAgent({}) }) }])),
    secrets: Secrets.memory(),
    connectors: fakeConnectors({}),
  })
  return { root, hosts, layer }
}

describe('the native Copilot account', () => {
  it.live.each([true, false])('confirms Copilot access after OAuth completes (connected: %s)', (connected) => {
    const { layer } = fixture(true, connected)
    return Effect.gen(function* () {
      const [usual] = yield* (yield* Accounts).of('copilot-direct')
      if (usual === undefined) throw new Error('Missing usual account')
      const signIns = yield* AccountSignIns
      const { flowId } = yield* signIns.start({ accountId: usual.id, way: 'browser' })
      const result = yield* until(signIns.get(flowId), (state) => state.state === 'done' || state.state === 'failed')
      expect(result.state).toBe(connected ? 'done' : 'failed')
    }).pipe(Effect.provide(layer))
  })

  it.live('keeps its usual and additional accounts separate from the person’s OpenCode accounts', () => {
    const { root, layer } = fixture()
    return Effect.gen(function* () {
      const accounts = yield* Accounts
      const [usual] = yield* accounts.of('copilot-direct')
      if (usual === undefined) throw new Error('Missing usual account')
      const home = join(root, 'accounts', 'copilot-direct-usual')
      expect(accounts.env(usual)).toEqual({ XDG_DATA_HOME: home })
      yield* accounts.prepare(usual)
      expect(existsSync(home)).toBe(true)
      const work = yield* accounts.add({ agentId: 'copilot-direct', name: 'Work' })
      expect(accounts.env(work).XDG_DATA_HOME).not.toBe(home)
      expect(accounts.env(work).XDG_DATA_HOME).toBe(work.home)
    }).pipe(Effect.provide(layer))
  })

  it.live('validates an enterprise hostname before starting OAuth and cancels the correct flow', () => {
    const { hosts, layer } = fixture()
    return Effect.gen(function* () {
      const [usual] = yield* (yield* Accounts).of('copilot-direct')
      if (usual === undefined) throw new Error('Missing usual account')
      const signIns = yield* AccountSignIns
      const refused = yield* Effect.flip(signIns.start({ accountId: usual.id, way: 'browser', host: 'http://wrong.example' }))
      expect(refused).toBeInstanceOf(NoSignInHere)
      expect(hosts).toEqual([])
      const { flowId } = yield* signIns.start({ accountId: usual.id, way: 'browser', host: 'https://Company.GHE.com/' })
      const code = yield* until(signIns.get(flowId), (state) => state.state === 'device')
      expect(hosts).toEqual(['company.ghe.com'])
      expect(code).toMatchObject({ state: 'device', code: 'ABCD-1234', page: 'https://company.ghe.com/login/device' })
      yield* signIns.cancel(flowId)
      expect(yield* signIns.get(flowId)).toMatchObject({ state: 'failed' })
    }).pipe(Effect.provide(layer))
  })
})
