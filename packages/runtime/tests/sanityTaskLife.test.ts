import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import type { Holds } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { ShipRefused } from '../src/errors'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { type PlanStep, Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { callTool, fakeConnectors, HOST, hosted, notices, repository, runtime, until } from './support'

/*
 * A sanity pass over a task's life in the runtime: the edges between its
 * plan, its rounds, Ship, its pull requests and the ones that follow them.
 * Each test here asserts what the decisions (docs/decisions/tasks.md,
 * reviews.md) say should happen, and is marked to fail while the runtime
 * does otherwise: it flips to passing once the finding is fixed.
 */

const runtimeWith = (github: FakeService) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) })),
  )

const git = (cwd: string, ...args: Array<string>) => execFileSync('git', args, { cwd }).toString().trim()

/** A repository on the fake GitHub, its lead committing as the person does. */
const onGitHub = () => {
  const { working, bare } = hosted()
  const github = makeFakeService({ pushUrl: () => bare })
  github.addRepository(['meridian', 'api'])
  git(working, 'config', 'user.name', 'Fake')
  git(working, 'config', 'user.email', 'fake@althar.test')
  return { working, bare, github }
}

/** The host merges a pull request by squashing it: main gets one commit with its branch's change, and the branch stays as it was. */
const squashMerge = (bare: string, branch: string) => {
  const clone = mkdtempSync(join(tmpdir(), 'althar-merge-'))
  execFileSync('git', ['clone', '-q', bare, clone])
  const as = ['-c', 'user.name=Host', '-c', 'user.email=host@althar.test']
  git(clone, ...as, 'merge', '-q', '--squash', `origin/${branch}`)
  git(clone, ...as, 'commit', '-q', '-m', `Squashed ${branch}`)
  git(clone, 'push', '-q', 'origin', 'main')
}

/** A commit the person makes by hand in the task's folder. */
const commitIn = (path: string, file: string, message: string) => {
  appendFileSync(join(path, file), `${message}\n`)
  git(path, 'add', '-A')
  git(path, '-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', 'commit', '-q', '-m', message)
}

const cards = (projectId: string) =>
  Effect.gen(function* () {
    const snapshot = yield* Effect.orDie((yield* Queries).coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

/** What the person says to the task's lead, as the task's screen says it; a lead stopped since starts again. */
const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    const live = Option.isSome(yield* sessions.running(threadId))
    yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { threadId, body }), threadId, body })
    if (!live) yield* Effect.ignore(sessions.startLast(threadId))
  })

/** Waits until the lead's turn is over, nothing of it at work. */
const idle = (threadId: string) =>
  until(
    Effect.flatMap(Sessions, (sessions) => sessions.busy(threadId)),
    (busy) => !busy,
  )

/** Waits until the thread's turns are all over, `count` of them. */
const answered = (threadId: string, count: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* until(
      sql<{ state: string }>`SELECT state FROM turn_deliveries WHERE thread_id = ${threadId}`,
      (rows) => rows.length >= count && rows.every((row) => row.state !== 'pending' && row.state !== 'delivered'),
    )
    yield* idle(threadId)
  })

const heldAt = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ heldAt: string | null }>`SELECT held_at FROM workspaces WHERE task_id = ${taskId}`
    return row?.heldAt ?? null
  })

const turnsOn = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [turns] = yield* sql<{ n: number }>`SELECT count(*) AS n FROM turn_deliveries WHERE thread_id = ${threadId}`
    return turns?.n ?? 0
  })

/** The steps of the task's runs after its plan's, each with its attempt's state, oldest first. */
const laterSteps = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ node: string; state: string }>`
      SELECT n.node_key AS node, a.state FROM node_attempts a JOIN nodes n ON n.id = a.node_id
      JOIN workflow_executions e ON e.id = n.execution_id JOIN runs r ON r.id = e.run_id
      WHERE r.task_id = ${taskId} AND r.plan_id IS NULL ORDER BY a.admitted_at, a.rowid`
  })

