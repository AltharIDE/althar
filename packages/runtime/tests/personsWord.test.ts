import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Ids, newId, type ProjectId } from '@althar/domain'
import type { MessageSender } from '@althar/contracts'
import { assert, describe, it } from '@effect/vitest'
import { Cause, Deferred, Effect, Fiber, Option } from 'effect'
import { SqlClient } from 'effect/sql'
import { TestClock } from 'effect/testing'

import { postCard } from '../src/cards'
import { Coordinator } from '../src/Coordinator'
import { Errands, errandLines, type AskedAction, type AskedResult, type ErrandStep, type FreshAction } from '../src/Errands'
import { handoverRecord } from '../src/handover'
import { Projects } from '../src/Projects'
import { timestamp } from '../src/records'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { ToolRefused, ToolServer, type ToolAccess } from '../src/ToolServer'
import { callTool, callToolAtOnce, repository, runtime } from './support'

/** A live turn in the store, without an agent process; calls use the real HTTP MCP server. */
const setup = (role: 'coordinator' | 'lead' = 'coordinator') =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
    let taskId: string | null = null
    let threadId = yield* (yield* Coordinator).thread(project.projectId)
    if (role === 'lead') {
      const task = yield* (yield* Projects).createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'A waiting task',
        draft: true,
      })
      taskId = task.taskId
      threadId = task.threadId
    }
    const sessionId = yield* newId(Ids.providerSession)
    yield* sql`INSERT INTO provider_sessions ${sql.insert({ id: sessionId, projectId: project.projectId, threadId, agentId: 'codex', state: 'active', startedAt: yield* timestamp })}`
    const access: ToolAccess = { role, projectId: project.projectId, threadId, taskId, sessionId }
    const say = (
      sender: MessageSender = { kind: 'window' },
      body = 'Do the test action once its checks pass',
      origin = sender.kind === 'window' || sender.kind === 'paired_device' ? 'person' : 'news',
    ) =>
      Effect.gen(function* () {
        yield* sql`UPDATE turn_deliveries SET state = 'completed', ended_at = ${yield* timestamp} WHERE thread_id = ${threadId} AND state = 'delivered'`
        const accepted = yield* (yield* Sessions).send({
          envelope: yield* Runtime.envelope('thread.send', {}),
          threadId,
          body,
          sender,
          origin: origin === 'news' ? 'news' : 'system',
        })
        const turnId = yield* newId(Ids.turnDelivery)
        yield* sql`INSERT INTO turn_deliveries ${sql.insert({ id: turnId, projectId: project.projectId, threadId, providerSessionId: sessionId, controllerGeneration: 1, state: 'delivered', origin, requestedAt: yield* timestamp, deliveredAt: yield* timestamp })}`
        yield* sql`INSERT INTO turn_delivery_inputs ${sql.insert({ projectId: project.projectId, deliveryId: turnId, userInputId: accepted.inputId, position: 1 })}`
        return accepted.inputId
      })
    const errands = yield* Errands
    let fresh: FreshAction = { state: 'ready', head: 'head-a', branch: 'main' }
    let acts = 0
    let reads = 0
    let pending = false
    let lost = false
    let reading = Effect.void
    const step: ErrandStep = {
      key: 'first',
      tool: 'test_asked',
      ...(taskId === null ? {} : { taskId }),
      target: 'repo/#1',
      head: 'head-a',
      branch: 'main',
      request: { method: 'test' },
      waits: [{ kind: 'checks', target: 'head-a' }],
    }
    yield* (yield* ToolServer).serve(role, [
      {
        name: step.tool,
        kind: 'asked-for',
        description: 'Test only; counts actions and reaches no host.',
        input: { type: 'object' },
        action: (input, current) =>
          Effect.sync(() => {
            assert.strictEqual(current.byPerson, current.origin === 'person')
            const args = input as {
              messageId?: string
              errandId?: string
              step?: string
              target?: string
              request?: Record<string, unknown>
            }
            return {
              ...args,
              target: args.target ?? step.target,
              head: step.head,
              branch: step.branch,
              request: args.request ?? step.request,
              read: Effect.gen(function* () {
                reads++
                yield* reading
                return fresh
              }),
              act: (): Effect.Effect<AskedResult, ToolRefused> =>
                Effect.suspend(() => {
                  acts++
                  return lost
                    ? Effect.fail(new ToolRefused({ message: 'The answer was lost.' }))
                    : Effect.succeed(pending ? { pending: true as const, answer: 'In flight.' } : 'Did it once.')
                }),
            } satisfies AskedAction
          }),
      },
    ])
    return {
      sql,
      errands,
      access,
      say,
      step,
      set: (next: FreshAction) => {
        fresh = next
      },
      pending: () => {
        pending = true
      },
      lose: () => {
        lost = true
      },
      holdRead: (wait: Effect.Effect<void>) => {
        reading = wait
      },
      counts: () => ({ acts, reads }),
    }
  })
