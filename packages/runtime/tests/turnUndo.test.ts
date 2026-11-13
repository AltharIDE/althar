import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { holds } from '@althar/provider-adapters/testing'
import { Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { transcript } from '../src/threads'
import { applyRestore, planRestore, takeSnapshot } from '../src/turnSnapshots'
import { recoverTurnUndo } from '../src/turnUndo'
import { runtime, task, turns, until } from './support'

const idle = (threadId: string, count: number) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    yield* until(turns(threadId), (rows) => rows.length >= count && rows.every((row) => !['pending', 'delivered'].includes(row.state)))
    yield* until(sessions.running(threadId), (running) => Option.isSome(running) && !running.value.turnRunning)
  })

const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    return yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { threadId, body }), threadId, body })
  })

describe('undo from a task message', () => {
  it.live('blocks a new session until an interrupted file restore has recovered, then recovers only once', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const sql = yield* SqlClient.SqlClient
      const { task: created } = yield* task()
      const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${created.taskId} AND access = 'write'`
      const path = workspace?.path ?? ''
      const before = yield* takeSnapshot(path, 'refs/althar/test/before')
      writeFileSync(join(path, 'README.md'), 'Completed agent work')
      const after = yield* takeSnapshot(path, 'refs/althar/test/after')
      const plan = yield* planRestore(path, before, after, 'refs/althar/test/recovery')
      yield* sql`INSERT INTO turn_undo_recoveries ${sql.insert({ commandId: 'interrupted', threadId: created.threadId, plans: JSON.stringify([plan]), state: 'prepared' })}`
      yield* applyRestore(plan)
      assert.strictEqual((yield* Effect.flip(sessions.start({ threadId: created.threadId, agentId: 'codex' })))._tag, 'SessionFailed')
      yield* recoverTurnUndo(created.threadId)
      assert.strictEqual(readFileSync(join(path, 'README.md'), 'utf8'), 'Completed agent work')
      writeFileSync(join(path, 'README.md'), 'Work after recovery')
      yield* recoverTurnUndo(created.threadId)
      assert.strictEqual(readFileSync(join(path, 'README.md'), 'utf8'), 'Work after recovery')
      yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
      yield* idle(created.threadId, 1)
    }).pipe(Effect.provide(runtime())),
  )

  it.live(
    'restores files and the conversation, keeps an audit record, retries once, and briefs the next agent from retained context',
    () => {
      const going = holds()
      return Effect.gen(function* () {
        const sessions = yield* Sessions
        const sql = yield* SqlClient.SqlClient
        const queries = yield* Queries
        const { task: created } = yield* task()
        const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${created.taskId} AND access = 'write'`
        assert.isDefined(workspace)
        const path = workspace?.path ?? ''
        const original = readFileSync(join(path, 'README.md'), 'utf8')
        yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
        yield* idle(created.threadId, 1)
        yield* say(created.threadId, 'Keep this earlier decision: retries stay bounded.')
        yield* idle(created.threadId, 2)
        const input = yield* say(created.threadId, '[answers-after:5s] Raise the retry limit to twenty.')
        yield* until(sessions.running(created.threadId), (running) => Option.isSome(running) && running.value.turnRunning)
        writeFileSync(join(path, 'README.md'), 'Unwanted agent change')
        going.open('[answers-after:5s]')
        yield* idle(created.threadId, 3)
        writeFileSync(join(path, 'between-turns.txt'), 'Keep this edit made between turns')
        yield* say(created.threadId, 'A follow-up that should also leave the conversation.')
        yield* idle(created.threadId, 4)
        writeFileSync(join(path, 'my-note.txt'), 'Keep this unrelated edit')
        const [message] = yield* sql<{ id: string }>`SELECT id FROM thread_items WHERE user_input_id = ${input.inputId}`
        assert.isDefined(message)
        const itemId = message?.id ?? ''
        const before = yield* queries.thread(created.threadId)
        assert.include(before.undoable ?? [], itemId)
        const envelope = yield* Runtime.envelope('thread.undo_turn', { itemId })
        const result = yield* sessions.undoTurn({ envelope, itemId })
        assert.include(result.prompt, 'Raise the retry limit')
        assert.strictEqual(readFileSync(join(path, 'README.md'), 'utf8'), original)
        assert.strictEqual(readFileSync(join(path, 'my-note.txt'), 'utf8'), 'Keep this unrelated edit')
        assert.strictEqual(readFileSync(join(path, 'between-turns.txt'), 'utf8'), 'Keep this edit made between turns')
        const after = yield* queries.thread(created.threadId)
        assert.strictEqual(after.conversationVersion, (before.conversationVersion ?? 1) + 1)
        assert.isFalse(after.items.some((item) => item.id === itemId))
        const record = yield* transcript(created.threadId, 30_000)
        assert.include(record.text, 'Keep this earlier decision')
        assert.notInclude(record.text, 'Raise the retry limit')
        assert.notInclude(record.text, 'A follow-up that should also')
        assert.strictEqual(
          (yield* sql<{
            n: number
          }>`SELECT count(*) AS n FROM thread_items WHERE thread_id = ${created.threadId} AND undone_at IS NOT NULL`)[0]?.n === 0,
          false,
        )
        assert.deepStrictEqual(yield* sessions.undoTurn({ envelope, itemId }), result)
        assert.isTrue(Option.isNone(yield* sessions.running(created.threadId)))
        yield* say(created.threadId, 'Use three retries instead.')
        yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
        yield* idle(created.threadId, 5)
        const prompt = (yield* turns(created.threadId)).at(-1)?.prompt ?? ''
        assert.include(prompt, 'Keep this earlier decision')
        assert.notInclude(prompt, 'Raise the retry limit')
      }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', { holds: going })))))
    },
  )

  it.live('refuses a running turn without stopping it or removing its message', () => {
    const going = holds()
    return Effect.gen(function* () {
      const sessions = yield* Sessions
      const sql = yield* SqlClient.SqlClient
      const { task: created } = yield* task()
      yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
      yield* idle(created.threadId, 1)
      const input = yield* say(created.threadId, '[answers-after:5s] Still working')
      yield* until(sessions.running(created.threadId), (running) => Option.isSome(running) && running.value.turnRunning)
      const [message] = yield* sql<{ id: string }>`SELECT id FROM thread_items WHERE user_input_id = ${input.inputId}`
      const itemId = message?.id ?? ''
      const failure = yield* Effect.flip(sessions.undoTurn({ envelope: yield* Runtime.envelope('thread.undo_turn', { itemId }), itemId }))
      assert.strictEqual(failure._tag, 'UndoRefused')
      assert.isTrue(Option.getOrUndefined(yield* sessions.running(created.threadId))?.turnRunning)
      going.open('[answers-after:5s]')
      yield* idle(created.threadId, 2)
    }).pipe(Effect.provide(runtime(':memory:', { holds: going })))
  })
})
