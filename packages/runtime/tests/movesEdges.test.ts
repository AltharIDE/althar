import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

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
import { callTool, fakeConnectors, HOST, hosted, items, runtime, until } from './support'

/*
 * The edges of moving a running task between a worktree and Local (a task is
 * a conversation plus parts, "Moving between a worktree and Local"): one
 * change at a time is Local, and one there can't be dropped or have its
 * worktree removed; a checkout with the person's
 * changes, or another task holding it, holds a move, said once for as long
 * as it holds for the same reason; and a checkout left detached goes back to
 * the commit it was on.
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
    const snapshot = yield* Effect.orDie((yield* Queries).coordinator(projectId))
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
    const sql = yield* SqlClient.SqlClient
    const [lead] = yield* sql<{ id: string }>`
      SELECT id FROM provider_sessions WHERE thread_id = ${card.threadId} ORDER BY started_at DESC LIMIT 1`
    return {
      projectId: project.projectId,
      taskId: card.taskId,
      threadId: card.threadId,
      lead: {
        role: 'lead' as const,
        projectId: project.projectId,
        threadId: card.threadId,
        sessionId: lead?.id ?? '',
        taskId: card.taskId,
      },
    }
  })

const workspacesOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{
      name: string | null
      kind: string | null
      path: string
      branch: string
      movingTo: string | null
      returnsTo: string | null
    }>`SELECT name, kind, path, branch, moving_to, returns_to FROM workspaces WHERE task_id = ${taskId} ORDER BY created_at, rowid`
  })

const changeOf = (taskId: string, name: string | null) =>
  Effect.map(workspacesOf(taskId), (all) => all.find((one) => one.name === name) ?? assert.fail(`no change ${name}`))

const notices = (threadId: string) =>
  Effect.map(items(threadId), (all) =>
    all.flatMap((item) =>
      item.kind === 'notice' ? [{ title: String(item.content.title), description: item.content.description as string | null }] : [],
    ),
  )

const move = (taskId: string, to: 'worktree' | 'checkout', change?: string) =>
  Effect.gen(function* () {
    const runs = yield* Runs
    return yield* runs.move({
      envelope: yield* Runtime.envelope('task.move', { taskId, to }),
      taskId,
      to,
      ...(change === undefined ? {} : { change }),
    })
  })

/** How many times a move was kept waiting, by what the workspaces' records say. */
const waitsKept = (taskId: string) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql<{ why: string }>`
      SELECT json_extract(e.payload, '$.why') AS why FROM record_events e JOIN workspaces w ON w.id = e.aggregate_id
      WHERE w.task_id = ${taskId} AND e.type = 'workspace.move_waits' ORDER BY e.rowid`,
  )