const failure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.map(Effect.exit(effect), (exit) => {
    assert.isTrue(exit._tag === 'Failure')
    return exit._tag === 'Failure' ? Option.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
  })

describe('the person’s word through the tool boundary', () => {
  for (const role of ['coordinator', 'lead'] as const) {
    it.live(`${role}: refuses news and socket messages for asked-for tools and errands`, () =>
      Effect.gen(function* () {
        const s = yield* setup(role)
        for (const sender of [{ kind: 'internal' }, { kind: 'socket' }] as const) {
          const messageId = yield* s.say(sender)
          assert.match(yield* callTool(s.access, 'test_asked', { messageId }), /window or a paired device/)
          assert.instanceOf(yield* failure(s.errands.keep(s.access, messageId, [s.step])), ToolRefused)
        }
        assert.deepStrictEqual(s.counts(), { acts: 0, reads: 0 })
      }).pipe(Effect.provide(runtime())),
    )
    it.live(`${role}: accepts the window and paired devices; concurrent retries act once`, () =>
      Effect.gen(function* () {
        const s = yield* setup(role)
        for (const sender of [{ kind: 'window' }, { kind: 'paired_device', deviceId: 'phone-1' }] as const) {
          const messageId = yield* s.say(sender)
          assert.deepStrictEqual(yield* callToolAtOnce(s.access, 'test_asked', [{ messageId }, { messageId }]), [
            'Did it once.',
            'Did it once.',
          ])
        }
        assert.deepStrictEqual(s.counts(), { acts: 1, reads: 1 })
      }).pipe(Effect.provide(runtime())),
    )
  }
  it.live('an errand’s step runs in a news turn; only its bound target and arguments; kept and done lines survive', () =>
    Effect.gen(function* () {
      const s = yield* setup('lead')
      const message = yield* s.say()
      yield* postCard(s.access.projectId as ProjectId, s.access.taskId!)
      const [before] = yield* s.sql<{
        revision: number
      }>`SELECT revision FROM thread_items WHERE kind = 'task' AND json_extract(content, '$.taskId') = ${s.access.taskId}`
      const id = yield* s.errands.keep(s.access, message, [s.step])
      const [after] = yield* s.sql<{
        revision: number
      }>`SELECT revision FROM thread_items WHERE kind = 'task' AND json_extract(content, '$.taskId') = ${s.access.taskId}`
      assert.isAbove(after?.revision ?? 0, before?.revision ?? 0)
      assert.strictEqual(yield* s.errands.keep(s.access, message, [s.step]), id)
      assert.include((yield* errandLines(s.access.projectId, s.access.taskId!)).join(), 'checks head-a')
      assert.include(
        (yield* handoverRecord({
          projectId: s.access.projectId,
          threadId: s.access.threadId,
          modelOf: () => 'Codex',
          working: () => false,
        })).sections.join(),
        id,
      )
      yield* s.say({ kind: 'internal' })
      const args = { errandId: id, step: s.step.key }
      assert.match(yield* callTool(s.access, 'test_asked', { ...args, target: 'repo/#2' }), /does not match/)
      assert.match(yield* callTool(s.access, 'test_asked', { ...args, request: { method: 'other' } }), /does not match/)
      assert.strictEqual(yield* callTool(s.access, 'test_asked', args), 'Did it once.')
      assert.strictEqual(yield* callTool(s.access, 'test_asked', args), 'Did it once.')
      assert.deepStrictEqual(s.counts(), { acts: 1, reads: 1 })
      assert.deepStrictEqual(yield* errandLines(s.access.projectId), [])
      const items = yield* s.sql<{
        content: string
      }>`SELECT content FROM thread_items WHERE thread_id = ${s.access.threadId} AND kind = 'notice'`
      assert.isTrue(items.some((i) => i.content.includes('Kept an errand')))
      assert.isTrue(items.some((i) => i.content.includes('Errand done')))
    }).pipe(Effect.provide(runtime())),
  )
  it.live('a person’s objection pauses even during a fresh read, and only fresh word resumes', () =>
    Effect.gen(function* () {
      const s = yield* setup()
      const id = yield* s.errands.keep(s.access, yield* s.say(), [s.step])
      yield* s.say({ kind: 'internal' })
      const started = yield* Deferred.make<void>()
      const held = yield* Deferred.make<void>()
      s.holdRead(Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(held))))
      const call = yield* Effect.forkChild(callTool(s.access, 'test_asked', { errandId: id, step: s.step.key }))
      yield* Deferred.await(started)
      const objection = yield* s.say({ kind: 'window' }, 'Wait, do not do that yet')
      yield* callTool(s.access, 'pause_errand', { errand: id, reason: 'The person said to wait.' })
      yield* Deferred.succeed(held, undefined)
      assert.match(yield* Fiber.join(call), /paused/)
      yield* s.say({ kind: 'internal' })
      assert.instanceOf(yield* failure(s.errands.resume(s.access, id, objection)), ToolRefused)
      yield* s.errands.resume(s.access, id, yield* s.say({ kind: 'window' }, 'Go ahead now'))
      const [record] = yield* s.sql<{ words: string; resumeWords: string }>`SELECT words, resume_words FROM errands WHERE id = ${id}`
      assert.strictEqual(record?.words, 'Do the test action once its checks pass')
      assert.strictEqual(record?.resumeWords, 'Go ahead now')
      assert.strictEqual(yield* callTool(s.access, 'test_asked', { errandId: id, step: s.step.key }), 'Did it once.')
      assert.strictEqual(s.counts().acts, 1)
    }).pipe(Effect.provide(runtime())),
  )
  it.live('a review objection pauses; a target branch change or another writer ends it', () =>
    Effect.gen(function* () {
      const s = yield* setup()
      for (const fresh of [
        { state: 'objection', reason: 'Changes requested.' },
        { state: 'ready', branch: 'release', head: 'head-a' },
        { state: 'ready', branch: 'main', head: 'head-b', pushedBy: 'other' },
      ] satisfies FreshAction[]) {
        const id = yield* s.errands.keep(s.access, yield* s.say({ kind: 'window' }, JSON.stringify(fresh)), [s.step])
        s.set(fresh)
        yield* callTool(s.access, 'test_asked', { errandId: id, step: s.step.key })
        assert.strictEqual(
          (yield* s.sql<{ state: string }>`SELECT state FROM errands WHERE id = ${id}`)[0]?.state,
          fresh.state === 'objection' ? 'paused' : 'cancelled',
        )
      }
      assert.strictEqual(s.counts().acts, 0)
    }).pipe(Effect.provide(runtime())),
  )
  it.live('an objection cannot be overridden with the old message in the same turn', () =>
    Effect.gen(function* () {
      const s = yield* setup()
      const message = yield* s.say()
      const id = yield* s.errands.keep(s.access, message, [s.step])
      yield* s.errands.pause(s.access, id, 'Wait for the person.')
      assert.instanceOf(yield* failure(s.errands.resume(s.access, id, message)), ToolRefused)
      assert.match(yield* callTool(s.access, 'test_asked', { messageId: message }), /paused or called off/)
      assert.strictEqual(s.counts().acts, 0)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('a lost answer stays uncertain until read back and is never acted on twice', () =>
    Effect.gen(function* () {
      const s = yield* setup()
      const id = yield* s.errands.keep(s.access, yield* s.say(), [s.step])
      const args = { errandId: id, step: s.step.key }
      s.lose()
      yield* callTool(s.access, 'test_asked', args)
      assert.strictEqual(
        (yield* s.sql<{ state: string }>`SELECT state FROM mutation_receipts WHERE operation = 'test_asked'`)[0]?.state,
        'uncertain',
      )
      assert.match(yield* callTool(s.access, 'test_asked', args), /will not be acted on twice/)
      s.set({ state: 'done', head: 'head-a', branch: 'main', answer: 'Read back: done.' })
      assert.strictEqual(yield* callTool(s.access, 'test_asked', args), 'Read back: done.')
      assert.deepStrictEqual(s.counts(), { acts: 1, reads: 3 })
      const [row] = yield* s.sql<{
        state: string
        saidAt: string | null
      }>`SELECT state, said_at FROM mutation_receipts WHERE operation = 'test_asked'`
      assert.strictEqual(row?.state, 'confirmed')
      assert.isNotNull(row?.saidAt)
    }).pipe(Effect.provide(runtime())),
  )
  it.live('a confirmed receipt repairs an errand after a crash before reporting', () =>
    Effect.gen(function* () {
      const s = yield* setup()
      const id = yield* s.errands.keep(s.access, yield* s.say(), [s.step])
      const args = { errandId: id, step: s.step.key }
      yield* callTool(s.access, 'test_asked', args)
      yield* s.sql`UPDATE errands SET state = 'open' WHERE id = ${id}`
      yield* s.sql`UPDATE errand_steps SET state = 'waiting' WHERE errand_id = ${id}`
      yield* s.sql`UPDATE mutation_receipts SET said_at = NULL WHERE operation = 'test_asked'`
      assert.strictEqual(yield* callTool(s.access, 'test_asked', args), 'Did it once.')
      assert.strictEqual((yield* s.sql<{ state: string }>`SELECT state FROM errands WHERE id = ${id}`)[0]?.state, 'done')
      assert.strictEqual(s.counts().acts, 1)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('a host’s accepted but unfinished action stays pending until a read shows it done', () =>
    Effect.gen(function* () {
      const s = yield* setup()
      const id = yield* s.errands.keep(s.access, yield* s.say(), [s.step])
      s.pending()
      const args = { errandId: id, step: s.step.key }
      assert.strictEqual(yield* callTool(s.access, 'test_asked', args), 'In flight.')
      assert.strictEqual((yield* s.sql<{ state: string }>`SELECT state FROM errands WHERE id = ${id}`)[0]?.state, 'open')
      assert.strictEqual(
        (yield* s.sql<{ state: string }>`SELECT state FROM mutation_receipts WHERE operation = 'test_asked'`)[0]?.state,
        'uncertain',
      )
      assert.match(yield* callTool(s.access, 'test_asked', args), /will not be acted on twice/)
      s.set({ state: 'done', head: 'head-a', branch: 'main', answer: 'Landed.' })
      assert.strictEqual(yield* callTool(s.access, 'test_asked', args), 'Landed.')
      assert.strictEqual(s.counts().acts, 1)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('two errands and a direct call share an external intent’s receipt', () =>
    Effect.gen(function* () {
      const s = yield* setup()
      const message = yield* s.say()
      s.lose()
      yield* callTool(s.access, 'test_asked', { messageId: message })
      const id = yield* s.errands.keep(s.access, message, [s.step])
      s.set({ state: 'done', head: 'head-a', branch: 'main', answer: 'Read back: done.' })
      assert.strictEqual(yield* callTool(s.access, 'test_asked', { errandId: id, step: s.step.key }), 'Read back: done.')
      const other = yield* s.errands.keep(s.access, yield* s.say({ kind: 'window' }, 'Do that same action'), [s.step])
      assert.strictEqual(yield* callTool(s.access, 'test_asked', { errandId: other, step: s.step.key }), 'Read back: done.')
      assert.strictEqual((yield* s.sql<{ state: string }>`SELECT state FROM errands WHERE id = ${other}`)[0]?.state, 'done')
      assert.strictEqual(s.counts().acts, 1)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('steps run in order, wait for fresh state, and use the lead’s new head', () =>
    Effect.gen(function* () {
      const s = yield* setup()
      const second = { ...s.step, key: 'second', request: { method: 'second' } }
      const id = yield* s.errands.keep(s.access, yield* s.say(), [s.step, second])
      const args = { errandId: id, step: second.key, request: second.request }
      assert.match(yield* callTool(s.access, 'test_asked', args), /earlier step/)
      s.set({ state: 'waiting', head: 'head-a', branch: 'main' })
      assert.match(yield* callTool(s.access, 'test_asked', { errandId: id, step: s.step.key }), /still waits/)
      s.set({ state: 'ready', head: 'head-b', branch: 'main', pushedBy: 'lead' })
      yield* callTool(s.access, 'test_asked', { errandId: id, step: s.step.key })
      assert.strictEqual(yield* callTool(s.access, 'test_asked', args), 'Did it once.')
      const receipts = yield* s.sql<{ request: string }>`SELECT request FROM mutation_receipts WHERE operation = 'test_asked'`
      assert.lengthOf(receipts, 2)
      assert.isTrue(receipts.every((r) => JSON.parse(r.request).head === 'head-b'))
    }).pipe(Effect.provide(runtime())),
  )

  it.live('a new runtime reads a lost answer back from the durable errand, without acting again', () =>
    Effect.gen(function* () {
      const database = join(mkdtempSync(join(tmpdir(), 'althar-word-restart-')), 'profile.sqlite')
      const saved = yield* Effect.gen(function* () {
        const s = yield* setup()
        const id = yield* s.errands.keep(s.access, yield* s.say(), [s.step])
        s.lose()
        yield* callTool(s.access, 'test_asked', { errandId: id, step: s.step.key })
        return { access: s.access, id, step: s.step }
      }).pipe(Effect.provide(runtime(database)))
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const sessionId = yield* newId(Ids.providerSession)
        const access = { ...saved.access, sessionId }
        yield* sql`INSERT INTO provider_sessions ${sql.insert({ id: sessionId, projectId: access.projectId, threadId: access.threadId, agentId: 'claude-code', state: 'active', startedAt: yield* timestamp })}`
        const turnId = yield* newId(Ids.turnDelivery)
        yield* sql`INSERT INTO turn_deliveries ${sql.insert({ id: turnId, projectId: access.projectId, threadId: access.threadId, providerSessionId: sessionId, controllerGeneration: 1, state: 'delivered', origin: 'news', requestedAt: yield* timestamp })}`
        yield* (yield* ToolServer).serve('coordinator', [
          {
            name: 'test_asked',
            kind: 'asked-for',
            description: 'Read back only.',
            input: { type: 'object' },
            action: () =>
              Effect.succeed({
                errandId: saved.id,
                step: saved.step.key,
                target: saved.step.target,
                head: saved.step.head,
                branch: saved.step.branch,
                request: saved.step.request,
                read: Effect.succeed({ state: 'done' as const, head: 'head-a', branch: 'main', answer: 'Read back after restart.' }),
                act: () => Effect.die('Must not act twice'),
              }),
          },
        ])
        assert.strictEqual(yield* callTool(access, 'test_asked'), 'Read back after restart.')
        assert.strictEqual((yield* sql<{ state: string }>`SELECT state FROM errands WHERE id = ${saved.id}`)[0]?.state, 'done')
      }).pipe(Effect.provide(runtime(database)))
    }),
  )

  it.effect('a quiet errand says what it waits on once a day without a live session', () =>
    Effect.gen(function* () {
      const s = yield* setup()
      yield* s.errands.keep(s.access, yield* s.say(), [s.step])
      const since = yield* timestamp
      yield* s.errands.keep(s.access, yield* s.say({ kind: 'window' }, 'Wait for the missing check'), [
        { ...s.step, waits: [{ kind: 'required-check-missing', target: 'build', since }] },
      ])
      yield* s.sql`UPDATE turn_deliveries SET state = 'completed' WHERE thread_id = ${s.access.threadId}`
      yield* TestClock.adjust('1 hour')
      yield* s.errands.remind(s.access.projectId)
      assert.lengthOf(
        yield* s.sql`SELECT id FROM thread_items WHERE thread_id = ${s.access.threadId} AND content LIKE '%Errand still waits%'`,
        1,
      )
      yield* TestClock.adjust('23 hours')
      yield* s.errands.remind(s.access.projectId)
      yield* s.errands.remind(s.access.projectId)
      const lines = yield* s.sql<{
        content: string
      }>`SELECT content FROM thread_items WHERE thread_id = ${s.access.threadId} AND content LIKE '%Errand still waits%'`
      assert.lengthOf(lines, 2)
      assert.isTrue(lines.some((line) => line.content.includes('checks')))
    }).pipe(Effect.provide(runtime())),
  )
})
