import { makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Fiber, Layer, Option, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Instance } from '../src/Instance'
import { type NudgeEvent, Nudges } from '../src/Nudges'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import { ask, cards, connect, git, pushByHand, tipOf } from './changesSupport'
import { fakeConnectors, HOST, hosted, repository, runtime, until } from './support'

/*
 * A sanity pass over what each surface says of a task. Here: how many things
 * wait on the person, as the Dock's badge, the menu bar's "N things waiting on
 * you" and the notifications say it (Nudges), against the task's card, which
 * the board's Needs you, the home and the tabs go by.
 */

const withNudges = (more: Parameters<typeof runtime>[2] = {}) =>
  Nudges.layer.pipe(Layer.provideMerge(Queries.layer), Layer.provideMerge(runtime(':memory:', {}, more)))

/** Every event the nudges give, as they come. */
const heard = Effect.gen(function* () {
  const nudges = yield* Nudges
  const events: Array<NudgeEvent> = []
  const fiber = yield* Effect.forkChild(Stream.runForEach(nudges.events, (event) => Effect.sync(() => void events.push(event))))
  return { events, stop: Fiber.interrupt(fiber) }
})

/** A plain task in a project of its own, started at once, whose lead finishes. */
const finishing = (title: string) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const plans = yield* Plans
    const instance = yield* Instance
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId: project.projectId,
      title,
      draft: true,
      plain: true,
    })
    const planId = yield* plans.propose({
      projectId: project.projectId as ProjectId,
      taskId: task.taskId,
      steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
      reason: null,
      actorId: instance.personId,
      end: null,
      here: true,
    })
    yield* plans.start(planId, instance.personId)
    return task
  })

const saidReady = (events: ReadonlyArray<NudgeEvent>, title: string) =>
  events.some((event) => event._tag === 'Nudge' && event.kind === 'ready' && event.title === title)

/**
 * How many things the Dock and the menu bar say wait, as Nudges counts them once it has looked at everything after what a
 * test set up: two plain tasks elsewhere finish one after the other, and the count it gives as it says the second is the one
 * that look came to. The first makes sure a look has seen what the test set up; the second adds one, so a count follows it.
 */
const countedNow = (events: ReadonlyArray<NudgeEvent>) =>
  Effect.gen(function* () {
    yield* finishing('First look elsewhere [lead:finish]')
    yield* until(
      Effect.sync(() => [saidReady(events, 'First look elsewhere [lead:finish]')]),
      ([said]) => said === true,
    )
    yield* finishing('Second look elsewhere [lead:finish]')
    const [count] = yield* until(
      Effect.sync(() => {
        const at = events.findIndex((event) => event._tag === 'Nudge' && event.title === 'Second look elsewhere [lead:finish]')
        const after = at < 0 ? undefined : events.slice(at + 1).find((event) => event._tag === 'Waiting')
        return after?._tag === 'Waiting' ? [after.count] : []
      }),
      (found) => found.length === 1,
    )
    return count
  })