describe('moving one of a task’s changes', () => {
  it.live('moves one change at a time, refuses to drop it while it is Local, and frees a checkout moved on meanwhile', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      yield* callTool(task.lead, 'start_change', { name: 'Docs' })
      assert.deepStrictEqual(yield* move(task.taskId, 'checkout'), { kind: 'moved' })
      const first = yield* changeOf(task.taskId, null)
      assert.strictEqual(git(working, 'rev-parse', '--abbrev-ref', 'HEAD'), first.branch)
      // Asked again, it is there already.
      assert.deepStrictEqual(yield* move(task.taskId, 'checkout'), { kind: 'moved' })
      assert.strictEqual(
        yield* callTool(task.lead, 'remove_part', { part: 'workspace', name: first.branch, why: 'Not needed.' }),
        'the task’s first change works Local: move it to a worktree first.',
      )
      // The person moved their checkout on meanwhile: the branch is free, and a worktree takes it.
      git(working, 'switch', '-q', 'main')
      assert.deepStrictEqual(yield* move(task.taskId, 'worktree'), { kind: 'moved' })
      const back = yield* changeOf(task.taskId, null)
      assert.strictEqual(back.kind, null)
      assert.strictEqual(git(back.path, 'rev-parse', '--abbrev-ref', 'HEAD'), first.branch)
      const said = (yield* notices(task.threadId)).findLast((one) => one.title.endsWith(': carries on in a worktree'))
      assert.strictEqual(said?.description, `On ${first.branch}.`)
      assert.strictEqual(git(working, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main')
      // Local again, another change waits for it: one change at a time works Local.
      assert.deepStrictEqual(yield* move(task.taskId, 'checkout'), { kind: 'moved' })
      assert.deepStrictEqual(yield* move(task.taskId, 'checkout', 'Docs'), {
        kind: 'waits',
        why: 'Another change of this task works Local: one change at a time can.',
      })
      assert.strictEqual(git(working, 'rev-parse', '--abbrev-ref', 'HEAD'), first.branch)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('moves a change start_change made to Local, and back, as it does the task’s first', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      yield* callTool(task.lead, 'start_change', { name: 'Docs' })
      const docs = yield* changeOf(task.taskId, 'Docs')
      // A worktree as the task's first is: moved, the checkout is on its branch and its folder has gone.
      assert.deepStrictEqual(yield* move(task.taskId, 'checkout', 'Docs'), { kind: 'moved' })
      assert.strictEqual(git(working, 'rev-parse', '--abbrev-ref', 'HEAD'), docs.branch)
      assert.strictEqual((yield* changeOf(task.taskId, 'Docs')).kind, 'checkout')
      assert.isFalse(existsSync(docs.path))
      assert.deepStrictEqual(yield* move(task.taskId, 'worktree', 'Docs'), { kind: 'moved' })
      const back = yield* changeOf(task.taskId, 'Docs')
      assert.strictEqual(back.kind, null)
      assert.strictEqual(git(back.path, 'rev-parse', '--abbrev-ref', 'HEAD'), docs.branch)
      assert.strictEqual(git(working, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main')
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('a move held by the person’s checkout', () => {
  it.live('says once why it waits while that holds, again when the reason changes, and calls nothing off when nothing waits', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      const runs = yield* Runs
      // Nothing waits: nothing to call off.
      yield* runs.dropMove({ envelope: yield* Runtime.envelope('task.drop_move', { taskId: task.taskId }), taskId: task.taskId })
      assert.lengthOf(yield* waitsKept(task.taskId), 0)
      writeFileSync(join(working, 'Board.tsx'), 'export {}\n')
      writeFileSync(join(working, 'Lane.tsx'), 'export {}\n')
      const both = `Moves to Local once Board.tsx and Lane.tsx are committed in ${basename(working)}’s checkout.`
      assert.deepStrictEqual(yield* move(task.taskId, 'checkout'), { kind: 'waits', why: both })
      assert.deepStrictEqual(yield* move(task.taskId, 'checkout'), { kind: 'waits', why: both })
      assert.lengthOf(
        (yield* notices(task.threadId)).filter((one) => one.title === both),
        1,
      )
      assert.deepStrictEqual(
        (yield* waitsKept(task.taskId)).map((one) => one.why),
        [both],
      )
      // One committed, it waits for the other, and says so.
      git(working, 'add', 'Board.tsx')
      git(working, ...as, 'commit', '-q', '-m', 'Board')
      const one = `Moves to Local once Lane.tsx is committed in ${basename(working)}’s checkout.`
      assert.deepStrictEqual(yield* move(task.taskId, 'checkout'), { kind: 'waits', why: one })
      yield* until(notices(task.threadId), (said) => said.some((line) => line.title === one))
      // Both committed, it moves by itself.
      git(working, 'add', 'Lane.tsx')
      git(working, ...as, 'commit', '-q', '-m', 'Lane')
      const moved = yield* until(changeOf(task.taskId, null), (now) => now.kind === 'checkout')
      assert.isNull(moved.movingTo)
      assert.strictEqual(git(working, 'rev-parse', '--abbrev-ref', 'HEAD'), moved.branch)
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('a checkout another task holds', () => {
  it.live('holds a move to Local until that task is done with it, said in words', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      // Another task of the project's, planned and run the same way, works Local first.
      const coordinator = yield* Coordinator
      const body = 'Add a cache. [coordinator:plan] [coordinator:plan-no-review] [lead:finish] [lead:edit]'
      yield* coordinator.say({
        envelope: yield* Runtime.envelope('thread.send', { body }),
        threadId: yield* coordinator.thread(task.projectId),
        body,
        disposition: 'after_current',
      })
      const all = yield* until(
        cards(task.projectId),
        (found) => found.length === 2 && found.every((card) => card.phase === 'ready' && card.change !== null),
      )
      const other = all.find((card) => card.taskId !== task.taskId) ?? assert.fail('no other task')
      yield* until(
        Effect.flatMap(Sessions, (sessions) => sessions.busy(other.threadId)),
        (busy) => !busy,
      )
      assert.deepStrictEqual(yield* move(other.taskId, 'checkout'), { kind: 'moved' })
      const held = yield* move(task.taskId, 'checkout')
      assert.deepStrictEqual(held, {
        kind: 'waits',
        why: `Moves to Local once “${other.title}” is done with ${basename(working)}’s checkout.`,
      })
      assert.strictEqual((yield* changeOf(task.taskId, null)).movingTo, 'checkout')
      assert.strictEqual(git(working, 'rev-parse', '--abbrev-ref', 'HEAD'), (yield* changeOf(other.taskId, null)).branch)
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('a task Local from a detached checkout', () => {
  it.live('goes back to the commit the checkout was on, and its worktree can’t be removed while there', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      git(working, 'switch', '-q', '--detach')
      const was = git(working, 'rev-parse', 'HEAD')
      assert.deepStrictEqual(yield* move(task.taskId, 'checkout'), { kind: 'moved' })
      const local = yield* changeOf(task.taskId, null)
      assert.strictEqual(local.returnsTo, was)
      const said = (yield* notices(task.threadId)).findLast((one) => one.title.endsWith(`: checked out ${local.branch}`))
      assert.strictEqual(said?.description, `It was on ${was.slice(0, 7)}, and goes back when you settle this task.`)
      assert.strictEqual(
        yield* callTool(task.lead, 'remove_part', { part: 'workspace', why: 'Only reading now.' }),
        'The task works Local: move it to a worktree first.',
      )
      // The person's two files hold it there.
      writeFileSync(join(working, 'Board.tsx'), 'export {}\n')
      writeFileSync(join(working, 'Lane.tsx'), 'export {}\n')
      assert.deepStrictEqual(yield* move(task.taskId, 'worktree'), {
        kind: 'waits',
        why: 'Moves to a worktree once Board.tsx and Lane.tsx are committed.',
      })
      git(working, 'add', '-A')
      git(working, ...as, 'commit', '-q', '-m', 'Board and lane')
      // Committed, it moves by itself; the checkout goes back to the commit it was on.
      yield* until(changeOf(task.taskId, null), (now) => now.kind === null)
      assert.strictEqual(git(working, 'rev-parse', 'HEAD'), was)
      assert.strictEqual(git(working, 'rev-parse', '--abbrev-ref', 'HEAD'), 'HEAD')
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})
