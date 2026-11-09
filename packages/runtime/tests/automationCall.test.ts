import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import { Api, type AutomationDefinition, clientProtocol, emitterPort } from '@althar/contracts'
import type { ProjectId } from '@althar/domain'
import { until } from '@althar/testing/effect'
import { assert, describe, it } from '@effect/vitest'
import { Clock, Duration, Effect, Layer } from 'effect'
import { RpcClient } from 'effect/rpc'
import { SqlClient } from 'effect/sql'

import { connection, services } from '../src/Api'
import { Accounts } from '../src/Accounts'
import { Automations } from '../src/Automations'
import type { AutomationOptions } from '../src/Config'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { Secrets } from '../src/Secrets'
import { SignIns } from '../src/SignIns'

import { fakeAgents, fakeConnectors, repository, ROOMY } from './support'

/*
 * The call in Needs you that two skipped runs in a row make (docs/plans/automations.md), answered from the window: "Run it
 * now" runs the automation and takes the call back once a run is under way, and says why where it still can't; "Leave it"
 * closes it, and a call already closed starts nothing.
 */

const commandId = () => `cmd_${randomBytes(16).toString('hex')}`

const NOTES: AutomationDefinition = {
  name: 'Release notes',
  prompt: 'Write release notes from what merged this week. [lead:finish] [lead:terse]',
  schedule: { every: 'week', days: [1, 2, 3, 4, 5], at: '09:00' },
  zone: 'Europe/London',
  lead: { agentId: 'codex', model: null },
  work: { kind: 'task', review: null, end: null },
  allowEverything: true,
  minutes: 45,
  late: 'once',
}

/** The test's clock, put forward to where it sets it, which the runtime reads. */
const clockAt = (iso: string) => {
  let ahead = Date.parse(iso) - Date.now()
  const now = () => Date.now() + ahead
  const layer = Layer.effect(
    Clock.Clock,
    Clock.clockWith((live) =>
      Effect.succeed<Clock.Clock>({
        currentTimeMillisUnsafe: now,
        currentTimeMillis: Effect.sync(now),
        currentTimeNanosUnsafe: () => BigInt(now()) * 1_000_000n,
        currentTimeNanos: Effect.sync(() => BigInt(now()) * 1_000_000n),
        monotonicTimeNanosUnsafe: () => live.monotonicTimeNanosUnsafe(),
        monotonicTimeNanos: live.monotonicTimeNanos,
        sleep: (duration) => live.sleep(duration),
      }),
    ),
  )
  const options: AutomationOptions = { zone: () => 'Europe/London', tick: Duration.millis(100), settle: Duration.zero, stagger: false }
  return { options, set: (to: string) => void (ahead = Date.parse(to) - Date.now()), layer }
}

/** The runtime with every agent signed out, the window connected to it, and a function that signs `codex` in again. */
const connected = (clock: ReturnType<typeof clockAt>, signedOut: Array<string>) =>
  Effect.gen(function* () {
    const channel = new MessageChannel()
    yield* Effect.addFinalizer(() => Effect.sync(() => channel.port1.close()))
    const context = yield* Layer.build(
      services({
        database: ':memory:',
        worktreeRoot: mkdtempSync(join(tmpdir(), 'althar-worktrees-')),
        appVersion: '0.0.0-test',
        deviceName: 'Test Mac',
        agents: fakeAgents({}, signedOut),
        secrets: Secrets.memory(),
        connectors: fakeConnectors({}),
        accountsRoot: mkdtempSync(join(tmpdir(), 'althar-accounts-')),
        agentsRoot: mkdtempSync(join(tmpdir(), 'althar-agents-')),
        busy: { machine: ROOMY },
        checksAppear: Duration.zero,
        automations: clock.options,
      }).pipe(Layer.provideMerge(clock.layer)),
    )
    yield* Effect.forkScoped(
      Layer.launch(
        connection(
          emitterPort(channel.port1, (data) => data),
          { kind: 'window' },
        ),
      ).pipe(Effect.provideContext(context)),
    )
    const protocol = yield* Layer.build(clientProtocol(emitterPort(channel.port2, (data) => data)))
    const client = yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
    return { client, context }
  })

