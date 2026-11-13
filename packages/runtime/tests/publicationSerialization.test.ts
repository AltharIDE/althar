import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { Ids } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Deferred, Duration, Effect, Fiber, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/sql'
import { vi } from 'vite-plus/test'

const gate = vi.hoisted(() => ({
  enabled: false,
  switched: false,
  followed: false,
  release: undefined as undefined | (() => void),
  waiting: undefined as undefined | Promise<void>,
}))
vi.mock('../src/git', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/git')>()
  const { Effect } = await import('effect')
  return {
    ...actual,
    gitOutcome: (cwd: string, ...args: string[]) => {
      if (gate.switched && args[0] === 'symbolic-ref') {
        gate.followed = true
      }
      return actual.gitOutcome(cwd, ...args)
    },
    git: (cwd: string, ...args: string[]) =>
      actual.git(cwd, ...args).pipe(
        Effect.flatMap((result) => {
          if (!gate.enabled || args[0] !== 'checkout' || args[1] !== '-q' || args[2] !== '-b' || args[3] !== 'althar/add-a-retry-2')
            return Effect.succeed(result)
          gate.switched = true
          return Effect.promise(() => gate.waiting!).pipe(Effect.as(result))
        }),
      ),
  }
})

import { Live } from '../src/Live'
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