/** The person connects the fake GitHub and the coordinator plans a task from `body`: its card, once `ready` says it is. */
const planned = (working: string, body: string, ready: (card: Effect.Success<ReturnType<typeof cards>>[number]) => boolean) =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const coordinator = yield* Coordinator
    const threadId = yield* coordinator.thread(project.projectId)
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
    const [card] = yield* until(cards(project.projectId), (all) => all[0] !== undefined && ready(all[0]))
    const sql = yield* SqlClient.SqlClient
    const taskId = card?.taskId ?? assert.fail('no card')
    const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${taskId}`
    return { projectId: project.projectId, taskId, threadId: card?.threadId ?? '', path: workspace?.path ?? '' }
  })

describe('skipping a review', () => {
  // Finding (sanity pass): skipping the plan's review writes "skipped" into the plan's own run, which every later Ship and
  // round copies its steps from, so the task never has its reviewer again. Flips to passing when fixed.
  it.live.fails('skips only that round’s review: a later Ship still runs the plan’s reviewer', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const runs = yield* Runs
      const sql = yield* SqlClient.SqlClient
      // The plan's reviewer reads until it is stopped; the person skips it.
      const started = yield* planned(
        working,
        'Add a retry. [coordinator:plan] [lead:finish] [lead:edit] [review:wait]',
        (card) => card.taskId !== '',
      )
      yield* until(
        sql<{ state: string }>`
          SELECT a.state FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
          JOIN runs r ON r.id = e.run_id WHERE r.task_id = ${started.taskId} AND r.plan_id IS NOT NULL AND n.node_key = 'review'`,
        (rows) => rows[0]?.state === 'running',
      )
      yield* runs.skipReview({ envelope: yield* Runtime.envelope('task.skip_review', {}), taskId: started.taskId })
      // Gone on without it: its pull request opened.
      yield* until(cards(started.projectId), (all) => all[0]?.phase === 'ready' && all[0].change !== null)
      yield* idle(started.threadId)

      // A tweak afterwards, held for Ship, and shipped.
      yield* say(started.threadId, 'Make it retry twice. tidy pls [lead:commit]')
      yield* answered(started.threadId, yield* turnsOn(started.threadId))
      yield* until(heldAt(started.taskId), (at) => at !== null)
      yield* runs.ship({ envelope: yield* Runtime.envelope('task.ship', { taskId: started.taskId }), taskId: started.taskId })

      // Only that round lost its review (tasks.md, "Rounds"): Ship reviews what came since, as the plan says.
      const steps = yield* until(
        laterSteps(started.taskId),
        (rows) => rows.some((row) => row.node === 'review') || rows.some((row) => row.node === 'publish' && row.state === 'succeeded'),
      )
      assert.deepStrictEqual(
        steps.map((row) => row.node),
        ['review'],
        'the Ship after a skipped plan review ran no review',
      )
      assert.lengthOf(github.changes, 1)
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('a pull request after the last merged', () => {
  // Finding (sanity pass): a next pull request was titled and described from what the lead said since the last one *opened*,
  // so words given while it was still open, which went on it, named and described the next one too. Now it is from what the
  // lead said since the last push to it.
  it.live('isn’t named or described by what the lead said of work that went in the merged one', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const runs = yield* Runs
      const sql = yield* SqlClient.SqlClient
      const task = yield* planned(
        working,
        'Add a retry. [coordinator:plan] [coordinator:plan-no-review] [lead:finish] [lead:edit]',
        (card) => card.phase === 'ready' && card.change !== null,
      )
      yield* idle(task.threadId)

      // While PR #1 is open, the person has the lead tweak it: the lead commits, and says what it did, with a title and a
      // description, which go on PR #1. Ship sends the tweak up to PR #1.
      yield* say(task.threadId, 'Make it retry twice. tidy pls [lead:commit]')
      yield* answered(task.threadId, yield* turnsOn(task.threadId))
      yield* until(heldAt(task.taskId), (at) => at !== null)
      const [lead] = yield* sql<{ id: string }>`
        SELECT id FROM provider_sessions WHERE thread_id = ${task.threadId} ORDER BY started_at DESC LIMIT 1`
      yield* callTool(
        { role: 'lead', projectId: task.projectId, threadId: task.threadId, sessionId: lead?.id ?? '', taskId: task.taskId },
        'finish_step',
        {
          summary: 'Made it retry twice.',
          built: 'The retry now tries twice before it gives up.',
          title: 'Retry twice before giving up',
          descriptions: [{ text: 'Retries twice before giving up, as asked on PR #1.' }],
        },
      )
      yield* runs.ship({ envelope: yield* Runtime.envelope('task.ship', { taskId: task.taskId }), taskId: task.taskId })
      yield* until(heldAt(task.taskId), (at) => at === null)

      // PR #1 merges with the tweak in it, and the task settles.
      squashMerge(bare, 'althar/add-a-retry')
      github.mergeByHand(1)
      yield* (yield* Changes).refresh(task.taskId)
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'settled')

      // Then the person commits something new by hand, and opens its pull request from the task.
      commitIn(task.path, 'slider.txt', 'Add the slider')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready')
      yield* runs.publish(task.taskId)
      const second = github.changes[1] ?? assert.fail('no second pull request')
      // It follows #1, and says nothing of the tweak, which merged in #1: neither in its title nor in its description.
      assert.deepStrictEqual(
        {
          title: second.title,
          describedByTheTweak: second.body.includes('Retries twice before giving up'),
          summedUpByTheTweak: second.body.includes('The retry now tries twice'),
        },
        { title: 'After #1: Add a retry', describedByTheTweak: false, summedUpByTheTweak: false },
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

/** A task planned by the person as `steps` say, in a project on the fake GitHub, started now: its card once its pull request is open. */
const plannedAs = (working: string, description: string, steps: ReadonlyArray<PlanStep>) =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const projects = yield* Projects
    const plans = yield* Plans
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const created = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId: project.projectId,
      title: 'Add a retry',
      description,
      draft: true,
    })
    const planId = yield* plans.propose({
      projectId: project.projectId as ProjectId,
      taskId: created.taskId,
      steps,
      reason: null,
      actorId: instance.personId,
      end: null,
      held: true,
    })
    yield* plans.start(planId, instance.personId)
    const [card] = yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready' && all[0].change != null)
    const sql = yield* SqlClient.SqlClient
    const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${created.taskId}`
    return {
      projectId: project.projectId,
      taskId: created.taskId,
      threadId: card?.threadId ?? '',
      url: card?.change?.url ?? '',
      path: workspace?.path ?? '',
    }
  })

