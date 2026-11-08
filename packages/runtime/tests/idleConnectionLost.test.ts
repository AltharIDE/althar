import type { ProjectId } from '@althar/domain'
import { type FakeAgentOptions, holds, scenarios } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { addItem } from '../src/threads'
import { items, runtime, task, turns, until } from './support'

const fixture = () => {
  const controls: Array<Parameters<NonNullable<FakeAgentOptions['sessionControls']>>[0]> = []
  const held = holds()
  const layer = Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', { holds: held, sessionControls: (one) => controls.push(one) })))
  return { controls, held, layer }
}

const sessionState = (sessionId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ state: string }>`SELECT state FROM provider_sessions WHERE id = ${sessionId}`
  })

const begin = Effect.gen(function* () {
  const { project, task: created } = yield* task()
  const sessions = yield* Sessions
  const sessionId = yield* sessions.start({ threadId: created.threadId, agentId: 'claude-code', model: 'large', effort: 'high' })
  yield* until(turns(created.threadId), (all) => all[0]?.state === 'completed')
  return { project, ...created, sessionId }
})

const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    yield* (yield* Sessions).send({ envelope: yield* Runtime.envelope('thread.send', {}), threadId, body, disposition: 'after_current' })
  })

describe('a connection lost after a clean turn', () => {
  it.live('quietly releases an idle Claude session without failing its completed turn', () => {
    const { controls, layer } = fixture()
    return Effect.gen(function* () {
      const one = yield* begin
      yield* Effect.promise(() => controls[0]!.lose())
      // Old code records the error but never releases this session. Either outcome settles this wait.
      yield* until(
        Effect.all([sessionState(one.sessionId), items(one.threadId)]),
        ([state, all]) =>
          state[0]?.state === 'lost' ||
          all.some((item) => item.kind === 'notice' && item.content.title === 'The connection to Claude was lost.'),
      )
      assert.strictEqual((yield* sessionState(one.sessionId))[0]?.state, 'lost')
      assert.deepStrictEqual(
        (yield* turns(one.threadId)).map((turn) => turn.state),
        ['completed'],
      )
      assert.lengthOf(
        (yield* items(one.threadId)).filter((item) => item.kind === 'notice' && item.content.severity !== 'info'),
        0,
      )
      const snapshot = yield* (yield* Queries).thread(one.threadId)
      assert.isNull(snapshot.session)
      // A message after the idle session ended starts the same agent again, as the window does.
      yield* say(one.threadId, scenarios.hello)
      assert.isTrue(yield* (yield* Sessions).startLast(one.threadId))
      yield* until(turns(one.threadId), (all) => all[1]?.state === 'completed')
    }).pipe(Effect.provide(layer))
  })

  it.live('retries a failed first brief even when no person’s input accompanied it', () => {
    const { layer } = fixture()
    return Effect.gen(function* () {
      const { task: created } = yield* task('Retry checkout [signed-out]')
      const sessions = yield* Sessions
      yield* sessions.start({ threadId: created.threadId, agentId: 'claude-code' })
      yield* until(turns(created.threadId), (all) => all[0]?.state === 'failed')
      assert.isTrue((yield* (yield* Queries).thread(created.threadId)).retryable)
      assert.isTrue(yield* sessions.tryAgain(created.threadId))
      const all = yield* until(turns(created.threadId), (all) => all[1]?.state === 'failed')
      assert.include(all[1]?.prompt ?? '', 'Retry checkout')
      assert.strictEqual(all[1]?.errorClass, 'auth_required')
    }).pipe(Effect.provide(layer))
  })

  it.live('retries failed news as well as the person’s messages', () => {
    const { layer } = fixture()
    return Effect.gen(function* () {
      const one = yield* begin
      const sessions = yield* Sessions
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId: one.threadId,
        body: scenarios.auth,
        disposition: 'after_current',
        origin: 'news',
        quiet: true,
      })
      yield* until(turns(one.threadId), (all) => all[1]?.state === 'failed')
      assert.isTrue(yield* sessions.tryAgain(one.threadId))
      const all = yield* until(turns(one.threadId), (all) => all[2]?.state === 'failed')
      assert.strictEqual(all[2]?.prompt, scenarios.auth)
    }).pipe(Effect.provide(layer))
  })

  it.live('does not warn when the ACP process itself closes while idle', () => {
    const { controls, layer } = fixture()
    return Effect.gen(function* () {
      const one = yield* begin
      controls[0]!.close()
      yield* until(sessionState(one.sessionId), ([row]) => row?.state === 'lost')
      assert.deepStrictEqual(
        (yield* turns(one.threadId)).map((turn) => turn.state),
        ['completed'],
      )
      assert.lengthOf(
        (yield* items(one.threadId)).filter((item) => item.kind === 'notice' && item.content.severity !== 'info'),
        0,
      )
    }).pipe(Effect.provide(layer))
  })

  it.live('Try again restarts a lost session even when its last turn completed, keeping its model and effort', () => {
    const { controls, layer } = fixture()
    return Effect.gen(function* () {
      const one = yield* begin
      controls[0]!.close()
      yield* until(sessionState(one.sessionId), ([row]) => row?.state === 'lost')
      // A notice kept by an older version, as on PR #663.
      yield* addItem({ projectId: one.project.projectId as ProjectId, threadId: one.threadId, sessionId: one.sessionId }, 'notice', {
        source: 'agent',
        severity: 'error',
        title: 'The connection to Claude was lost.',
      })
      const before = yield* (yield* Queries).thread(one.threadId)
      assert.isTrue(yield* (yield* Sessions).tryAgain(one.threadId))
      assert.isTrue(before.retryable)
      yield* until(turns(one.threadId), (all) => all[1]?.state === 'completed')
      const after = yield* (yield* Queries).thread(one.threadId)
      assert.notStrictEqual(after.session?.id, one.sessionId)
      assert.deepInclude(after.session, { agentId: 'claude-code', model: 'large', effort: 'high' })
      assert.isFalse(after.retryable)
    }).pipe(Effect.provide(layer))
  })

  it.live('a connection lost mid-turn still fails that turn and retries the person’s input in a fresh session', () => {
    const { controls, held, layer } = fixture()
    return Effect.gen(function* () {
      const one = yield* begin
      yield* say(one.threadId, scenarios.slow)
      yield* until(items(one.threadId), (all) => all.some((item) => item.kind === 'agent_message' && item.content.text === 'Starting'))
      controls[0]!.close()
      yield* until(sessionState(one.sessionId), ([row]) => row?.state === 'lost')
      assert.strictEqual((yield* turns(one.threadId))[1]?.state, 'failed')
      const before = yield* (yield* Queries).thread(one.threadId)
      assert.isTrue(before.retryable)
      held.open(scenarios.slow)
      assert.isTrue(yield* (yield* Sessions).tryAgain(one.threadId))
      const retried = yield* until(turns(one.threadId), (all) => all[2]?.state === 'completed')
      assert.include(retried[2]?.prompt ?? '', scenarios.slow)
    }).pipe(Effect.provide(layer))
  })
})
