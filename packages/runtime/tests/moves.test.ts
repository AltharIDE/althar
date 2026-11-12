import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { fakeConnectors, HOST, hosted, items, runtime, until } from './support'

/*
 * A running task moves between a worktree and Local (a task is a conversation
 * plus parts, "Moving between a worktree and Local"), between its lead's
 * turns, with its branch and its conversation. Every Local rule stays: the
 * person's uncommitted work holds a move, and their own branch is theirs to
 * give up.
 */

const runtimeWith = (github: FakeService) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) })),
  )

const git = (cwd: string, ...args: Array<string>) => execFileSync('git', args, { cwd }).toString().trim()
const as = ['-c', 'user.name=Person', '-c', 'user.email=person@althar.test']

const onGitHub = () => {
  const { working, bare } = hosted()
  const github = makeFakeService({ pushUrl: () => bare })
  github.addRepository(['meridian', 'api'])
  return { working, bare, github }
}

const cards = (projectId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const snapshot = yield* Effect.orDie(queries.coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

/** A planned task whose lead did its part in a worktree and whose draft pull request opened, with no review. */
const opened = (working: string) =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const projects = yield* Projects
    const coordinator = yield* Coordinator
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const threadId = yield* coordinator.thread(project.projectId)
    const body = 'Add a retry. [coordinator:plan] [coordinator:plan-no-review] [lead:finish] [lead:edit]'
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
    const [ready] = yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready' && all[0].change !== null)
    const card = ready ?? assert.fail('no card')
    yield* until(
      Effect.flatMap(Sessions, (sessions) => sessions.busy(card.threadId)),
      (busy) => !busy,
    )
    return { projectId: project.projectId, taskId: card.taskId, threadId: card.threadId }
  })

const workspaceOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ kind: string | null; path: string; branch: string; movingTo: string | null; returnsTo: string | null }>`
      SELECT kind, path, branch, moving_to, returns_to FROM workspaces WHERE task_id = ${taskId}`
    return row ?? assert.fail('no workspace')
  })

const notices = (threadId: string) =>
  Effect.map(items(threadId), (all) => all.flatMap((item) => (item.kind === 'notice' ? [String(item.content.title)] : [])))

const move = (taskId: string, to: 'worktree' | 'checkout', consent?: { branch: string | null; head: string }) =>
  Effect.gen(function* () {
    const runs = yield* Runs
    return yield* runs.move({
      envelope: yield* Runtime.envelope('task.move', { taskId, to }),
      taskId,
      to,
      ...(consent === undefined ? {} : { consent }),
    })
  })

