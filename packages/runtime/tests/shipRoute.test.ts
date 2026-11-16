import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { MergeRules } from '@althar/connectors'
import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import type { ShipRoute } from '@althar/contracts'
import type { Holds } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Deferred, Duration, Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { ShipRefused } from '../src/errors'
import { Instance } from '../src/Instance'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { approvalShort, routeOf, routeOfShip, setShipRoute, shipStopOf, shipUnderWayOf, taskShipRoute } from '../src/shipRoute'
import { callTool, fakeConnectors, HOST, hosted, items, notices, runtime, until } from './support'

/*
 * A Ship's route (a task is a conversation plus parts, "Ship"): whether its
 * review comes first, and how far it goes. As far as a push leaves a draft a
 * draft; ready for review marks an open draft ready and opens a new one ready;
 * merge goes on to merge once the checks its target requires pass, under way
 * at its merge stop until then. RouteShip changes it while the Ship goes, and
 * without one chosen a Ship takes the task's own (`TaskView.shipRoute`).
 */

const git = (cwd: string, ...args: Array<string>) => execFileSync('git', args, { cwd }).toString().trim()

const BRANCH = 'althar/add-a-retry'

/** The host merges a pull request by squashing it: main gets one commit with its branch's change. */
const squashMerge = (bare: string, branch: string) => {
  const clone = mkdtempSync(join(tmpdir(), 'althar-merge-'))
  execFileSync('git', ['clone', '-q', bare, clone])
  const as = ['-c', 'user.name=Host', '-c', 'user.email=host@althar.test']
  git(clone, ...as, 'merge', '-q', '--squash', `origin/${branch}`)
  git(clone, ...as, 'commit', '-q', '-m', `Squashed ${branch}`)
  git(clone, 'push', '-q', 'origin', 'main')
}

/** Main moves on by two commits someone else made, fetched where the task works: a merge of it brings only main in. */
const mainMovesOn = (bare: string, path: string) => {
  const clone = mkdtempSync(join(tmpdir(), 'althar-main-'))
  execFileSync('git', ['clone', '-q', bare, clone])
  for (const [file, message] of [
    ['usage.ts', 'Usage card drops the time breakdown (#763)'],
    ['timing.ts', 'Stop summing task timing (#767)'],
  ] as const) {
    writeFileSync(join(clone, file), `${file}\n`)
    git(clone, 'add', '-A')
    git(clone, '-c', 'user.name=Other', '-c', 'user.email=other@althar.test', 'commit', '-q', '-m', message)
  }
  git(clone, 'push', '-q', 'origin', 'main')
  git(path, 'fetch', '-q', bare, '+main:refs/remotes/origin/main')
}

/** A repository on the fake GitHub, its lead committing as the person does. */
const onGitHub = (more: Omit<Parameters<typeof makeFakeService>[0] & object, 'pushUrl'> = {}) => {
  const { working, bare } = hosted()
  const github = makeFakeService({ pushUrl: () => bare, ...more })
  github.addRepository(['meridian', 'api'])
  git(working, 'config', 'user.name', 'Fake')
  git(working, 'config', 'user.email', 'fake@althar.test')
  return { working, bare, github }
}

/** Its required checks, by name, as the host says them; nothing else asked of a merge. */
const requires = (...checks: ReadonlyArray<string>) => ({ rulesOf: (): MergeRules => ({ requiredChecks: checks, needs: [] }) })

/** A runtime whose Ship waiting to merge looks at its checks again every tenth of a second. */
const withHost = (github: FakeService, held?: Holds) =>
  Queries.layer.pipe(
    Layer.provideMerge(
      runtime(':memory:', held === undefined ? {} : { holds: held }, {
        connectors: fakeConnectors({ github }),
        listenEvery: Duration.hours(1),
        externalWaitEvery: Duration.millis(100),
      }),
    ),
  )

