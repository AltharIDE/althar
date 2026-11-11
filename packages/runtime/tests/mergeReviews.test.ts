import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { holds } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { FastLane } from '../src/fastLane'
import { Instance } from '../src/Instance'
import { LeftBehind } from '../src/LeftBehind'
import { MergeReviews } from '../src/MergeReviews'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { fakeConnectors, HOST, hosted, items, runtime, until } from './support'

/*
 * The review after a merge, in the same task (a task is a conversation plus
 * parts, "After merge, in the same task"): a small change's pull request
 * merges, the task settles, and its own reviewer reads what merged in a
 * thread of the task's, reporting in the task's thread. Nothing found is a
 * line; findings bring the task back to Needs you until the person says Fix
 * it, which hands them to the lead, or Leave it. No second task is made, and
 * settling spares the reviewer at work.
 */

const git = (cwd: string, ...args: Array<string>) => execFileSync('git', args, { cwd }).toString().trim()

const runtimeWith = (github: FakeService, options: Parameters<typeof runtime>[1] = {}) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', options, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) })),
  )

/** The host merges a pull request by squashing it: main gets one commit with its branch's change, and the branch stays as it was. */
const squashMerge = (bare: string, branch: string) => {
  const clone = mkdtempSync(join(tmpdir(), 'althar-merge-'))
  execFileSync('git', ['clone', '-q', bare, clone])
  const as = ['-c', 'user.name=Host', '-c', 'user.email=host@althar.test']
  git(clone, ...as, 'merge', '-q', '--squash', `origin/${branch}`)
  git(clone, ...as, 'commit', '-q', '-m', `Squashed ${branch}`)
  git(clone, 'push', '-q', 'origin', 'main')
}

const onGitHub = () => {
  const { working, bare } = hosted()
  const github = makeFakeService({ pushUrl: () => bare })
  github.addRepository(['meridian', 'api'])
  git(working, 'config', 'user.name', 'Fake')
  git(working, 'config', 'user.email', 'fake@althar.test')
  return { working, bare, github }
}

const cards = (projectId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const snapshot = yield* Effect.orDie(queries.coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

const BRANCH = 'althar/add-a-retry'

/** A small change whose lead did its part and whose pull request opened, its reviewer reading it only once it merges. */
const smallChange = (working: string, markers: string) =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const projects = yield* Projects
    const coordinator = yield* Coordinator
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const threadId = yield* coordinator.thread(project.projectId)
    const body = `Add a retry. [coordinator:plan] [coordinator:plan-small] [lead:finish] [lead:edit] ${markers}`
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
    const [ready] = yield* until(cards(project.projectId), (all) => all[0]?.change != null && all[0].change.state === 'open')
    const card = ready ?? assert.fail('no card')
    return { projectId: project.projectId, taskId: card.taskId, threadId: card.threadId, url: card.change?.url ?? '' }
  })

/** The host merges the task's pull request, and Althar hears it. */
const mergeIt = (bare: string, github: FakeService, taskId: string) =>
  Effect.gen(function* () {
    squashMerge(bare, BRANCH)
    github.mergeByHand(1)
    yield* (yield* Changes).refresh(taskId)
  })

const reviewOf = (url: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ state: string; findings: string; base: string | null; head: string | null }>`
      SELECT state, findings, base, head FROM merge_reviews WHERE url = ${url}`
    return row
  })

const reviewerThread = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{
      id: string
    }>`SELECT id FROM threads WHERE task_id = ${taskId} AND kind = 'step' AND node_key = 'merge_review'`
    return row?.id
  })