describe('Merge now, with commits not shipped', () => {
  // Finding (sanity pass): the review after a merge reads the plan's review step without looking at `skipped`, so a task
  // whose review the person took off (the plan card's toggle, Change the team's Remove) is still owed one after Merge now.
  // Flips to passing when fixed.
  it.live.fails('owes no review after the merge where the person took the task’s review off', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      // Its plan had a reviewer, which the person took off before it started: the row stays, skipped, to add back.
      const task = yield* plannedAs(working, 'Add a retry. [lead:finish] [lead:edit]', [
        { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
        { key: 'review', agentId: 'codex', model: null, skipped: true },
      ])
      yield* idle(task.threadId)
      // A tweak waits for Ship, and the person merges now.
      yield* say(task.threadId, 'Make it retry twice. tidy pls [lead:commit]')
      yield* answered(task.threadId, yield* turnsOn(task.threadId))
      yield* until(heldAt(task.taskId), (at) => at !== null)
      yield* (yield* Runs).mergeWaiting({
        envelope: yield* Runtime.envelope('task.merge', { taskId: task.taskId, how: 'now', url: task.url }),
        taskId: task.taskId,
        how: 'now',
        url: task.url,
      })
      assert.deepStrictEqual(
        github.merged.map((one) => one.number),
        [1],
      )
      // "Reviewed after the merge the same way, where the task has a reviewer" (reviews.md): this one has none.
      const owed = yield* sql<{
        state: string
        reviewer: string | null
      }>`SELECT state, reviewer FROM merge_reviews WHERE task_id = ${task.taskId}`
      assert.deepStrictEqual(owed, [], 'a review after the merge is owed to a task with no reviewer')
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('a turn while Ship reviews', () => {
  // Finding (sanity pass): Ship's ending pushes each branch up to its head as it is then, so what a turn of the person's
  // committed while Ship's review read its copy goes up with it: never reviewed, and never held for the next Ship. Flips to
  // passing when fixed.
  it.live.fails('leaves what it commits for the next Ship, rather than sending it up unreviewed', () => {
    const { working, bare, github } = onGitHub()
    // The reviewer reads at once, until the test holds it back.
    let reads = true
    const held: Holds = { open: () => undefined, opened: (marker) => marker === '[review:slowly]' && reads }
    return Effect.gen(function* () {
      const runs = yield* Runs
      const task = yield* planned(
        working,
        'Add a retry. [coordinator:plan] [lead:finish] [lead:edit] [review:slowly]',
        (card) => card.phase === 'ready' && card.change !== null,
      )
      yield* idle(task.threadId)
      // A tweak, held for Ship; Ship's review reads it, slowly.
      reads = false
      yield* say(task.threadId, 'Make it retry twice. tidy pls [lead:commit]')
      yield* answered(task.threadId, yield* turnsOn(task.threadId))
      yield* until(heldAt(task.taskId), (at) => at !== null)
      const reviewed = git(task.path, 'rev-parse', 'HEAD^{tree}')
      yield* runs.ship({ envelope: yield* Runtime.envelope('task.ship', { taskId: task.taskId }), taskId: task.taskId })
      yield* until(laterSteps(task.taskId), (rows) => rows.some((row) => row.node === 'review' && row.state === 'running'))

      // Meanwhile the person has the lead do more, which it commits in its turn.
      const before = yield* turnsOn(task.threadId)
      yield* say(task.threadId, 'Log each retry too. tidy pls [lead:commit]')
      yield* until(turnsOn(task.threadId), (count) => count > before)
      yield* answered(task.threadId, before + 1)
      const unread = git(task.path, 'rev-parse', 'HEAD^{tree}')
      assert.notStrictEqual(unread, reviewed)

      // Ship's review passes what it read, and Ship sends it up.
      reads = true
      yield* until(laterSteps(task.taskId), (rows) => rows.some((row) => row.node === 'publish' && row.state === 'succeeded'))
      const up = git(bare, 'rev-parse', 'althar/add-a-retry^{tree}')
      // What no review read stays on the branch, for the next Ship: up went what the review read.
      assert.deepStrictEqual(
        { reviewedWentUp: up === reviewed, unreadWentUp: up === unread },
        { reviewedWentUp: true, unreadWentUp: false },
      )
    }).pipe(
      Effect.provide(
        Queries.layer.pipe(
          Layer.provideMerge(
            runtime(':memory:', { holds: held }, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) }),
          ),
        ),
      ),
    )
  })
})

describe('a lead that ships its own task', () => {
  // Finding (sanity pass): ship_task from the task's own lead writes "Its lead shipped this task" in the thread as it is
  // called, before anything is tried, and the Ship it forks for after the turn swallows its refusal (a warning in the log),
  // so the line stays where nothing shipped. Flips to passing when fixed.
  it.live.fails('leaves no line saying it shipped where nothing did', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const runs = yield* Runs
      const sql = yield* SqlClient.SqlClient
      const task = yield* planned(
        working,
        'Add a retry. [coordinator:plan] [coordinator:plan-no-review] [lead:finish] [lead:edit]',
        (card) => card.phase === 'ready' && card.change !== null,
      )
      yield* idle(task.threadId)
      const pushed = git(bare, 'rev-parse', 'althar/add-a-retry')
      // The person asks its lead to ship; its pull request has everything already.
      const [lead] = yield* sql<{ id: string }>`
        SELECT id FROM provider_sessions WHERE thread_id = ${task.threadId} ORDER BY started_at DESC LIMIT 1`
      const told = yield* callTool(
        { role: 'lead', projectId: task.projectId, threadId: task.threadId, sessionId: lead?.id ?? '', taskId: task.taskId },
        'ship_task',
        {},
      )
      assert.include(told, 'Althar ships this task once your turn ends')
      // Nothing waits, as the person's own Ship says, and nothing went up.
      const refused = yield* Effect.flip(
        runs.ship({ envelope: yield* Runtime.envelope('task.ship', { taskId: task.taskId }), taskId: task.taskId }),
      )
      assert.instanceOf(refused, ShipRefused)
      assert.strictEqual((refused as ShipRefused).why, 'nothing')
      assert.deepStrictEqual(yield* laterSteps(task.taskId), [])
      assert.strictEqual(git(bare, 'rev-parse', 'althar/add-a-retry'), pushed)
      // Yet the task's thread says its lead shipped it.
      const lines = (yield* notices(task.threadId)).map((notice) => notice.title)
      assert.notInclude(lines, 'Its lead shipped this task', 'the thread says it shipped')
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('a plan whose countdown ended as Althar stopped', () => {
  // Finding (sanity pass): Plans.start commits a plan's acceptance before it makes its run. Where Althar stops in between (it
  // quits or restarts, or the run can't be made), nothing starts the plan or holds it again: the countdown looks only at plans
  // still proposed, and startup holds only those that came due while it was closed. The task sits with an accepted plan and no
  // run, nothing said: its card says Running, with no step and nothing it waits for, find_tasks says "stopped" and read_task
  // "planned", until the person finds Start. Seen on "A message sent mid-turn goes straight to the queue", accepted by its countdown at 17:54:29, as Althar
  // restarted. Flips to passing when fixed.
  it.live.fails('waits for the person after a restart, held, as a plan that came due while Althar was closed does', () =>
    Effect.gen(function* () {
      const file = join(mkdtempSync(join(tmpdir(), 'althar-plans-')), 'althar.sqlite')
      const projectId = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
        const coordinator = yield* Coordinator
        const threadId = yield* coordinator.thread(project.projectId)
        const body = 'Later. [coordinator:plan]'
        yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
        yield* until(cards(project.projectId), (all) => all[0]?.phase === 'planned')
        // Its countdown ends, and accepts it as Plans.start does (state, start and decision); Althar stops before its run is made.
        yield* sql`UPDATE task_plans SET state = 'accepted', starts_at = NULL, decided_at = ${new Date().toISOString()}`
        return project.projectId
      }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(file, {}, { countdown: Duration.minutes(5) })))))
      // Althar opens again: its card says Running, with no step, no start and nothing it waits for.
      const { card, runs } = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [card] = yield* cards(projectId)
        return { card, runs: (yield* sql<{ id: string }>`SELECT id FROM runs WHERE task_id = ${card?.taskId ?? ''}`).length }
      }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(file)))))
      assert.deepStrictEqual(
        { phase: card?.phase, runs },
        runs > 0 ? { phase: 'running', runs } : { phase: 'held', runs: 0 },
        'the plan waits for the person, its card saying so, or starts as it was accepted to',
      )
    }),
  )
})
