import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { MergeReviews } from '../src/MergeReviews'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { addItem } from '../src/threads'
import { fakeConnectors, HOST, hosted, runtime, until } from './support'

/*
 * A task whose first pull request merged, and whose review after the merge found something the person had its lead fix: the fix
 * opens as a next pull request, which says what it does and why, and its card shows the checks that run on it, as a first one's does.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', ...args], { cwd })
    .toString()
    .trim()

const runtimeWith = (github: FakeService) =>
  Queries.layer.pipe(
    Layer.provideMerge(
      runtime(
        ':memory:',
        {},
        { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1), checksAppear: Duration.minutes(1) },
      ),
    ),
  )

/** The host merges a pull request by squashing it: main gets one commit with its branch's change, and the branch stays as it was. */
const squashMerge = (bare: string, branch: string) => {
  const clone = mkdtempSync(join(tmpdir(), 'althar-merge-'))
  execFileSync('git', ['clone', '-q', bare, clone])
  git(clone, 'merge', '-q', '--squash', `origin/${branch}`)
  git(clone, 'commit', '-q', '-m', `Squashed ${branch}`)
  git(clone, 'push', '-q', 'origin', 'main')
}

const cards = (projectId: string) =>
  Effect.gen(function* () {
    const snapshot = yield* Effect.orDie((yield* Queries).coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

const FIX = 'Stop summing task timing into every snapshot'

/**
 * A small change whose pull request merged after its checks passed, its review after the merge found one thing, and the person said Fix
 * it: its lead committed its fix, and its turn is over. Nothing has shipped yet.
 */
const fixed = (working: string, bare: string, github: FakeService) =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const coordinator = yield* Coordinator
    const threadId = yield* coordinator.thread(project.projectId)
    const body = 'Add a retry. [coordinator:plan] [coordinator:plan-small] [lead:finish] [lead:edit] [review:findings]'
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
    const [ready] = yield* until(cards(project.projectId), (all) => all[0]?.change != null && all[0].change.state === 'open')
    const card = ready ?? assert.fail('no card')
    const changes = yield* Changes
    // Its checks passed, so this repository's pull requests have had checks before.
    github.setChecks(1, [{ name: 'verify', state: 'passed' }])
    squashMerge(bare, 'althar/add-a-retry')
    github.mergeByHand(1)
    yield* changes.refresh(card.taskId)
    yield* until(cards(project.projectId), (all) => all[0]?.afterMerge?.state === 'found')
    const sent = yield* (yield* MergeReviews).fix(card.taskId, card.change?.url)
    yield* (yield* MergeReviews).afterTurnOf(sent.threadId, sent.inputId)
    const sql = yield* SqlClient.SqlClient
    const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${card.taskId}`
    const path = workspace?.path ?? ''
    appendFileSync(join(path, 'timing.txt'), 'summed once\n')
    git(path, 'add', '-A')
    git(path, 'commit', '-q', '-m', FIX, '-m', 'Each snapshot added the task’s whole timing again.')
    return { projectId: project.projectId, taskId: card.taskId, threadId: card.threadId }
  })

describe('a task whose first pull request merged and whose follow-up is open with checks running', () => {
  it.live('names it for what the fix does and says why, and its card shows the checks, not Ready to accept', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    git(working, 'config', 'user.name', 'Fake')
    git(working, 'config', 'user.email', 'fake@althar.test')
    return Effect.gen(function* () {
      const task = yield* fixed(working, bare, github)
      const changes = yield* Changes
      yield* (yield* Runs).ship({ envelope: yield* Runtime.envelope('task.ship', {}), taskId: task.taskId })
      yield* until(
        Effect.sync(() => github.changes),
        (all) => all.length === 2,
      )
      const second = github.changes[1] ?? assert.fail('no second pull request')
      // The title says what the fix does, after the pull request it follows, not what the task was called.
      assert.strictEqual(second.title, `After #1: ${FIX}`)
      // The description is the finding it answers, naming the pull request it follows, and the commit: never only that Althar opened it.
      assert.include(second.body, 'The review after #1 merged found a problem in it')
      assert.include(second.body, 'README.md:1')
      assert.include(second.body, `- ${FIX}: Each snapshot added the task’s whole timing again.`)
      assert.notStrictEqual(second.body.trim(), 'Opened by [Althar](https://github.com/AltharIDE/althar).')
      // The host hasn't registered its checks when Althar first reads it: it is waited on, not ready to accept.
      yield* changes.refresh(task.taskId)
      const [waiting] = yield* cards(task.projectId)
      assert.strictEqual(waiting?.change?.number, 2)
      // Its own commits are its pull request's, not work after it: the card has no branch row beside it.
      assert.deepStrictEqual(yield* changes.unshipped(task.taskId, { kept: true }), [])
      assert.deepStrictEqual(yield* changes.unshipped(task.taskId), [])
      assert.strictEqual(waiting?.phase, 'running')
      // Twelve checks, some still running: the card shows them, of this pull request.
      github.setChecks(2, [
        ...Array.from({ length: 7 }, (_, i) => ({ name: `passed ${i}`, state: 'passed' as const })),
        ...Array.from({ length: 5 }, (_, i) => ({ name: `running ${i}`, state: 'running' as const })),
      ])
      yield* changes.refresh(task.taskId)
      const [running] = yield* until(cards(task.projectId), (all) => all[0]?.change?.checks?.outcome === 'running')
      assert.deepStrictEqual(
        [
          running?.phase,
          running?.change?.number,
          running?.change?.checks?.outcome,
          running?.change?.checks?.passed,
          running?.change?.checks?.total,
        ],
        ['running', 2, 'running', 7, 12],
      )
      // Passed, it is ready to accept, with its checks.
      github.setChecks(
        2,
        Array.from({ length: 12 }, (_, i) => ({ name: `check ${i}`, state: 'passed' as const })),
      )
      yield* changes.refresh(task.taskId)
      const [ready] = yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready')
      assert.deepStrictEqual(
        [ready?.change?.checks?.outcome, ready?.change?.checks?.passed, ready?.change?.checks?.total],
        ['passed', 12, 12],
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('opens with the title and description its lead gave with its fix', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    git(working, 'config', 'user.name', 'Fake')
    git(working, 'config', 'user.email', 'fake@althar.test')
    return Effect.gen(function* () {
      const task = yield* fixed(working, bare, github)
      const sql = yield* SqlClient.SqlClient
      const [slug] = yield* sql<{ slug: string }>`
        SELECT b.slug FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id WHERE w.task_id = ${task.taskId}`
      const [thread] = yield* sql<{ projectId: string }>`SELECT project_id FROM threads WHERE id = ${task.threadId}`
      yield* addItem({ projectId: thread?.projectId as never, threadId: task.threadId }, 'step_result', {
        step: 'implement',
        summary: 'Fixed it.',
        built: 'The usage card shows its time breakdown again.',
        title: 'Count task timing once per snapshot',
        descriptions: {
          [slug?.slug ?? '']: 'Why: #1 summed timing into every snapshot.\n\nWhat changed: it counts once.\n\nWhat stays: the card.',
        },
      })
      yield* (yield* Runs).ship({ envelope: yield* Runtime.envelope('task.ship', {}), taskId: task.taskId })
      yield* until(
        Effect.sync(() => github.changes),
        (all) => all.length === 2,
      )
      const second = github.changes[1] ?? assert.fail('no second pull request')
      assert.strictEqual(second.title, 'After #1: Count task timing once per snapshot')
      assert.include(second.body, 'Why: #1 summed timing into every snapshot.')
      assert.include(second.body, 'What stays: the card.')
      assert.notInclude(second.body, 'The review after #1 merged found')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it('still says why it exists where its lead gave a summary and what it built, but no description', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    git(working, 'config', 'user.name', 'Fake')
    git(working, 'config', 'user.email', 'fake@althar.test')
    return Effect.gen(function* () {
      const task = yield* fixed(working, bare, github)
      const sql = yield* SqlClient.SqlClient
      const [thread] = yield* sql<{ projectId: string }>`SELECT project_id FROM threads WHERE id = ${task.threadId}`
      // What the Fix it brief asks of a lead is a summary and `built`; a lead that gives no description still gets one.
      yield* addItem({ projectId: thread?.projectId as never, threadId: task.threadId }, 'step_result', {
        step: 'implement',
        summary: 'Counted the timing once per snapshot.',
        built: 'The usage card shows its time breakdown again.',
      })
      yield* (yield* Runs).ship({ envelope: yield* Runtime.envelope('task.ship', {}), taskId: task.taskId })
      yield* until(
        Effect.sync(() => github.changes),
        (all) => all.length === 2,
      )
      const second = github.changes[1] ?? assert.fail('no second pull request')
      assert.include(second.body, 'The review after #1 merged found a problem in it')
      assert.include(second.body, 'README.md:1')
      assert.include(second.body, `- ${FIX}: Each snapshot added the task’s whole timing again.`)
      assert.include(second.body, 'The usage card shows its time breakdown again.')
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})
