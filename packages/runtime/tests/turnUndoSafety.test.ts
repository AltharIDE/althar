import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { Ids, newId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Projects } from '../src/Projects'
import { timestamp } from '../src/records'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { checkpointBeforeTurn, checkpointAfterTurn } from '../src/turnUndo'
import { words } from '../src/words'
import { runtime, task, turns, until } from './support'

const fixture = Effect.gen(function* () {
  const sessions = yield* Sessions
  const sql = yield* SqlClient.SqlClient
  const { project, task: created } = yield* task()
  const sessionId = yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
  yield* until(turns(created.threadId), (rows) => rows.length === 1 && rows[0]?.state === 'completed')
  yield* until(sessions.running(created.threadId), (running) => Option.isSome(running) && !running.value.turnRunning)
  yield* sessions.stop(created.threadId)
  const [found] = yield* sql<{ id: string; path: string }>`SELECT id, path FROM workspaces WHERE task_id = ${created.taskId}`
  const workspace = found ?? assert.fail('The task needs a worktree')
  return {
    ...created,
    projectId: project.projectId,
    sessionId,
    workspace,
    original: readFileSync(join(workspace.path, 'README.md'), 'utf8'),
  }
})

/** A persisted, completed turn: capture real Git trees, without needing an agent to perform the edits. */
const recorded = (on: { threadId: string; projectId: string; sessionId: string }, text: string, edit: () => void = () => {}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const input = yield* (yield* Sessions).send({
      envelope: yield* Runtime.envelope('thread.send', {}),
      threadId: on.threadId,
      body: text,
    })
    const id = yield* newId(Ids.turnDelivery)
    const at = yield* timestamp
    yield* sql`INSERT INTO turn_deliveries ${sql.insert({
      id,
      projectId: on.projectId,
      threadId: on.threadId,
      providerSessionId: on.sessionId,
      controllerGeneration: 1,
      state: 'completed',
      requestedAt: at,
      deliveredAt: at,
      endedAt: at,
    })}`
    yield* sql`INSERT INTO turn_delivery_inputs ${sql.insert({ projectId: on.projectId, deliveryId: id, userInputId: input.inputId, position: 1 })}`
    yield* sql`UPDATE user_inputs SET state = 'delivered' WHERE id = ${input.inputId}`
    yield* checkpointBeforeTurn(on.threadId, id)
    edit()
    yield* checkpointAfterTurn(id)
    const [message] = yield* sql<{ id: string }>`SELECT id FROM thread_items WHERE user_input_id = ${input.inputId}`
    return { deliveryId: id, itemId: message?.id ?? assert.fail('The delivered message must be kept') }
  })

const undo = (itemId: string) =>
  Effect.gen(function* () {
    return yield* (yield* Sessions).undoTurn({ envelope: yield* Runtime.envelope('thread.undo_turn', { itemId }), itemId })
  })
const refused = (itemId: string) =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(undo(itemId))
    assert.strictEqual(error._tag, 'UndoRefused')
    return error._tag === 'UndoRefused' ? error : assert.fail('Expected an undo refusal')
  })