describe('the call two skipped runs make', () => {
  const skippedTwice = (signedOut: Array<string>) =>
    Effect.gen(function* () {
      const clock = clockAt('2026-10-21T07:59:00Z')
      const { client, context } = yield* connected(clock, signedOut)
      const there = <A, E>(effect: Effect.Effect<A, E, any>) => Effect.provideContext(effect, context) as Effect.Effect<A, E>
      const projectId = yield* there(
        Effect.gen(function* () {
          const projects = yield* Projects
          return (yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() }))
            .projectId as ProjectId
        }),
      )
      const automationId = yield* there(
        Effect.gen(function* () {
          const instance = yield* Instance
          return yield* (yield* Automations).make({ projectId, definition: NOTES, on: true, actorId: instance.personId })
        }),
      )
      const rows = () =>
        there(
          Effect.flatMap(
            SqlClient.SqlClient,
            (sql) => sql<{ state: string; reason: string | null }>`
              SELECT state, reason FROM automation_occurrences WHERE automation_id = ${automationId} ORDER BY fired_at, rowid`,
          ),
        )
      const call = () =>
        there(
          Effect.flatMap(
            SqlClient.SqlClient,
            (sql) => sql<{ id: string; state: string }>`
              SELECT id, state FROM attention_requests WHERE kind = 'question' AND json_extract(payload, '$.automationId') = ${automationId}`,
          ),
        )
      clock.set('2026-10-21T08:00:05Z')
      yield* until(rows(), (all) => all.length === 1)
      clock.set('2026-10-22T08:00:05Z')
      yield* until(rows(), (all) => all.length === 2)
      const [asked] = yield* call()
      assert.strictEqual(asked?.state, 'open')
      return { client, there, rows, call, asked: asked!.id }
    })

  const answer = (client: Effect.Success<ReturnType<typeof connected>>['client'], attentionId: string, value: string) =>
    client.AnswerQuestion({ commandId: commandId(), attentionId, answers: { next: { values: [value] } } })

  it.live('"Leave it" closes it, and a later "Run it now" on it starts nothing', () =>
    Effect.gen(function* () {
      const { client, rows, call, asked } = yield* skippedTwice(['claude-code', 'codex', 'opencode'])
      yield* answer(client, asked, 'leave')
      assert.deepStrictEqual(
        (yield* call()).map((one) => one.state),
        ['answered'],
      )
      yield* Effect.ignore(answer(client, asked, 'run'))
      assert.lengthOf(yield* rows(), 2)
    }).pipe(Effect.scoped),
  )

  it.live('"Run it now" once an agent is signed in again runs it, and takes the call back', () => {
    const signedOut = ['claude-code', 'codex', 'opencode']
    return Effect.gen(function* () {
      const { client, there, rows, call, asked } = yield* skippedTwice(signedOut)
      // Signed in again, and looked at again, as Settings does when the person has.
      signedOut.splice(0)
      yield* there(
        Effect.gen(function* () {
          const signIns = yield* SignIns
          for (const agentId of ['claude-code', 'codex', 'opencode'])
            for (const account of yield* (yield* Accounts).of(agentId)) yield* signIns.account(account, true)
        }),
      )
      yield* answer(client, asked, 'run')
      const all = yield* until(rows(), (found) => found.length === 3 && found[2]?.state === 'made')
      assert.strictEqual(all[2]?.state, 'made')
      assert.deepStrictEqual(
        (yield* call()).map((one) => one.state),
        ['withdrawn'],
      )
    }).pipe(Effect.scoped)
  })

  it.live('"Run it now" where nothing could run says why, and the call stays open', () =>
    Effect.gen(function* () {
      const { client, rows, call, asked } = yield* skippedTwice(['claude-code', 'codex', 'opencode'])
      const refused = yield* Effect.flip(answer(client, asked, 'run'))
      assert.match(JSON.stringify(refused), /Fake codex is signed out, and no other plan had room\. Sign in to Fake codex in Settings\./)
      assert.deepStrictEqual(
        (yield* call()).map((one) => one.state),
        ['open'],
      )
      assert.lengthOf(yield* rows(), 2)
    }).pipe(Effect.scoped),
  )
})