describe('how many things wait, as the Dock, the menu bar and the notifications say it', () => {
  // Finding (sanity pass): a change whose checks still run is under way, in Running with "Checks running" on the board, and out of
  // Needs you everywhere in the window; but Nudges counts it as ready the moment its run succeeds, so the Dock's badge and the menu
  // bar say it waits on the person, and its "Ready" notification goes out before its checks have passed.
  // Fixed: Nudges goes by the cards the card watcher keeps (Queries.waiting).
  it.live('leaves out a change whose checks still run, as its card does', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare), checksFor: () => [{ name: 'test', state: 'running' }] })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const { events, stop } = yield* heard
      yield* connect('github', HOST)
      const projectId = yield* ask(working, 'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]')
      const [running] = yield* until(cards(projectId), (all) => all[0]?.step === 'checks_running')
      assert.strictEqual(running?.phase, 'running')
      // Only the two that finished elsewhere wait on the person.
      assert.strictEqual(yield* countedNow(events), 2)
      yield* stop
    }).pipe(Effect.provide(withNudges({ connectors: fakeConnectors({ github }), listenEvery: Duration.millis(100) })))
  })

  // Finding (sanity pass): a settled task whose lead answered the person, unread, is back in Needs you on the board and the home
  // ("Replied"; docs: "counted as any ready task is: on the board, Home, the edge, the tabs and in notifications"); but Nudges reads
  // ready tasks only among those not done, so the Dock's badge and the menu bar leave it out and no notification says it. The same
  // holds for a merged task whose review after merge found something, or with commits after its pull request. Fixed: Nudges
  // goes by the cards the card watcher keeps (Queries.waiting), the merged ones the home shows among them.
  it.live('counts a settled task whose lead answered the person, as its card puts it in Needs you', () =>
    Effect.gen(function* () {
      const { events, stop } = yield* heard
      const sql = yield* SqlClient.SqlClient
      const queries = yield* Queries
      const tasks = yield* Tasks
      const sessions = yield* Sessions
      const task = yield* finishing('Check the partners [lead:finish] [lead:terse]')
      const card = (check: (one: { readonly phase: string; readonly replied?: string | undefined }) => boolean) =>
        until(
          Effect.map(queries.card(task.taskId), (one) => [one]),
          ([one]) => one !== undefined && check(one),
        )
      yield* card((one) => one.phase === 'ready')
      assert.isTrue(yield* tasks.markDone({ envelope: yield* Runtime.envelope('task.mark_done', {}), taskId: task.taskId }))
      yield* until(sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${task.taskId}`, (rows) => rows[0]?.state === 'done')
      // The person asks it something more once it is done; its lead answers, and the answer waits for them, the task settled still.
      yield* until(
        Effect.map(sessions.running(task.threadId), (lead) => (Option.isNone(lead) ? [true] : [])),
        (gone) => gone.length === 1,
      )
      const body = 'And the v2 ones?'
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', { threadId: task.threadId, body }),
        threadId: task.threadId,
        body,
      })
      yield* sessions.startLast(task.threadId)
      yield* card((one) => one.phase === 'ready' && one.replied !== undefined)
      // It waits on the person, with the two that finished elsewhere.
      assert.strictEqual(yield* countedNow(events), 3)
      yield* stop
    }).pipe(Effect.provide(withNudges())),
  )
})

describe('a ready change the person pushed to, before its host shows the new head’s checks', () => {
  // Finding (sanity pass): docs/decisions/code-hosts.md says a pull request that shows no checks yet counts as running for a minute
  // while its host registers them, where the repository's pull requests have had checks. Only a change in Althar's hands gets that
  // (Changes.handsOf), and the person's own Push takes it out of them: so right after it the card is Ready, "Ready to accept · No
  // checks ran · Accept and merge" on the board, the header and the home, while its host starts the checks. Flips to passing when
  // fixed.
  it.live('is under way, its checks running, not ready with no checks ran', () => {
    const { working, bare } = hosted()
    const tip = tipOf(bare)
    // The host has checks for what the plan's run pushed; for a head pushed after, none yet, as GitHub for a moment after a push.
    let first: string | null = null
    const github = makeFakeService({
      pushUrl: () => bare,
      headOf: tip,
      checksFor: (_: number, sha: string) => (first === null || sha === first ? [{ name: 'test', state: 'passed' as const }] : []),
    })
    github.addRepository(['meridian', 'api'])
    git(working, 'config', 'user.name', 'Fake')
    git(working, 'config', 'user.email', 'fake@althar.test')
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const changes = yield* Changes
      yield* connect('github', HOST)
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]',
        pushByHand,
      )
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready' && all[0]?.change?.checks?.outcome === 'passed')
      first = ready?.change?.head ?? null
      const taskId = ready?.taskId ?? ''
      const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${taskId}`
      // The person commits one more thing in its worktree, and pushes it from the card.
      git(workspace?.path ?? '', 'commit', '-q', '--allow-empty', '-m', 'Log each retry')
      const [seen] = yield* until(cards(projectId), (all) => all[0]?.change?.unpushed === 1)
      yield* changes.push(taskId, seen?.change?.localHead ?? '')
      const [pushed] = yield* until(cards(projectId), (all) => all[0]?.change?.head !== first && all[0]?.change?.checks?.outcome === 'none')
      assert.strictEqual(pushed?.phase, 'running')
      assert.strictEqual(pushed?.step, 'checks_running')
    }).pipe(
      Effect.provide(
        Queries.layer.pipe(
          Layer.provideMerge(
            runtime(
              ':memory:',
              {},
              { connectors: fakeConnectors({ github }), listenEvery: Duration.millis(100), checksAppear: Duration.minutes(1) },
            ),
          ),
        ),
      ),
    )
  })
})