/* Publication must serialize git and workspace updates with discovery of branches after a lead turn. */

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
        {
          connectors: fakeConnectors({ github }),
          listenEvery: Duration.hours(1),
          checksAppear: Duration.minutes(1),
          idle: { reports: Duration.seconds(2) },
        },
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
    const body =
      'Add a retry. [coordinator:plan] [coordinator:plan-small] [coordinator:plan-no-review] [lead:finish] [lead:edit] [review:findings]'
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
    const [ready] = yield* until(cards(project.projectId), (all) => all[0]?.change != null && all[0].change.state === 'open')
    const card = ready ?? assert.fail('no card')
    const firstSql = yield* SqlClient.SqlClient
    yield* until(
      firstSql<{ state: string }>`SELECT state FROM runs WHERE task_id=${card.taskId} ORDER BY created_at,rowid LIMIT 1`,
      (rows) => rows[0]?.state === 'succeeded',
    )
    // This fixture explicitly defers its review; a Small change label alone now keeps the normal before-Ship timing.
    yield* (yield* Runs).reshape({
      taskId: card.taskId,
      afterMerge: { key: 'review', agentId: 'codex', model: null, skipped: true },
      actorId: instance.personId,
    })
    const changes = yield* Changes
    // Its checks passed, so this repository's pull requests have had checks before.
    github.setChecks(1, [{ name: 'verify', state: 'passed' }])
    squashMerge(bare, 'althar/add-a-retry')
    github.mergeByHand(1)
    yield* changes.refresh(card.taskId)
    yield* until(cards(project.projectId), (all) => all[0]?.afterMerge?.state === 'found')
    const events = yield* Live
    const emit = events.publish.bind(events)
    let delayed: Parameters<typeof emit>[0] | undefined
    events.publish = (event) =>
      event._tag === 'TurnEnded' && event.threadId === card.threadId
        ? Effect.sync(() => {
            delayed = event
          })
        : emit(event)
    const sent = yield* (yield* MergeReviews).fix(card.taskId, card.change?.url)
    const doneSql = yield* SqlClient.SqlClient
    yield* until(
      doneSql<{
        endedAt: string | null
      }>`SELECT d.ended_at FROM turn_delivery_inputs di JOIN turn_deliveries d ON d.id=di.delivery_id WHERE di.user_input_id=${sent.inputId} ORDER BY d.requested_at DESC LIMIT 1`,
      (rows) => rows[0]?.endedAt != null,
    )
    yield* until(
      Effect.sync(() => delayed),
      (event) => event !== undefined,
    )
    events.publish = emit
    const sql = yield* SqlClient.SqlClient
    const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${card.taskId}`
    const path = workspace?.path ?? ''
    appendFileSync(join(path, 'timing.txt'), 'summed once\n')
    git(path, 'add', '-A')
    git(path, 'commit', '-q', '-m', FIX, '-m', 'Each snapshot added the task’s whole timing again.')
    return { projectId: project.projectId, taskId: card.taskId, threadId: card.threadId, path, deliverTurn: emit(delayed!) }
  })

describe('publication and branch discovery share the task git lock', () => {
  it.live('keeps a delayed original turn from discovering the fresh branch before its workspace is updated', () => {
    gate.enabled = false
    gate.switched = false
    gate.followed = false
    gate.release = undefined
    gate.waiting = undefined
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
      yield* addItem({ projectId: Schema.decodeUnknownSync(Ids.project.schema)(task.projectId), threadId: task.threadId }, 'step_result', {
        step: 'implement',
        summary: 'Fixed it.',
        built: 'The usage card shows its time breakdown again.',
        title: 'Count task timing once per snapshot',
        descriptions: {
          [slug?.slug ?? '']: 'Why: #1 summed timing into every snapshot.\n\nWhat changed: it counts once.\n\nWhat stays: the card.',
        },
      })
      gate.enabled = true
      gate.waiting = new Promise<void>((resolve) => {
        gate.release = resolve
      })
      yield* (yield* Runs).ship({ envelope: yield* Runtime.envelope('task.ship', {}), taskId: task.taskId })
      yield* until(
        Effect.sync(() => gate.switched),
        (value) => value,
      )
      yield* task.deliverTurn
      const probeStarted = yield* Deferred.make<void>()
      let probeAcquired = false
      const probe = yield* Effect.forkChild(
        Effect.andThen(
          Deferred.succeed(probeStarted, undefined),
          (yield* Changes).exclusive(
            task.taskId,
            Effect.sync(() => {
              probeAcquired = true
            }),
          ),
        ),
      )
      yield* Deferred.await(probeStarted)
      yield* Effect.yieldNow
      assert.isFalse(probeAcquired, 'publication owns task git mutex while checkout and workspace row disagree')
      gate.release!()
      yield* Fiber.join(probe)
      const progress = yield* until(
        Effect.gen(function* () {
          return {
            changes: github.changes.length,
            runs: yield* sql`SELECT id,state,parameters FROM runs WHERE task_id=${task.taskId} ORDER BY created_at,rowid`,
            attention: yield* sql`SELECT kind,payload,state FROM attention_requests WHERE task_id=${task.taskId} AND state='open'`,
            workspaces: yield* sql`SELECT path,branch,held_at FROM workspaces WHERE task_id=${task.taskId}`,
          }
        }),
        (value) => value.changes === 2 || value.attention.length > 0 || value.runs.at(-1)?.state === 'succeeded',
      )
      assert.strictEqual(progress.changes, 2, JSON.stringify(progress))
      yield* until(
        sql<{ state: string }>`SELECT state FROM runs WHERE task_id=${task.taskId} ORDER BY created_at DESC,rowid DESC LIMIT 1`,
        (rows) => rows[0]?.state === 'succeeded',
      )
      yield* until(
        Effect.sync(() => gate.followed),
        (value) => value,
      )
      yield* (yield* Changes).exclusive(task.taskId, Effect.void)
      const afterFollower = yield* sql`SELECT id,branch,state FROM workspaces WHERE task_id=${task.taskId}`
      assert.lengthOf(afterFollower, 1, JSON.stringify(afterFollower))
      assert.strictEqual(afterFollower[0]?.branch, 'althar/add-a-retry-2')
      assert.strictEqual(afterFollower[0]?.state, 'ready')
      const second = github.changes[1] ?? assert.fail('no second pull request')
      assert.strictEqual(second.title, 'After #1: Count task timing once per snapshot')
      assert.include(second.body, 'Why: #1 summed timing into every snapshot.')
      assert.include(second.body, 'What stays: the card.')
      assert.notInclude(second.body, 'The review after #1 merged found')
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          gate.release?.()
          gate.enabled = false
          gate.release = undefined
          gate.waiting = undefined
        }),
      ),
      Effect.provide(runtimeWith(github)),
    )
  })
})