describe('the review after a merge, in the same task', () => {
  it.live('reads what merged in the task, and what it found brings the task back to Needs you until Leave it', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* smallChange(working, '[review:findings]')
      yield* mergeIt(bare, github, task.taskId)

      const found = yield* until(reviewOf(task.url), (row) => row?.state === 'found')
      assert.lengthOf(JSON.parse(found?.findings ?? '[]') as Array<unknown>, 1)
      // It read the merged head, from where the branch started: nothing of it was reviewed before.
      assert.isNotNull(found?.head)
      assert.isNotNull(found?.base)
      // No second task, and nothing posted on the merged pull request.
      const [tasks] = yield* sql<{ n: number }>`SELECT count(*) AS n FROM tasks`
      assert.strictEqual(tasks?.n, 1)
      const [reviews] = yield* sql<{ n: number }>`SELECT count(*) AS n FROM external_links WHERE kind = 'review'`
      assert.strictEqual(reviews?.n, 0)
      // The task merged and settled, and what the review found brings it back: Needs you, for that change.
      const [settled] = yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${task.taskId}`
      assert.strictEqual(settled?.state, 'done')
      const [card] = yield* until(cards(task.projectId), (all) => all[0]?.afterMerge?.state === 'found')
      assert.strictEqual(card?.phase, 'ready')
      assert.deepStrictEqual(card?.afterMerge, { url: task.url, words: '#1', state: 'found', findings: 1 })
      // Its report is in the task's own thread, naming the pull request it read.
      const result = (yield* items(task.threadId)).filter((item) => item.kind === 'step_result').at(-1)
      assert.deepStrictEqual((result?.content as { afterMerge?: unknown; verdict?: unknown } | undefined)?.afterMerge, {
        url: task.url,
        words: '#1',
      })
      const snapshot = yield* (yield* Queries).thread(task.threadId)
      const report = snapshot.items.findLast((item) => item.kind === 'step_result')
      assert.strictEqual(report?.kind === 'step_result' ? report.content.afterMerge?.words : undefined, '#1')
      assert.strictEqual(snapshot.task.afterMerge?.state, 'found')
      // The reviewer goes once it reported, and its copy with it.
      const reviewer = (yield* reviewerThread(task.taskId)) ?? assert.fail('no reviewer thread')
      yield* until(
        Effect.map((yield* Sessions).running(reviewer), (live) => Option.isNone(live)),
        (gone) => gone,
      )

      // Leave it: the findings close and stay in the thread, and the task is settled again.
      yield* (yield* MergeReviews).leave(task.taskId)
      assert.strictEqual((yield* reviewOf(task.url))?.state, 'left')
      const [left] = yield* until(cards(task.projectId), (all) => all[0]?.afterMerge === undefined)
      assert.strictEqual(left?.phase, 'settled')
      const notices = (yield* items(task.threadId)).filter((item) => item.kind === 'notice')
      assert.include(String((notices.at(-1)?.content as { title?: unknown } | undefined)?.title), 'Left the 1 finding after #1 merged.')
      // Nothing waits on the person any more: Leave it or Fix it again is refused, in words.
      const again = yield* Effect.exit((yield* MergeReviews).leave(task.taskId))
      assert.strictEqual(again._tag, 'Failure')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('finds nothing: a line in the thread, and the task stays settled', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* smallChange(working, '[review:pass]')
      yield* mergeIt(bare, github, task.taskId)
      yield* until(reviewOf(task.url), (row) => row?.state === 'clear')
      const [card] = yield* until(cards(task.projectId), (all) => all[0]?.phase === 'settled')
      assert.isUndefined(card?.afterMerge)
      const result = (yield* items(task.threadId)).filter((item) => item.kind === 'step_result').at(-1)
      assert.strictEqual((result?.content as { verdict?: unknown } | undefined)?.verdict, 'pass')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('recovers a merged small change whose launch stopped before its review was owed', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* smallChange(working, '[review:pass]')
      yield* mergeIt(bare, github, task.taskId)
      yield* until(reviewOf(task.url), (row) => row?.state === 'clear')
      // As if the launch stopped between hearing the merge and owing its review: the merge is read again, and it is owed.
      yield* sql`DELETE FROM merge_reviews WHERE url = ${task.url}`
      yield* (yield* FastLane).retryPendingReviews()
      yield* until(reviewOf(task.url), (row) => row?.state === 'clear')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('Fix it hands the findings to the lead as the person’s word, starting it again', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* smallChange(working, '[review:findings]')
      yield* mergeIt(bare, github, task.taskId)
      yield* until(reviewOf(task.url), (row) => row?.state === 'found')
      const sessions = yield* Sessions
      // Settled, its lead went: Fix it starts it again with the findings.
      yield* until(
        Effect.map(sessions.running(task.threadId), (live) => Option.isNone(live)),
        (gone) => gone,
      )
      const sent = yield* (yield* MergeReviews).fix(task.taskId, task.url)
      assert.strictEqual(sent.threadId, task.threadId)
      assert.strictEqual((yield* reviewOf(task.url))?.state, 'fixing')
      const [input] = yield* sql<{ body: string; author: string }>`
        SELECT i.body, a.kind AS author FROM user_inputs i JOIN actors a ON a.id = i.author_actor_id WHERE i.id = ${sent.inputId ?? ''}`
      assert.include(input?.body ?? '', 'Fix what the review after #1 merged found.')
      assert.include(input?.body ?? '', '[major]')
      assert.include(input?.body ?? '', 'README.md:1')
      assert.strictEqual(input?.author, 'person')
      // The lead takes it up in a turn, and the card no longer waits on the person for it.
      yield* (yield* MergeReviews).afterTurnOf(task.threadId, sent.inputId)
      const [delivered] = yield* sql<{ endedAt: string | null }>`
        SELECT d.ended_at FROM turn_delivery_inputs di JOIN turn_deliveries d ON d.id = di.delivery_id WHERE di.user_input_id = ${sent.inputId ?? ''}`
      assert.isNotNull(delivered?.endedAt)
      const [card] = yield* cards(task.projectId)
      assert.isUndefined(card?.afterMerge)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('runs on after the task settles: settling spares its reviewer, and a restart starts it again', () => {
    const { working, bare, github } = onGitHub()
    const place = holds()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessions = yield* Sessions
      const task = yield* smallChange(working, '[review:wait]')
      yield* mergeIt(bare, github, task.taskId)
      yield* until(reviewOf(task.url), (row) => row?.state === 'running')
      const reviewer = (yield* reviewerThread(task.taskId)) ?? assert.fail('no reviewer thread')
      yield* until(
        Effect.map(sessions.running(reviewer), (live) => Option.isSome(live) && live.value.turnRunning),
        (busy) => busy,
      )
      // The task settled as it merged; its reviewer is still at work, and the card says the review is under way.
      const [settled] = yield* until(
        sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${task.taskId}`,
        (rows) => rows[0]?.state === 'done',
      )
      assert.strictEqual(settled?.state, 'done')
      const [card] = yield* cards(task.projectId)
      assert.deepStrictEqual(card?.afterMerge?.state, 'running')
      assert.strictEqual(card?.phase, 'settled')
      // The sweep, as settling runs it, leaves it at work.
      yield* (yield* LeftBehind).sweep
      assert.isTrue(Option.isSome(yield* sessions.running(reviewer)))

      // Its reviewer lost, as by a restart: it starts again, from the start.
      yield* Effect.ignore(sessions.stop(reviewer))
      yield* until(
        Effect.map(sessions.running(reviewer), (live) => Option.isNone(live)),
        (gone) => gone,
      )
      yield* (yield* FastLane).retryPendingReviews()
      yield* until(
        Effect.map(sessions.running(reviewer), (live) => Option.isSome(live)),
        (back) => back,
      )
      assert.strictEqual((yield* reviewOf(task.url))?.state, 'running')
      place.open('[review:wait]')
    }).pipe(Effect.provide(runtimeWith(github, { holds: place })))
  })

  it.live('says in the task why it hasn’t started, once, and starts once it can', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* smallChange(working, '[review:pass]')
      // Its copy can't be made where it goes: the folder is a file.
      const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${task.taskId}`
      // Named as Althar names it, from the task's folder: by the computer's own separators, which are backslashes on Windows.
      const reviewRoot = join(workspace?.path ?? '', '..', '..', '.review')
      mkdirSync(reviewRoot, { recursive: true })
      const blocker = join(reviewRoot, `${basename(dirname(workspace?.path ?? ''))}-after-1`)
      writeFileSync(blocker, '')
      yield* mergeIt(bare, github, task.taskId)
      const owed = yield* until(
        sql<{
          state: string
          attempts: number
          message: string | null
        }>`SELECT state, attempts, message FROM merge_reviews WHERE url = ${task.url}`,
        (rows) => (rows[0]?.attempts ?? 0) > 0,
      )
      assert.strictEqual(owed[0]?.state, 'owed')
      const said = () =>
        Effect.map(items(task.threadId), (all) =>
          all.filter((item) => item.kind === 'notice' && String((item.content as { title?: unknown }).title).includes('didn’t start')),
        )
      assert.lengthOf(yield* said(), 1)
      // Tried again while it still can't: still one line.
      yield* (yield* FastLane).retryPendingReviews()
      assert.lengthOf(yield* said(), 1)
      // Once it can, it starts, and reads.
      rmSync(blocker, { force: true })
      yield* (yield* FastLane).retryPendingReviews()
      yield* until(reviewOf(task.url), (row) => row?.state === 'clear')
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})