describe('chat undo safety boundaries', () => {
  it.live('recovers changed files if the conversation transaction fails, then safely retries the same command', () =>
    Effect.gen(function* () {
      const on = yield* fixture
      const sql = yield* SqlClient.SqlClient
      const sessions = yield* Sessions
      const turn = yield* recorded(on, 'Change README', () => writeFileSync(join(on.workspace.path, 'README.md'), 'Agent work'))
      const input = { envelope: yield* Runtime.envelope('thread.undo_turn', { itemId: turn.itemId }), itemId: turn.itemId }
      // Simulate a store write failure after file restoration but before the receipt and conversation can commit.
      yield* sql`CREATE TRIGGER block_undo BEFORE UPDATE OF undone_at ON thread_items
        WHEN NEW.undone_at IS NOT NULL BEGIN SELECT RAISE(ABORT, 'store write failed'); END`
      assert.strictEqual((yield* Effect.flip(sessions.undoTurn(input)))._tag, 'SqlError')
      assert.strictEqual(readFileSync(join(on.workspace.path, 'README.md'), 'utf8'), 'Agent work')
      assert.isNull((yield* sql<{ undoneAt: string | null }>`SELECT undone_at FROM thread_items WHERE id = ${turn.itemId}`)[0]?.undoneAt)
      assert.strictEqual(
        (yield* sql<{ state: string }>`SELECT state FROM turn_undo_recoveries WHERE command_id = ${input.envelope.commandId}`)[0]?.state,
        'recovered',
      )
      assert.isEmpty(yield* sql`SELECT 1 FROM command_receipts WHERE command_id = ${input.envelope.commandId}`)
      yield* sql`DROP TRIGGER block_undo`
      assert.strictEqual((yield* sessions.undoTurn(input)).restored, 1)
      assert.strictEqual(readFileSync(join(on.workspace.path, 'README.md'), 'utf8'), on.original)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('refuses a suffix recorded in different worktree locations', () =>
    Effect.gen(function* () {
      const on = yield* fixture
      const sql = yield* SqlClient.SqlClient
      const first = yield* recorded(on, 'First location', () => writeFileSync(join(on.workspace.path, 'README.md'), 'Agent work'))
      const second = yield* recorded(on, 'Second location')
      const [row] = yield* sql<{ checkpoints: string }>`SELECT checkpoints FROM turn_deliveries WHERE id = ${second.deliveryId}`
      const points = JSON.parse(row?.checkpoints ?? '[]') as Array<{ path: string }>
      for (const point of points) point.path = join(point.path, 'moved')
      yield* sql`UPDATE turn_deliveries SET checkpoints = ${JSON.stringify(points)} WHERE id = ${second.deliveryId}`
      assert.include((yield* refused(first.itemId)).message, 'folders moved')
      assert.strictEqual(readFileSync(join(on.workspace.path, 'README.md'), 'utf8'), 'Agent work')
    }).pipe(Effect.provide(runtime())),
  )

  it('shows the undo refusal and affected filenames, including a reply without file metadata', () => {
    const message = 'Keep or move later edits first.'
    const format = (extra: object) => words({ _tag: 'UndoRefused', message, ...extra }, (agentId) => agentId).message
    assert.strictEqual(format({}), message)
    assert.strictEqual(format({ files: [] }), message)
    assert.strictEqual(format({ files: ['README.md', 'src/retry.ts'] }), `${message} README.md, src/retry.ts`)
    assert.deepStrictEqual(
      words({ _tag: 'UndoRefused', message, files: ['src/retry.ts'], why: 'edited' }, (id) => id),
      {
        reason: 'UndoRefused',
        message: `${message} src/retry.ts`,
        why: 'edited',
        detail: '["src/retry.ts"]',
      },
    )
  })
  it.live('leaves queued, missing and incompletely checkpointed messages intact', () =>
    Effect.gen(function* () {
      const on = yield* fixture
      const sql = yield* SqlClient.SqlClient
      const sessions = yield* Sessions
      const input = yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId: on.threadId,
        body: 'Still queued',
      })
      const [queued] = yield* sql<{ id: string }>`SELECT id FROM thread_items WHERE user_input_id = ${input.inputId}`
      assert.include((yield* refused(queued?.id ?? '')).message, 'not read')
      yield* sessions.takeBack({ envelope: yield* Runtime.envelope('thread.take_back', {}), itemId: queued?.id ?? '' })
      assert.strictEqual((yield* Effect.flip(undo('missing-message')))._tag, 'NotFound')
      const turn = yield* recorded(on, 'Change README', () => writeFileSync(join(on.workspace.path, 'README.md'), 'Agent work'))
      const [point] = yield* sql<{ checkpoints: string }>`SELECT checkpoints FROM turn_deliveries WHERE id = ${turn.deliveryId}`
      const complete = point?.checkpoints ?? assert.fail('Missing fixture checkpoint')
      const beforeOnly = JSON.parse(complete) as Array<{ after?: unknown }>
      for (const item of beforeOnly) delete item.after
      for (const checkpoints of [null, '[]', JSON.stringify(beforeOnly)]) {
        yield* sql`UPDATE turn_deliveries SET checkpoints = ${checkpoints} WHERE id = ${turn.deliveryId}`
        assert.include((yield* refused(turn.itemId)).message, 'checkpoint')
        assert.strictEqual(readFileSync(join(on.workspace.path, 'README.md'), 'utf8'), 'Agent work')
        assert.isNull((yield* sql<{ undoneAt: string | null }>`SELECT undone_at FROM thread_items WHERE id = ${turn.itemId}`)[0]?.undoneAt)
      }
      yield* sql`UPDATE turn_deliveries SET checkpoints = ${complete} WHERE id = ${turn.deliveryId}`
      assert.strictEqual((yield* undo(turn.itemId)).restored, 1)
      assert.strictEqual(readFileSync(join(on.workspace.path, 'README.md'), 'utf8'), on.original)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('refuses a Local checkout, a moving worktree and a working helper', () =>
    Effect.gen(function* () {
      const on = yield* fixture
      const sql = yield* SqlClient.SqlClient
      const turn = yield* recorded(on, 'Keep the conversation')
      yield* sql`UPDATE workspaces SET kind = 'checkout' WHERE id = ${on.workspace.id}`
      assert.include((yield* refused(turn.itemId)).message, 'own worktrees')
      yield* sql`UPDATE workspaces SET kind = 'worktree', moving_to = 'checkout' WHERE id = ${on.workspace.id}`
      assert.include((yield* refused(turn.itemId)).message, 'Stop')
      yield* sql`UPDATE workspaces SET moving_to = NULL WHERE id = ${on.workspace.id}`
      yield* sql`INSERT INTO helpers ${sql.insert({
        id: 'working-helper',
        taskId: on.taskId,
        projectId: on.projectId,
        threadId: 'helper-thread',
        name: 'Background helper',
        brief: 'Finish the task',
        agentId: 'codex',
        state: 'working',
        startedAt: yield* timestamp,
      })}`
      assert.include((yield* refused(turn.itemId)).message, 'helpers')
      yield* sql`UPDATE helpers SET state = 'done' WHERE id = 'working-helper'`
      assert.strictEqual((yield* undo(turn.itemId)).restored, 0)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('refuses a folder shared with another task, including nested folders in either direction', () =>
    Effect.gen(function* () {
      const on = yield* fixture
      const sql = yield* SqlClient.SqlClient
      const other = yield* (yield* Projects).createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: on.projectId,
        title: 'Other task',
      })
      const [workspace] = yield* sql<{ id: string; path: string }>`SELECT id, path FROM workspaces WHERE task_id = ${other.taskId}`
      const shared = workspace ?? assert.fail('Other task needs a workspace')
      const turn = yield* recorded(on, 'Undo only my task')
      for (const path of [on.workspace.path, join(on.workspace.path, 'nested'), dirname(on.workspace.path)]) {
        yield* sql`UPDATE workspaces SET path = ${path} WHERE id = ${shared.id}`
        assert.include((yield* refused(turn.itemId)).message, 'shares this folder')
        assert.strictEqual(readFileSync(join(on.workspace.path, 'README.md'), 'utf8'), on.original)
      }
      yield* sql`UPDATE workspaces SET path = ${shared.path} WHERE id = ${shared.id}`
      assert.strictEqual((yield* undo(turn.itemId)).restored, 0)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('refuses moved or detached workspaces before touching their files', () =>
    Effect.gen(function* () {
      const on = yield* fixture
      const sql = yield* SqlClient.SqlClient
      const turn = yield* recorded(on, 'Edit README', () => writeFileSync(join(on.workspace.path, 'README.md'), 'Agent work'))
      yield* sql`UPDATE workspaces SET path = ${join(on.workspace.path, 'moved')} WHERE id = ${on.workspace.id}`
      assert.include((yield* refused(turn.itemId)).message, 'folders have changed')
      yield* sql`UPDATE workspaces SET path = ${on.workspace.path}, access = 'read' WHERE id = ${on.workspace.id}`
      assert.include((yield* refused(turn.itemId)).message, 'folders have changed')
      assert.strictEqual(readFileSync(join(on.workspace.path, 'README.md'), 'utf8'), 'Agent work')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('keeps edits between turns even when a later turn touched the same file again', () =>
    Effect.gen(function* () {
      const on = yield* fixture
      const first = yield* recorded(on, 'First change', () => writeFileSync(join(on.workspace.path, 'README.md'), 'First agent change'))
      writeFileSync(join(on.workspace.path, 'README.md'), 'Manual edit between turns')
      yield* recorded(on, 'Second change', () => writeFileSync(join(on.workspace.path, 'README.md'), 'Second agent change'))
      const failure = yield* refused(first.itemId)
      assert.include(failure.message, 'between the turns')
      assert.deepStrictEqual(failure.files, ['README.md'])
      assert.strictEqual(readFileSync(join(on.workspace.path, 'README.md'), 'utf8'), 'Second agent change')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('restores each file to its earliest touched turn and returns all prompts in order', () =>
    Effect.gen(function* () {
      const on = yield* fixture
      const sql = yield* SqlClient.SqlClient
      const first = yield* recorded(on, 'First change', () => writeFileSync(join(on.workspace.path, 'README.md'), 'First agent change'))
      const second = yield* recorded(on, 'Second change', () => {
        writeFileSync(join(on.workspace.path, 'README.md'), 'Second agent change')
        writeFileSync(join(on.workspace.path, 'later-one.txt'), 'Added by the second turn')
        writeFileSync(join(on.workspace.path, 'later-two.txt'), 'Added by the second turn')
      })
      yield* sql`UPDATE thread_items SET content = ${JSON.stringify({ text: 'Second change', links: [], pictures: [], files: [] })} WHERE id = ${second.itemId}`
      const result = yield* undo(first.itemId)
      assert.strictEqual(result.prompt, 'First change\n\nSecond change')
      assert.strictEqual(result.restored, 3)
      assert.lengthOf(result.messages, 2)
      assert.deepStrictEqual(result.messages[1], { text: 'Second change', links: [], pictures: [], files: [] })
      assert.strictEqual(readFileSync(join(on.workspace.path, 'README.md'), 'utf8'), on.original)
      assert.isFalse(existsSync(join(on.workspace.path, 'later-one.txt')))
      assert.isFalse(existsSync(join(on.workspace.path, 'later-two.txt')))
      assert.include((yield* refused(first.itemId)).message, 'cannot be undone')
    }).pipe(Effect.provide(runtime())),
  )
})