const cards = (projectId: string) =>
  Effect.gen(function* () {
    const snapshot = yield* Effect.orDie((yield* Queries).coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

const idle = (threadId: string) =>
  until(
    Effect.flatMap(Sessions, (sessions) => sessions.busy(threadId)),
    (busy) => !busy,
  )

/**
 * A planned task whose lead did its part and whose draft pull request opened, reviewed as `markers` say: ready. In a project
 * that ends its tasks on their branch (`ends`), it opens none.
 */
const opened = (working: string, markers = '[review:pass]', ends?: 'none') =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    if (ends !== undefined) yield* (yield* Policies).set(project.projectId, { end: ends }, instance.personId)
    const coordinator = yield* Coordinator
    const threadId = yield* coordinator.thread(project.projectId)
    const body = `Add a retry. [coordinator:plan] [lead:finish] [lead:edit] ${markers}`
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
    const [ready] = yield* until(
      cards(project.projectId),
      (all) => all[0]?.phase === 'ready' && (ends !== undefined || all[0].change !== null),
    )
    const card = ready ?? assert.fail('no card')
    yield* idle(card.threadId)
    const sql = yield* SqlClient.SqlClient
    const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${card.taskId}`
    const [turns] = yield* sql<{ n: number }>`SELECT count(*) AS n FROM turn_deliveries WHERE thread_id = ${card.threadId}`
    return { projectId: project.projectId, taskId: card.taskId, threadId: card.threadId, path: workspace?.path ?? '', turns: turns?.n ?? 0 }
  })

/** A commit on the task's branch, as the person makes one by hand: it waits for Ship, ahead of its pull request. */
const commitIn = (path: string, message: string) => {
  appendFileSync(join(path, 'retry.txt'), `${message}\n`)
  git(path, 'add', '-A')
  git(path, 'commit', '-q', '-m', message)
}

/** What the person says to the task's lead, as the task's screen says it. */
const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    const live = Option.isSome(yield* sessions.running(threadId))
    yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { threadId, body }), threadId, body })
    if (!live) yield* Effect.ignore(sessions.startLast(threadId))
  })

const heldAt = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ heldAt: string | null }>`SELECT held_at FROM workspaces WHERE task_id = ${taskId}`
    return row?.heldAt ?? null
  })

const ship = (taskId: string, route?: ShipRoute) =>
  Effect.gen(function* () {
    yield* (yield* Runs).ship({
      envelope: yield* Runtime.envelope('task.ship', { taskId }),
      taskId,
      ...(route === undefined ? {} : { route }),
    })
  })

const routeShip = (taskId: string, route: ShipRoute) =>
  Effect.gen(function* () {
    yield* (yield* Runs).routeShip({ envelope: yield* Runtime.envelope('task.route_ship', { taskId, route }), taskId, route })
  })

/** The task as its screen reads it. */
const header = (threadId: string) =>
  Effect.map(
    Effect.flatMap(Queries, (queries) => queries.thread(threadId)),
    (thread) => thread.task,
  )

/** The task's Ship runs, oldest first. */
const shipRuns = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ state: string; parameters: string }>`
      SELECT state, parameters FROM runs WHERE task_id = ${taskId} AND json_type(parameters, '$.ships') = 'object'
      ORDER BY created_at, rowid`
  })

/** Its Ship is over: its run, the latest, ended. */
const shipped = (taskId: string, count = 1) => until(shipRuns(taskId), (all) => all.length === count && all.at(-1)?.state === 'succeeded')

const stepsSaid = (threadId: string) =>
  Effect.map(items(threadId), (all) => all.filter((item) => item.kind === 'step_result').map((item) => item.content['step']))

const titles = (threadId: string) => Effect.map(notices(threadId), (all) => all.map((one) => one['title'] ?? ''))

/** Its branch here and on the host are the same, and moved on from `pushed`: what waited went up. */
const wentUp = (bare: string, path: string, pushed: string) =>
  until(
    Effect.sync(() => [git(bare, 'rev-parse', BRANCH), git(path, 'rev-parse', 'HEAD')] as const),
    ([there, here]) => there === here && there !== pushed,
  )

/** Whether a review of the Ship's was asked for: its reviewer's brief for what came since the last. */
const shipReviewed = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const asked = yield* sql<{ id: string }>`
      SELECT i.id FROM user_inputs i JOIN threads t ON t.id = i.thread_id
      WHERE t.task_id = ${taskId} AND t.kind = 'step' AND i.body LIKE 'More to review. The person ships%'`
    return asked.length > 0
  })

describe('how far a Ship goes', () => {
  it.live('with its review off, sends what waits at once, owes no review after, and as far as a push leaves a draft a draft', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working)
      const pushed = git(bare, 'rev-parse', BRANCH)
      commitIn(task.path, 'Retry twice')
      yield* ship(task.taskId, { review: false, far: 'push' })
      yield* wentUp(bare, task.path, pushed)
      yield* shipped(task.taskId)
      // No review read it, before or owed after: the plan's own result, then what this Ship sent up.
      assert.isFalse(yield* shipReviewed(task.taskId))
      assert.deepStrictEqual(yield* stepsSaid(task.threadId), ['implement', 'review', 'publish', 'publish'])
      const [owed] = yield* sql<{ n: number }>`SELECT count(*) AS n FROM merge_reviews WHERE task_id = ${task.taskId}`
      assert.strictEqual(owed?.n, 0)
      // Its route is kept on its run, and its draft is still one: nothing marked it ready, nothing merged.
      assert.deepStrictEqual(JSON.parse((yield* shipRuns(task.taskId))[0]?.parameters ?? '{}').ships?.route, {
        review: false,
        far: 'push',
      })
      assert.isTrue(github.changes[0]?.draft)
      assert.notInclude(github.calls, 'markReady')
      assert.lengthOf(github.merged, 0)
      assert.isUndefined((yield* header(task.threadId)).shipping)
    }).pipe(Effect.provide(withHost(github)))
  })

  it.live('ready for review marks the open draft ready, and opens the next pull request ready', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working, '[coordinator:plan-no-review]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      assert.isTrue(github.changes[0]?.draft)
      commitIn(task.path, 'Retry twice')
      yield* ship(task.taskId, { review: true, far: 'ready' })
      yield* wentUp(bare, task.path, pushed)
      yield* shipped(task.taskId)
      assert.isFalse(github.changes[0]?.draft)
      assert.lengthOf(github.merged, 0)

      // Merged on the host, its next work opens the next pull request: ready for review, not a draft.
      squashMerge(bare, BRANCH)
      github.mergeByHand(1)
      yield* (yield* Changes).refresh(task.taskId)
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'settled')
      commitIn(task.path, 'Log each retry')
      yield* ship(task.taskId, { review: true, far: 'ready' })
      yield* until(
        Effect.sync(() => github.changes.length),
        (count) => count === 2,
      )
      yield* shipped(task.taskId, 2)
      assert.deepStrictEqual([github.changes[1]?.source, github.changes[1]?.draft], [`${BRANCH}-2`, false])
    }).pipe(Effect.provide(withHost(github)))
  })

  it.live('opens nothing for a task that ends on its branch, whatever its route', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working, '[coordinator:plan-no-review]', 'none')
      commitIn(task.path, 'Retry twice')
      yield* ship(task.taskId, { review: true, far: 'ready' })
      yield* shipped(task.taskId)
      assert.strictEqual(git(bare, 'rev-parse', BRANCH), git(task.path, 'rev-parse', 'HEAD'))
      assert.lengthOf(github.changes, 0)
    }).pipe(Effect.provide(withHost(github)))
  })

  it.live('to merge merges once what waited is up, its optional checks still running', () => {
    const { working, bare, github } = onGitHub(requires('test'))
    return Effect.gen(function* () {
      const task = yield* opened(working, '[coordinator:plan-no-review]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      // Main requires test, which passed; lint, which it doesn't require, still runs.
      github.setChecks(1, [
        { name: 'test', state: 'passed' },
        { name: 'lint', state: 'running' },
      ])
      commitIn(task.path, 'Retry twice')
      yield* ship(task.taskId, { review: false, far: 'merge' })
      yield* wentUp(bare, task.path, pushed)
      yield* shipped(task.taskId)
      assert.deepStrictEqual(
        github.merged.map((one) => [one.number, one.how]),
        [[1, 'merge']],
      )
      assert.isFalse(github.changes[0]?.draft)
    }).pipe(Effect.provide(withHost(github)))
  })

  it.live('to merge waits, under way at its merge stop, on a required check still running, and merges once it passes', () => {
    const { working, bare, github } = onGitHub(requires('test'))
    return Effect.gen(function* () {
      const task = yield* opened(working, '[coordinator:plan-no-review]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      github.setChecks(1, [{ name: 'test', state: 'running' }])
      // What the person's turn committed waits for Ship: its card offers it, with no review, the plan having no reviewer.
      yield* say(task.threadId, 'Make it retry twice. tidy pls [lead:commit]')
      yield* until(heldAt(task.taskId), (at) => at !== null)
      const [offered] = yield* until(
        Effect.map(header(task.threadId), (seen) => [seen.shipRoute] as const),
        ([route]) => route !== undefined,
      )
      assert.deepStrictEqual(offered, { route: { review: false, far: 'push' }, reviewable: false, bent: null })
      yield* idle(task.threadId)

      yield* ship(task.taskId, { review: false, far: 'merge' })
      yield* wentUp(bare, task.path, pushed)
      const [waiting] = yield* until(
        Effect.map(header(task.threadId), (seen) => [seen.shipping] as const),
        ([shipping]) => shipping?.at === 'merge',
      )
      assert.deepStrictEqual(waiting, { route: { review: false, far: 'merge' }, at: 'merge' })
      yield* until(titles(task.threadId), (all) => all.includes('PR #1 merges once test passes, as main requires.'))
      // Its card says the stop, not the opening of a pull request.
      const [card] = yield* cards(task.projectId)
      assert.strictEqual(card?.step, 'publish')
      assert.strictEqual(card?.shipAt, 'merge')
      // Waiting, it stays under way, ready for review and not merged.
      assert.lengthOf(github.merged, 0)
      assert.isFalse(github.changes[0]?.draft)
      assert.strictEqual((yield* shipRuns(task.taskId))[0]?.state, 'running')

      github.setChecks(1, [{ name: 'test', state: 'passed' }])
      yield* shipped(task.taskId)
      assert.deepStrictEqual(
        github.merged.map((one) => one.number),
        [1],
      )
      assert.isUndefined((yield* header(task.threadId)).shipping)
      assert.isUndefined((yield* cards(task.projectId))[0]?.shipAt)
    }).pipe(Effect.provide(withHost(github)))
  })

  it.live('to merge doesn’t once a required check fails: it ends ready for review, saying why', () => {
    const { working, bare, github } = onGitHub(requires('test'))
    return Effect.gen(function* () {
      const task = yield* opened(working, '[coordinator:plan-no-review]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      github.setChecks(1, [{ name: 'test', state: 'running' }])
      commitIn(task.path, 'Retry twice')
      yield* ship(task.taskId, { review: false, far: 'merge' })
      yield* wentUp(bare, task.path, pushed)
      yield* until(header(task.threadId), (seen) => seen.shipping?.at === 'merge')
      github.setChecks(1, [{ name: 'test', state: 'failed' }])
      yield* shipped(task.taskId)
      assert.lengthOf(github.merged, 0)
      assert.isFalse(github.changes[0]?.draft)
      assert.include(yield* titles(task.threadId), 'Not merged: test failed on PR #1, so it stays ready for review.')
    }).pipe(Effect.provide(withHost(github)))
  })

  it.live('waiting to merge, goes no further once its route goes back to ready', () => {
    const { working, bare, github } = onGitHub(requires('test'))
    return Effect.gen(function* () {
      const task = yield* opened(working, '[coordinator:plan-no-review]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      github.setChecks(1, [{ name: 'test', state: 'running' }])
      commitIn(task.path, 'Retry twice')
      yield* ship(task.taskId, { review: false, far: 'merge' })
      yield* wentUp(bare, task.path, pushed)
      yield* until(header(task.threadId), (seen) => seen.shipping?.at === 'merge')
      // Back to a push, once it is ready: it can't be a draft again, so it ends ready.
      yield* routeShip(task.taskId, { review: false, far: 'push' })
      assert.deepStrictEqual(JSON.parse((yield* shipRuns(task.taskId))[0]?.parameters ?? '{}').ships?.route, {
        review: false,
        far: 'ready',
      })
      yield* shipped(task.taskId)
      github.setChecks(1, [{ name: 'test', state: 'passed' }])
      assert.lengthOf(github.merged, 0)
      assert.isFalse(github.changes[0]?.draft)
      assert.include(yield* titles(task.threadId), 'Not merged: the Ship goes as far as ready for review now.')
      // With no Ship under way, there is no route to change.
      const refused = yield* Effect.flip(routeShip(task.taskId, { review: true, far: 'merge' }))
      assert.instanceOf(refused, ShipRefused)
      assert.strictEqual((refused as ShipRefused).why, 'not_shipping')
    }).pipe(Effect.provide(withHost(github)))
  })
})

describe('a Ship at its stops past its push, where its host says otherwise', () => {
  it.live('says why where its host refuses the merge, and is over at ready', () => {
    const { working, bare, github } = onGitHub(requires('test'))
    return Effect.gen(function* () {
      const task = yield* opened(working, '[coordinator:plan-no-review]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      github.setChecks(1, [{ name: 'test', state: 'passed' }])
      github.failNext('merge', 'rejected', undefined, 405, { message: 'Base branch was modified. Review and try the merge again.' })
      commitIn(task.path, 'Retry twice')
      yield* ship(task.taskId, { review: false, far: 'merge' })
      yield* wentUp(bare, task.path, pushed)
      yield* shipped(task.taskId)
      assert.lengthOf(github.merged, 0)
      assert.isFalse(github.changes[0]?.draft)
      assert.isTrue((yield* titles(task.threadId)).some((one) => one.startsWith('Shipped, but not merged: ')))
    }).pipe(Effect.provide(withHost(github)))
  })

  it.live('waits on each required check by name, and is over once its pull request merged on the host meanwhile', () => {
    const { working, bare, github } = onGitHub(requires('test', 'lint'))
    return Effect.gen(function* () {
      const task = yield* opened(working, '[coordinator:plan-no-review]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      github.setChecks(1, [
        { name: 'test', state: 'running' },
        { name: 'lint', state: 'running' },
      ])
      commitIn(task.path, 'Retry twice')
      yield* ship(task.taskId, { review: false, far: 'merge' })
      yield* wentUp(bare, task.path, pushed)
      yield* until(titles(task.threadId), (all) =>
        all.some((one) => /^PR #1 merges once (test, lint|lint, test) pass, as main requires\.$/.test(one)),
      )
      // Someone merges it on the host while it waits: Ship has nothing left to merge.
      squashMerge(bare, BRANCH)
      github.mergeByHand(1)
      yield* shipped(task.taskId)
      assert.notInclude(github.calls, 'merge')
      assert.isUndefined((yield* header(task.threadId)).shipping)
    }).pipe(Effect.provide(withHost(github)))
  })

  it.live('merges as it stands where its host can’t say how its checks went while it waits, having said its wait once', () => {
    const { working, bare, github } = onGitHub(requires('test'))
    const looks = () => github.calls.filter((one) => one === 'checks').length
    return Effect.gen(function* () {
      const task = yield* opened(working, '[coordinator:plan-no-review]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      github.setChecks(1, [{ name: 'test', state: 'running' }])
      commitIn(task.path, 'Retry twice')
      yield* ship(task.taskId, { review: false, far: 'merge' })
      yield* wentUp(bare, task.path, pushed)
      yield* until(titles(task.threadId), (all) => all.includes('PR #1 merges once test passes, as main requires.'))
      // It looks again, still waiting; then its host can't say.
      const looked = looks()
      yield* until(Effect.sync(looks), (count) => count >= looked + 2)
      github.failNext('checks', 'forbidden')
      yield* shipped(task.taskId)
      assert.deepStrictEqual(
        github.merged.map((one) => one.number),
        [1],
      )
      assert.lengthOf(
        (yield* titles(task.threadId)).filter((one) => one.startsWith('PR #1 merges once')),
        1,
      )
    }).pipe(Effect.provide(withHost(github)))
  })

  it.live('waits on the checks its target requires though none has started, and merges once they pass', () => {
    const { working, bare, github } = onGitHub({ rulesOf: (): MergeRules => ({ requiredChecks: 'all', needs: [] }) })
    return Effect.gen(function* () {
      const task = yield* opened(working, '[coordinator:plan-no-review]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      github.setChecks(1, [])
      commitIn(task.path, 'Retry twice')
      yield* ship(task.taskId, { review: false, far: 'merge' })
      yield* wentUp(bare, task.path, pushed)
      yield* until(titles(task.threadId), (all) => all.includes('PR #1 merges once the checks pass, as main requires.'))
      github.setChecks(1, [{ name: 'test', state: 'passed' }])
      yield* shipped(task.taskId)
      assert.deepStrictEqual(
        github.merged.map((one) => one.number),
        [1],
      )
    }).pipe(Effect.provide(withHost(github)))
  })

  it.live('waits after all where its host refuses the merge as a required check runs again, and merges once it passes', () => {
    let reruns = true
    const { working, bare, github } = onGitHub({
      ...requires('test'),
      // As the merge reaches the host, its required check starts again: the host refuses it.
      waitsFor: (method) =>
        method === 'merge' && reruns
          ? Effect.sync(() => {
              reruns = false
              github.setChecks(1, [{ name: 'test', state: 'running' }])
            })
          : Effect.void,
    })
    return Effect.gen(function* () {
      const task = yield* opened(working, '[coordinator:plan-no-review]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      github.setChecks(1, [{ name: 'test', state: 'passed' }])
      github.failNext('merge', 'rejected', undefined, 405, { message: 'Required status check "test" is expected.' })
      commitIn(task.path, 'Retry twice')
      yield* ship(task.taskId, { review: false, far: 'merge' })
      yield* wentUp(bare, task.path, pushed)
      yield* until(titles(task.threadId), (all) => all.includes('PR #1 merges once test passes, as main requires.'))
      github.setChecks(1, [{ name: 'test', state: 'passed' }])
      yield* shipped(task.taskId)
      assert.deepStrictEqual(
        github.merged.map((one) => one.number),
        [1],
      )
      assert.isFalse((yield* titles(task.threadId)).some((one) => one.startsWith('Shipped, but not merged')))
    }).pipe(Effect.provide(withHost(github)))
  })

  it.live('puts it in its branch’s merge queue at once, which waits for the checks itself', () => {
    const { working, bare, github } = onGitHub(requires('test'))
    return Effect.gen(function* () {
      const task = yield* opened(working, '[coordinator:plan-no-review]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      github.mergeQueue()
      github.setChecks(1, [{ name: 'test', state: 'running' }])
      commitIn(task.path, 'Retry twice')
      yield* ship(task.taskId, { review: false, far: 'merge' })
      yield* wentUp(bare, task.path, pushed)
      yield* shipped(task.taskId)
      assert.deepStrictEqual(
        github.merged.map((one) => [one.number, one.how]),
        [[1, 'queue']],
      )
      assert.isFalse((yield* titles(task.threadId)).some((one) => one.startsWith('PR #1 merges once')))
    }).pipe(Effect.provide(withHost(github)))
  })

  it.live('says a draft its host won’t mark ready, and is over', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working, '[coordinator:plan-no-review]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      github.failNext('markReady', 'rejected', undefined, 422, { message: 'This pull request can’t be marked ready now.' })
      commitIn(task.path, 'Retry twice')
      yield* ship(task.taskId, { review: false, far: 'ready' })
      yield* wentUp(bare, task.path, pushed)
      yield* shipped(task.taskId)
      assert.isTrue(github.changes[0]?.draft)
      assert.isTrue((yield* titles(task.threadId)).some((one) => one.startsWith('Shipped, but PR #1 is still a draft: ')))
    }).pipe(Effect.provide(withHost(github)))
  })

  it.live('sends what only brings main in as it is, then marks its draft ready as its route goes', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working, '[coordinator:plan-no-review]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      mainMovesOn(bare, task.path)
      git(task.path, '-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', 'merge', '-q', '--no-edit', 'origin/main')
      // Held for Ship, as the person's commits are.
      yield* sql`UPDATE workspaces SET held_at = ${new Date().toISOString()} WHERE task_id = ${task.taskId}`
      yield* ship(task.taskId, { review: false, far: 'ready' })
      yield* wentUp(bare, task.path, pushed)
      yield* until(
        Effect.sync(() => github.changes[0]?.draft),
        (draft) => draft === false,
      )
      // No Ship of its own: what went up is none of the task's work.
      assert.lengthOf(yield* shipRuns(task.taskId), 0)
      assert.lengthOf(github.merged, 0)
    }).pipe(Effect.provide(withHost(github)))
  })

  it.live('sends what only brings main in as it is, then merges as its route goes', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working, '[coordinator:plan-no-review]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      mainMovesOn(bare, task.path)
      git(task.path, '-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', 'merge', '-q', '--no-edit', 'origin/main')
      yield* sql`UPDATE workspaces SET held_at = ${new Date().toISOString()} WHERE task_id = ${task.taskId}`
      yield* ship(task.taskId, { review: false, far: 'merge' })
      yield* wentUp(bare, task.path, pushed)
      yield* until(
        Effect.sync(() => github.merged.map((one) => one.number)),
        (merged) => merged.length === 1,
      )
      assert.lengthOf(yield* shipRuns(task.taskId), 0)
    }).pipe(Effect.provide(withHost(github)))
  })
})

describe('changing a Ship’s route at its merge stop, against its host', () => {
  it.live('sends no merge where its route goes back to ready as its merge stop first reads the host', () => {
    const gate = Deferred.makeUnsafe<void>()
    const reading = Deferred.makeUnsafe<void>()
    let holds = false
    const { working, bare, github } = onGitHub({
      ...requires('test'),
      // Its merge stop's first look at the checks, the Ship's first, is held.
      waitsFor: (method) => {
        if (method !== 'checks' || !holds) return Effect.void
        holds = false
        return Effect.andThen(Deferred.succeed(reading, undefined), Deferred.await(gate))
      },
    })
    return Effect.gen(function* () {
      const task = yield* opened(working, '[coordinator:plan-no-review]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      github.setChecks(1, [{ name: 'test', state: 'passed' }])
      commitIn(task.path, 'Retry twice')
      holds = true
      yield* ship(task.taskId, { review: false, far: 'merge' })
      yield* Deferred.await(reading)
      yield* routeShip(task.taskId, { review: false, far: 'ready' })
      yield* Deferred.succeed(gate, undefined)
      yield* wentUp(bare, task.path, pushed)
      yield* shipped(task.taskId)
      assert.notInclude(github.calls, 'merge')
      assert.isFalse(github.changes[0]?.draft)
      assert.include(yield* titles(task.threadId), 'Not merged: the Ship goes as far as ready for review now.')
    }).pipe(Effect.provide(withHost(github)))
  })

  it.live('sends no merge where its route goes back to ready while it reads the host, its checks then passing', () => {
    const gate = Deferred.makeUnsafe<void>()
    const reading = Deferred.makeUnsafe<void>()
    let holds = false
    const { working, bare, github } = onGitHub({
      ...requires('test'),
      waitsFor: (method) =>
        method === 'checks' && holds ? Effect.andThen(Deferred.succeed(reading, undefined), Deferred.await(gate)) : Effect.void,
    })
    return Effect.gen(function* () {
      const task = yield* opened(working, '[coordinator:plan-no-review]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      github.setChecks(1, [{ name: 'test', state: 'running' }])
      commitIn(task.path, 'Retry twice')
      yield* ship(task.taskId, { review: false, far: 'merge' })
      yield* wentUp(bare, task.path, pushed)
      yield* until(titles(task.threadId), (all) => all.includes('PR #1 merges once test passes, as main requires.'))
      // Its next look at the host is held on reading the checks, which pass meanwhile; the person takes it back to ready.
      holds = true
      github.setChecks(1, [{ name: 'test', state: 'passed' }])
      yield* Deferred.await(reading)
      yield* routeShip(task.taskId, { review: false, far: 'ready' })
      holds = false
      yield* Deferred.succeed(gate, undefined)
      yield* shipped(task.taskId)
      assert.lengthOf(github.merged, 0)
      assert.notInclude(github.calls, 'merge')
      assert.strictEqual(github.changes[0]?.state, 'open')
      assert.include(yield* titles(task.threadId), 'Not merged: the Ship goes as far as ready for review now.')
    }).pipe(Effect.provide(withHost(github)))
  })

  it.live('refuses to go back to ready once its merge went to the host, and merges', () => {
    const gate = Deferred.makeUnsafe<void>()
    const merging = Deferred.makeUnsafe<void>()
    const { working, bare, github } = onGitHub({
      ...requires('test'),
      waitsFor: (method) => (method === 'merge' ? Effect.andThen(Deferred.succeed(merging, undefined), Deferred.await(gate)) : Effect.void),
    })
    return Effect.gen(function* () {
      const task = yield* opened(working, '[coordinator:plan-no-review]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      github.setChecks(1, [{ name: 'test', state: 'running' }])
      commitIn(task.path, 'Retry twice')
      yield* ship(task.taskId, { review: false, far: 'merge' })
      yield* wentUp(bare, task.path, pushed)
      yield* until(header(task.threadId), (seen) => seen.shipping?.at === 'merge')
      github.setChecks(1, [{ name: 'test', state: 'passed' }])
      // Its merge is on its way to the host: that can't be called back, so the route stays, and says why.
      yield* Deferred.await(merging)
      const refused = yield* Effect.flip(routeShip(task.taskId, { review: false, far: 'ready' }))
      assert.instanceOf(refused, ShipRefused)
      assert.strictEqual((refused as ShipRefused).why, 'merging')
      assert.strictEqual(JSON.parse((yield* shipRuns(task.taskId))[0]?.parameters ?? '{}').ships?.route?.far, 'merge')
      yield* Deferred.succeed(gate, undefined)
      yield* shipped(task.taskId)
      assert.deepStrictEqual(
        github.merged.map((one) => one.number),
        [1],
      )
    }).pipe(Effect.provide(withHost(github)))
  })
})

describe('changing a Ship’s route as it goes', () => {
  it.live('is refused while the task’s plan still runs, with no Ship under way', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const instance = yield* Instance
      yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
      const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const coordinator = yield* Coordinator
      const threadId = yield* coordinator.thread(project.projectId)
      const body = 'Add a retry. [coordinator:plan] [lead:wait]'
      yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
      const [card] = yield* until(cards(project.projectId), (all) => all[0] !== undefined)
      const taskId = card?.taskId ?? assert.fail('no card')
      yield* until(sql<{ state: string }>`SELECT state FROM runs WHERE task_id = ${taskId}`, (rows) => rows[0]?.state === 'running')
      const refused = yield* Effect.flip(routeShip(taskId, { review: false, far: 'push' }))
      assert.instanceOf(refused, ShipRefused)
      assert.strictEqual((refused as ShipRefused).why, 'not_shipping')
    }).pipe(Effect.provide(withHost(github)))
  })

  it.live('mid-review, takes how far it goes, said at its review stop, then at its push', () => {
    const { working, bare, github } = onGitHub()
    let reads = true
    const held: Holds = { open: () => undefined, opened: (marker) => marker === '[review:slowly]' && reads }
    return Effect.gen(function* () {
      const task = yield* opened(working, '[review:slowly]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      commitIn(task.path, 'Retry twice')
      reads = false
      // The task's own route: its review, as far as a push.
      yield* ship(task.taskId)
      const [reviewing] = yield* until(
        Effect.map(header(task.threadId), (seen) => [seen.shipping] as const),
        ([shipping]) => shipping !== undefined,
      )
      assert.deepStrictEqual(reviewing, { route: { review: true, far: 'push' }, at: 'review' })
      yield* routeShip(task.taskId, { review: true, far: 'ready' })
      assert.deepStrictEqual((yield* header(task.threadId)).shipping, { route: { review: true, far: 'ready' }, at: 'review' })
      reads = true
      yield* wentUp(bare, task.path, pushed)
      yield* shipped(task.taskId)
      // Its review ran, then it went up, marked ready as it now said.
      assert.isTrue(yield* shipReviewed(task.taskId))
      assert.isFalse(github.changes[0]?.draft)
    }).pipe(Effect.provide(withHost(github, held)))
  })

  it.live('mid-review, with its review off, stops the review as Skip review does, and goes up', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      // Its reviewer passes the plan's review, and reads the Ship's until it is stopped.
      const task = yield* opened(working, '[review:pass] [review:wait-later]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      commitIn(task.path, 'Retry twice')
      yield* ship(task.taskId)
      yield* until(
        sql<{ state: string }>`
          SELECT a.state FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
          JOIN runs r ON r.id = e.run_id WHERE r.task_id = ${task.taskId} AND r.plan_id IS NULL AND n.node_key = 'review'`,
        (rows) => rows[0]?.state === 'running',
      )
      yield* routeShip(task.taskId, { review: false, far: 'push' })
      yield* wentUp(bare, task.path, pushed)
      yield* shipped(task.taskId)
      assert.include(yield* titles(task.threadId), 'The review stopped: skipped, with what it found left open.')
      assert.deepStrictEqual(yield* stepsSaid(task.threadId), ['implement', 'review', 'publish', 'publish'])
      assert.isTrue(github.changes[0]?.draft)
    }).pipe(Effect.provide(withHost(github)))
  })

  it.live('takes a route from ship_task while it goes, no further than ready, and with none says it is at work', () => {
    const { working, bare, github } = onGitHub(requires('test'))
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working, '[coordinator:plan-no-review]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      github.setChecks(1, [{ name: 'test', state: 'running' }])
      commitIn(task.path, 'Retry twice')
      yield* ship(task.taskId, { review: false, far: 'merge' })
      yield* wentUp(bare, task.path, pushed)
      yield* until(header(task.threadId), (seen) => seen.shipping?.at === 'merge')
      // The coordinator, on the person's word.
      const threadId = yield* (yield* Coordinator).thread(task.projectId)
      const coordinator = { role: 'coordinator' as const, projectId: task.projectId, threadId, sessionId: 'none', taskId: null }
      const slug = (yield* sql<{ slug: string }>`SELECT slug FROM tasks WHERE id = ${task.taskId}`)[0]?.slug ?? ''
      // With no route said, a Ship under way is refused as it always was.
      assert.notMatch(yield* callTool(coordinator, 'ship_task', { task: slug }), /^Changed /)
      assert.strictEqual((yield* shipRuns(task.taskId)).length, 1)
      // As far as ready for review: it stops waiting to merge, and ends there.
      assert.strictEqual(
        yield* callTool(coordinator, 'ship_task', { task: slug, far: 'ready' }),
        `Changed ${slug}’s Ship: it now goes as far as ready for review (an open draft is marked ready, a new pull request opens ready). read_task shows where it stands. Both threads have a line saying so.`,
      )
      yield* shipped(task.taskId)
      assert.deepStrictEqual(JSON.parse((yield* shipRuns(task.taskId))[0]?.parameters ?? '{}').ships?.route, {
        review: false,
        far: 'ready',
      })
      assert.lengthOf(github.merged, 0)
      // It never goes as far as a merge on an agent's word.
      assert.match(yield* callTool(coordinator, 'ship_task', { task: slug, far: 'merge' }), /far/)
    }).pipe(Effect.provide(withHost(github)))
  })

  it.live('takes its review off from ship_task mid-review; with nothing shipping, a route said goes with a Ship of its own', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working, '[review:pass] [review:wait-later]')
      const threadId = yield* (yield* Coordinator).thread(task.projectId)
      const coordinator = { role: 'coordinator' as const, projectId: task.projectId, threadId, sessionId: 'none', taskId: null }
      const slug = (yield* sql<{ slug: string }>`SELECT slug FROM tasks WHERE id = ${task.taskId}`)[0]?.slug ?? ''
      const pushed = git(bare, 'rev-parse', BRANCH)
      commitIn(task.path, 'Retry twice')
      yield* ship(task.taskId)
      yield* until(
        sql<{ state: string }>`
          SELECT a.state FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
          JOIN runs r ON r.id = e.run_id WHERE r.task_id = ${task.taskId} AND r.plan_id IS NULL AND n.node_key = 'review'`,
        (rows) => rows[0]?.state === 'running',
      )
      assert.include(
        yield* callTool(coordinator, 'ship_task', { task: slug, review: false }),
        ', without its review (one under way stops).',
      )
      yield* wentUp(bare, task.path, pushed)
      yield* shipped(task.taskId)
      // Nothing ships now: the route said goes with the next Ship, the rest the task's own; an agent's Ship never merges, though
      // the person's default does.
      yield* setShipRoute({ review: true, far: 'merge' })
      commitIn(task.path, 'Log each retry')
      assert.notMatch(yield* callTool(coordinator, 'ship_task', { task: slug, review: false }), /^Changed /)
      yield* shipped(task.taskId, 2)
      assert.deepStrictEqual(JSON.parse((yield* shipRuns(task.taskId))[1]?.parameters ?? '{}').ships?.route, {
        review: false,
        far: 'ready',
      })
      assert.isFalse(github.changes[0]?.draft)
    }).pipe(Effect.provide(withHost(github)))
  })

  it.live('is no longer under way once its push waits for the person to try again', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working, '[coordinator:plan-no-review]', 'none')
      yield* (yield* Runs).reshape({ taskId: task.taskId, end: 'draft', actorId: (yield* Instance).personId })
      commitIn(task.path, 'Retry twice')
      github.failNext('openChange', 'rejected', undefined, 422)
      yield* ship(task.taskId)
      yield* until(
        sql<{ id: string }>`SELECT id FROM attention_requests WHERE task_id = ${task.taskId} AND kind = 'stuck' AND state = 'open'`,
        (rows) => rows.length === 1,
      )
      // Its run still goes, waiting on the person; the card says what it needs, not a push under way.
      assert.strictEqual((yield* shipRuns(task.taskId))[0]?.state, 'running')
      assert.isUndefined((yield* header(task.threadId)).shipping)
      assert.lengthOf(github.changes, 0)
    }).pipe(Effect.provide(withHost(github)))
  })

  it.live('says its push stop while it opens its pull request', () => {
    const gate = Deferred.makeUnsafe<void>()
    let holding = false
    const { working, github } = onGitHub({
      waitsFor: (method) => (method === 'openChange' && holding ? Deferred.await(gate) : Effect.void),
    })
    return Effect.gen(function* () {
      const task = yield* opened(working, '[coordinator:plan-no-review]', 'none')
      yield* (yield* Runs).reshape({ taskId: task.taskId, end: 'draft', actorId: (yield* Instance).personId })
      commitIn(task.path, 'Retry twice')
      holding = true
      yield* ship(task.taskId)
      yield* until(
        Effect.sync(() => github.calls),
        (calls) => calls.includes('openChange'),
      )
      assert.deepStrictEqual((yield* header(task.threadId)).shipping, { route: { review: false, far: 'push' }, at: 'push' })
      yield* Deferred.succeed(gate, undefined)
      yield* shipped(task.taskId)
      assert.isTrue(github.changes[0]?.draft)
    }).pipe(Effect.provide(withHost(github)))
  })
})

describe('a task’s own route', () => {
  it.live('is the person’s default where they made one, bent to ready where main needs someone else’s approval', () => {
    const { working, github } = onGitHub({
      rulesOf: (): MergeRules => ({ requiredChecks: null, needs: [{ kind: 'approvals', state: 'unmet', have: 0, need: 1 }] }),
    })
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working)
      // Nothing waits: no route to offer.
      assert.isUndefined((yield* header(task.threadId)).shipRoute)
      yield* say(task.threadId, 'Make it retry twice. tidy pls [lead:commit]')
      yield* until(heldAt(task.taskId), (at) => at !== null)
      // Its own: its review, then as far as its draft ending goes.
      const [own] = yield* until(
        Effect.map(header(task.threadId), (seen) => [seen.shipRoute] as const),
        ([route]) => route !== undefined,
      )
      assert.deepStrictEqual(own, { route: { review: true, far: 'push' }, reviewable: true, bent: null })
      yield* setShipRoute({ review: false, far: 'ready' })
      assert.deepStrictEqual((yield* header(task.threadId)).shipRoute, {
        route: { review: false, far: 'ready' },
        reviewable: true,
        bent: null,
      })
      // As far as a merge, where its pull request still needs an approval from someone else: ready, and why.
      yield* (yield* Changes).refresh(task.taskId)
      yield* until(
        sql<{ rules: string | null }>`
          SELECT json_extract(snapshot, '$.rules') AS rules FROM external_links WHERE task_id = ${task.taskId} AND kind = 'change'`,
        (rows) => rows[0]?.rules != null,
      )
      yield* setShipRoute({ review: true, far: 'merge' })
      assert.deepStrictEqual((yield* header(task.threadId)).shipRoute, {
        route: { review: true, far: 'ready' },
        reviewable: true,
        bent: 'approval',
      })
      // Pressed without a route, Ship takes that one.
      yield* idle(task.threadId)
      yield* ship(task.taskId)
      const [run] = yield* until(shipRuns(task.taskId), (all) => all.length === 1)
      assert.deepStrictEqual(JSON.parse(run?.parameters ?? '{}').ships?.route, { review: true, far: 'ready' })
      yield* shipped(task.taskId)
      assert.isFalse(github.changes[0]?.draft)
      // Back to each task's own.
      yield* setShipRoute(null)
      const [setting] = yield* sql<{ n: number }>`SELECT count(*) AS n FROM settings WHERE key = 'ship_route'`
      assert.strictEqual(setting?.n, 0)
    }).pipe(Effect.provide(withHost(github)))
  })
})

describe('a route’s parts, read alone', () => {
  it('finds an approval short where a line needs more than it has, or waits on one without a count', () => {
    assert.isTrue(approvalShort([{ kind: 'approvals', state: 'unmet', have: 0, need: 1 }]))
    assert.isTrue(approvalShort([{ kind: 'approvals', state: 'unmet', need: 2 }]))
    assert.isFalse(approvalShort([{ kind: 'approvals', state: 'met', have: 1, need: 1 }]))
    assert.isTrue(approvalShort([{ kind: 'approvals', state: 'waiting' }]))
    assert.isTrue(approvalShort([{ kind: 'approvals', state: 'unmet' }]))
    assert.isFalse(approvalShort([{ kind: 'approvals', state: 'met' }]))
    assert.isFalse(approvalShort([{ kind: 'checks', state: 'unmet' }]))
  })

  it('takes the person’s route, else the task’s ending after its review, bent where it can’t review or merge', () => {
    assert.deepStrictEqual(routeOf({ chosen: undefined, reviewable: true, end: 'ready', approvalShort: false }), {
      route: { review: true, far: 'ready' },
      reviewable: true,
      bent: null,
    })
    assert.deepStrictEqual(routeOf({ chosen: undefined, reviewable: false, end: 'draft', approvalShort: true }), {
      route: { review: false, far: 'push' },
      reviewable: false,
      bent: null,
    })
    assert.deepStrictEqual(routeOf({ chosen: { review: true, far: 'merge' }, reviewable: true, end: null, approvalShort: true }), {
      route: { review: true, far: 'ready' },
      reviewable: true,
      bent: 'approval',
    })
  })

  it('reads a Ship admitted before routes by its steps and its ending, merging where it said so', () => {
    assert.deepStrictEqual(routeOfShip({ route: { review: false, far: 'merge' } }, [{ key: 'review' }], 'draft'), {
      review: false,
      far: 'merge',
    })
    assert.deepStrictEqual(routeOfShip({ merges: true }, [{ key: 'review' }], 'draft'), { review: true, far: 'merge' })
    assert.deepStrictEqual(routeOfShip({}, [{ key: 'review', skipped: true }], 'ready'), { review: false, far: 'ready' })
    assert.deepStrictEqual(routeOfShip({}, [], null), { review: false, far: 'push' })
  })

  it('says the stop a Ship is at: past its push as its run says, else by its step, else its review while it has one', () => {
    assert.strictEqual(shipStopOf({ at: 'merge', step: 'publish', reviewing: true }), 'merge')
    assert.strictEqual(shipStopOf({ at: undefined, step: 'review', reviewing: false }), 'review')
    assert.strictEqual(shipStopOf({ at: undefined, step: 'settle', reviewing: false }), 'review')
    assert.strictEqual(shipStopOf({ at: undefined, step: 'publish', reviewing: true }), 'push')
    assert.strictEqual(shipStopOf({ at: undefined, step: undefined, reviewing: true }), 'review')
    assert.strictEqual(shipStopOf({ at: undefined, step: 'implement', reviewing: false }), 'push')
  })

  it('reads a Ship under way from its run: none where it can’t, nor for a review added after the work went up', () => {
    assert.isUndefined(shipUnderWayOf('not a run', null))
    assert.isUndefined(shipUnderWayOf(JSON.stringify({ steps: [{ key: 'review' }], ships: { reviewOnly: true } }), 'review'))
    assert.deepStrictEqual(shipUnderWayOf(JSON.stringify({ steps: [{ key: 'review' }], end: 'ready', ships: {} }), null), {
      route: { review: true, far: 'ready' },
      at: 'review',
    })
    assert.deepStrictEqual(
      shipUnderWayOf(
        JSON.stringify({
          steps: [{ key: 'review', skipped: true }],
          reviewAfterMerge: true,
          ships: { route: { review: false, far: 'merge' }, at: 'merge' },
        }),
        'publish',
      ),
      { route: { review: false, far: 'merge' }, at: 'merge' },
    )
  })

  it.live('gives a task it doesn’t know no review, and goes no further than a push', () => {
    const { github } = onGitHub()
    return Effect.gen(function* () {
      assert.deepStrictEqual(yield* taskShipRoute(yield* Changes, 'task_none'), {
        route: { review: false, far: 'push' },
        reviewable: false,
        bent: null,
      })
    }).pipe(Effect.provide(withHost(github)))
  })
})
