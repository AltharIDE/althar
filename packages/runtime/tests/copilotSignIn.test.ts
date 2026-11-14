import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { until } from '@althar/testing/effect'
import { describe, expect, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { SqlClient } from 'effect/sql'

import { Accounts } from '../src/Accounts'
import { AccountSignIns, NoSignInHere } from '../src/AccountSignIns'
import { Agents } from '../src/Config'
import * as Runtime from '../src/Runtime'
import { Secrets } from '../src/Secrets'
import { SignIns } from '../src/SignIns'
import { Sessions } from '../src/Sessions'
import { Policies } from '../src/Policies'
import { Instance } from '../src/Instance'
import { fakeConnectors, items, onTestClock, task, turns } from './support'

const fixture = (withCommand = false) => {
  const root = mkdtempSync(join(tmpdir(), 'althar-copilot-'))
  const kept = new Map<string, string>()
  const opened: string[] = []
  const calls: string[] = []
  const prompted = new Set<string>()
  const layer = Runtime.layer({
    database: ':memory:',
    appVersion: '0.0.0-test',
    deviceName: 'Test computer',
    worktreeRoot: join(root, 'worktrees'),
    accountsRoot: join(root, 'accounts'),
    copilotClientId: 'althar-test-app',
    openUrl: (url) =>
      Effect.sync(() => {
        opened.push(url)
        return true
      }),
    fetch: async (url) => {
      calls.push(url)
      if (url.endsWith('/login/device/code'))
        return Response.json({
          device_code: 'test-device',
          user_code: 'ABCD-1234',
          verification_uri: `https://${new URL(url).hostname}/login/device`,
          expires_in: 900,
          interval: 1,
        })
      if (url.endsWith('/login/oauth/access_token')) return Response.json({ access_token: 'test-token', scope: 'read:user' })
      if (url.endsWith('/copilot_internal/user')) return Response.json({ chat_enabled: true })
      if (url.endsWith('/models'))
        return Response.json({
          data: [
            {
              id: 'model',
              name: 'Model',
              capabilities: { supports: { tool_calls: true }, limits: { max_prompt_tokens: 128_000, max_output_tokens: 4096 } },
            },
          ],
        })
      throw new Error(`Unexpected test URL: ${url}`)
    },
    agents: Layer.succeed(
      Agents,
      Agents.from(
        Agents.fromRegistry(undefined, undefined, () => ({
          models: async () => [{ id: 'model', name: 'Model', context: 128_000, output: 4096, images: true }],
          complete: async (request) => {
            if (withCommand && !prompted.has(request.sessionId)) {
              prompted.add(request.sessionId)
              return { text: '', tools: [{ id: 'native-command', name: 'run_command', input: { command: 'echo native-command' } }] }
            }
            return { text: 'Ready', tools: [] }
          },
        })).list.filter((entry) => entry.definition.id === 'copilot-direct'),
      ),
    ),
    secrets: Secrets.memory(kept),
    connectors: fakeConnectors({}),
  })
  return { layer, kept, opened, calls, root }
}

describe('native Copilot sign-in in the runtime', () => {
  it.effect('has no external default account and leaves none behind after removal', () => {
    const { layer } = fixture()
    return Effect.gen(function* () {
      const accounts = yield* Accounts
      expect(yield* accounts.of('copilot-direct')).toEqual([])
      expect(yield* (yield* SignIns).of('copilot-direct')).toBe('signed_out')
      const account = yield* accounts.add({ agentId: 'copilot-direct', name: 'Personal' })
      yield* accounts.remove(account.id)
      expect(yield* accounts.of('copilot-direct')).toEqual([])
    }).pipe(Effect.provide(layer))
  })

  it.effect('keeps the retired engine account’s identity while making it removable, without adopting its credentials', () => {
    const { layer, root, kept } = fixture()
    return Effect.gen(function* () {
      const accounts = yield* Accounts
      const account = yield* accounts.add({ agentId: 'copilot-direct', name: 'Existing work account' })
      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE agent_accounts SET home = NULL WHERE id = ${account.id}`
      const [migrated] = yield* accounts.of('copilot-direct')
      expect(migrated).toMatchObject({
        id: account.id,
        name: 'Existing work account',
        home: join(root, 'accounts', 'copilot-direct-usual'),
      })
      expect(kept.size).toBe(0)
      expect(yield* (yield* SignIns).of('copilot-direct')).toBe('signed_out')
      yield* accounts.remove(account.id)
      expect(yield* accounts.of('copilot-direct')).toEqual([])
    }).pipe(Effect.provide(layer))
  })
  it.effect('runs a task through Althar’s native transport and session supervisor', () => {
    const { layer } = fixture(true)
    return Effect.gen(function* () {
      const account = yield* (yield* Accounts).add({ agentId: 'copilot-direct', name: 'Work' })
      const signing = yield* AccountSignIns
      const { flowId } = yield* signing.start({ accountId: account.id, way: 'browser' })
      yield* until(signing.get(flowId), (state) => state.state === 'device')
      yield* TestClock.adjust(Duration.seconds(1))
      yield* until(signing.get(flowId), (state) => state.state === 'done')
      const { task: created, project } = yield* task('Check the native Copilot connection')
      yield* (yield* Policies).set(project.projectId, { allowEverything: true }, (yield* Instance).personId)
      yield* (yield* Sessions).start({ threadId: created.threadId, agentId: 'copilot-direct' })
      yield* until(turns(created.threadId), (all) => all.some((turn) => turn.state === 'completed'))
      expect((yield* items(created.threadId)).some((item) => item.kind === 'agent_message' && item.content.text === 'Ready')).toBe(true)
      const sql = yield* SqlClient.SqlClient
      const processes = yield* sql<{ state: string; pid: number | null; purpose: string }>`
        SELECT p.state, p.pid, p.purpose FROM processes p JOIN provider_sessions s ON s.id = p.provider_session_id
        WHERE s.thread_id = ${created.threadId}`
      expect(processes).toHaveLength(1)
      expect(processes[0]).toMatchObject({ state: 'exited', purpose: 'other' })
      expect(processes[0]?.pid).toBeGreaterThan(0)
    }).pipe(Effect.provide(layer), onTestClock)
  })
  it.effect('owns the device flow and stores the selected account securely without an external engine', () => {
    const { layer, kept, opened } = fixture()
    return Effect.gen(function* () {
      const accounts = yield* Accounts
      const account = yield* accounts.add({ agentId: 'copilot-direct', name: 'Work' })
      expect(accounts.env(account)).toEqual({ ALTHAR_COPILOT_ACCOUNT: account.id })
      const signIns = yield* AccountSignIns
      const { flowId } = yield* signIns.start({ accountId: account.id, way: 'browser' })
      expect(yield* until(signIns.get(flowId), (state) => state.state === 'device')).toMatchObject({
        state: 'device',
        code: 'ABCD-1234',
        page: 'https://github.com/login/device',
      })
      yield* TestClock.adjust(Duration.seconds(1))
      expect(yield* until(signIns.get(flowId), (state) => state.state === 'done')).toMatchObject({
        state: 'done',
        plan: 'Copilot subscription',
      })
      expect(opened).toEqual(['https://github.com/login/device'])
      expect((yield* (yield* SignIns).account(account, true)).status).toBe('signed_in')
      expect(kept.has(`copilot-${account.id}`)).toBe(true)
      yield* accounts.remove(account.id)
      expect(kept.has(`copilot-${account.id}`)).toBe(false)
    }).pipe(Effect.provide(layer), onTestClock)
  })

  it.effect('validates the enterprise address and cancels the selected flow without keeping credentials', () => {
    const { layer, kept, calls, opened } = fixture()
    return Effect.gen(function* () {
      const account = yield* (yield* Accounts).add({ agentId: 'copilot-direct', name: 'Work' })
      const signIns = yield* AccountSignIns
      expect(yield* Effect.flip(signIns.start({ accountId: account.id, way: 'browser', host: 'http://wrong.example' }))).toBeInstanceOf(
        NoSignInHere,
      )
      const { flowId } = yield* signIns.start({ accountId: account.id, way: 'browser', host: 'https://Company.GHE.com/' })
      expect(yield* until(signIns.get(flowId), (state) => state.state === 'device')).toMatchObject({
        page: 'https://company.ghe.com/login/device',
      })
      yield* signIns.cancel(flowId)
      yield* TestClock.adjust(Duration.seconds(5))
      expect(yield* signIns.get(flowId)).toMatchObject({ state: 'failed' })
      expect(opened).toEqual(['https://company.ghe.com/login/device'])
      expect(calls.some((url) => url.endsWith('/login/oauth/access_token'))).toBe(false)
      expect(kept.size).toBe(0)
    }).pipe(Effect.provide(layer), onTestClock)
  })
})