describe('moving a running task', () => {
  it.live('moves to Local with what its worktree hadn’t committed, and back to a worktree, its lead carrying on afresh there', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      const before = yield* workspaceOf(task.taskId)
      assert.strictEqual(before.kind, null)
      // Something the lead left uncommitted in its worktree goes along, committed on the task's branch.
      writeFileSync(join(before.path, 'notes.txt'), 'half done\n')
      assert.deepStrictEqual(yield* move(task.taskId, 'checkout'), { kind: 'moved' })
      const local = yield* workspaceOf(task.taskId)
      assert.strictEqual(local.kind, 'checkout')
      assert.strictEqual(local.path, working)
      assert.strictEqual(local.returnsTo, 'main')
      assert.isFalse(existsSync(before.path))
      assert.strictEqual(git(working, 'rev-parse', '--abbrev-ref', 'HEAD'), before.branch)
      assert.strictEqual(git(working, 'log', '-1', '--format=%s'), 'Work in progress, as the task moved to Local')
      assert.isTrue(existsSync(join(working, 'notes.txt')))
      assert.isTrue((yield* notices(task.threadId)).some((title) => title.endsWith(`: checked out ${before.branch}`)))

      // What the person says next goes to a fresh session in the checkout, handed the work so far.
      const sessions = yield* Sessions
      const body = 'How does it look?'
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', { threadId: task.threadId, body }),
        threadId: task.threadId,
        body,
      })
      yield* until(notices(task.threadId), (said) => said.some((title) => title.endsWith('afresh in its new folder.')))
      // Its turn, after the fresh session's first, ends.
      const sql = yield* SqlClient.SqlClient
      yield* until(
        sql<{ state: string }>`
          SELECT d.state FROM turn_deliveries d JOIN turn_delivery_inputs i ON i.delivery_id = d.id
          JOIN user_inputs u ON u.id = i.user_input_id WHERE u.body = ${body}`,
        (rows) => rows.some((row) => row.state !== 'pending' && row.state !== 'delivered'),
      )

      // Back to a worktree: the checkout goes back where it was, and a worktree takes the branch. What the lead changed there it
      // commits first, as it does in the person's checkout.
      yield* until(
        Effect.flatMap(Sessions, (all) => all.busy(task.threadId)),
        (busy) => !busy,
      )
      if (git(working, 'status', '--porcelain') !== '') {
        git(working, 'add', '-A')
        git(working, ...as, 'commit', '-q', '-m', 'The lead’s edit')
      }
      assert.deepStrictEqual(yield* move(task.taskId, 'worktree'), { kind: 'moved' })
      const back = yield* workspaceOf(task.taskId)
      assert.strictEqual(back.kind, null)
      assert.notStrictEqual(back.path, working)
      assert.strictEqual(git(working, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main')
      assert.strictEqual(git(back.path, 'rev-parse', '--abbrev-ref', 'HEAD'), before.branch)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('waits out of Local while the checkout has the person’s changes, and moves once they’re committed', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      assert.deepStrictEqual(yield* move(task.taskId, 'checkout'), { kind: 'moved' })
      writeFileSync(join(working, 'Board.tsx'), 'export {}\n')
      const waits = yield* move(task.taskId, 'worktree')
      assert.deepStrictEqual(waits, { kind: 'waits', why: 'Moves to a worktree once Board.tsx is committed.' })
      assert.strictEqual((yield* workspaceOf(task.taskId)).movingTo, 'worktree')
      assert.include(yield* notices(task.threadId), 'Moves to a worktree once Board.tsx is committed.')
      // Never touched: the person's file is where they left it, uncommitted.
      assert.strictEqual(git(working, 'status', '--porcelain'), '?? Board.tsx')
      // Committed, it moves by itself.
      git(working, 'add', 'Board.tsx')
      git(working, ...as, 'commit', '-q', '-m', 'Board')
      const moved = yield* until(workspaceOf(task.taskId), (row) => row.kind === null)
      assert.strictEqual(moved.movingTo, null)
      assert.strictEqual(git(working, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('asks before taking a checkout off a branch of the person’s own, and calls a waiting move off', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      git(working, 'switch', '-q', '-c', 'my-spike')
      const asked = yield* move(task.taskId, 'checkout')
      assert.strictEqual(asked.kind, 'asks')
      if (asked.kind !== 'asks') return
      assert.strictEqual(asked.ask.branch, 'my-spike')
      assert.strictEqual((yield* workspaceOf(task.taskId)).kind, null)
      // Their word holds for the checkout as it was: switched, it carries the task's branch, and goes back to theirs after.
      assert.deepStrictEqual(yield* move(task.taskId, 'checkout', asked.seen), { kind: 'moved' })
      assert.strictEqual((yield* workspaceOf(task.taskId)).returnsTo, 'my-spike')

      // A move that waits is the person's to call off.
      writeFileSync(join(working, 'scratch.txt'), 'mine\n')
      assert.strictEqual((yield* move(task.taskId, 'worktree')).kind, 'waits')
      const runs = yield* Runs
      yield* runs.dropMove({ envelope: yield* Runtime.envelope('task.drop_move', { taskId: task.taskId }), taskId: task.taskId })
      const stays = yield* workspaceOf(task.taskId)
      assert.strictEqual(stays.movingTo, null)
      assert.strictEqual(stays.kind, 'checkout')
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})
