import { makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Cause, type Duration, Effect, Exit, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { autoTeam } from '../src/autoTeam'
import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Coordinator, CoordinatorOff } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import {
  AWAY_MORE,
  AWAY_SHOWN,
  away,
  CLAIM_HOLDS_MS,
  clearAway,
  recordAct,
  releasedIn,
  type RevertTask,
  revertCommand,
  undoAct,
} from '../src/outsideActs'
import { Plans } from '../src/Plans'
import { hasCoordinator, Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
import { ask, cards, connect, runtimeWith, tipOf } from './changesSupport'
import { callTool, fakeConnectors, HOST, hosted, repository, runtime, until } from './support'

/*
 * While you were away (ADR-097): what agents did outside their worktrees,
 * kept once each for the board, from when the person last looked, with the
 * way each is taken back; and the coordinator as a project switch, off: the
 * person's words start a task with Auto, and nothing wakes it.
 */

const linear = () => {
  const service = makeFakeService({ product: 'linear' })
  service.addIssue({ ref: 'MER-231', title: 'Rate-limit refunds like charges' })
  return service
}

const withServices = (services: { readonly linear?: ReturnType<typeof linear> } = {}) =>
  Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors(services) })))

/** A project, and the coordinator as its tools see it. */
const project = () =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const opened = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
    const threadId = yield* (yield* Coordinator).thread(opened.projectId)
    const access: ToolAccess = {
      role: 'coordinator',
      projectId: opened.projectId,
      threadId,
      sessionId: 'coordinator-session',
      taskId: null,
    }
    return { projectId: opened.projectId as ProjectId, threadId, access }
  })

/** A task in the project, for acts to be done for. */
const aTask = (projectId: string, title: string) =>
  Effect.gen(function* () {
    const created = yield* (yield* Projects).createTask({ envelope: yield* Runtime.envelope('task.create', { title }), projectId, title })
    return created.taskId
  })

/**
 * How a revert's task is made and started, as the API does it: made by the
 * act's command, so made again it is the same task; started with a plan, held
 * here so no agent runs. What each was asked, by task.
 */
const reverts = (projectId: ProjectId, slow: Duration.Input = 0) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const plans = yield* Plans
    const instance = yield* Instance
    const made: Array<string> = []
    const launched: Array<string> = []
    const revert = {
      make: (task: RevertTask, commandId: string) =>
        Effect.gen(function* () {
          yield* Effect.sleep(slow)
          const created = yield* projects.createTask({
            envelope: yield* Runtime.envelope('task.create', { title: task.title }, commandId),
            projectId: task.projectId,
            title: task.title,
            draft: true,
          })
          made.push(created.taskId)
          return { id: created.taskId }
        }),
      launch: (_task: RevertTask, taskId: string) =>
        Effect.gen(function* () {
          launched.push(taskId)
          const team = yield* autoTeam(projectId)
          yield* plans.propose({ projectId, taskId, steps: team?.steps ?? [], reason: null, actorId: instance.personId, held: true })
        }),
    }
    return { revert, made, launched }
  })

describe('while you were away', () => {
  it.live('keeps each act once, newest first, a lead’s starts together, from when the person last looked', () =>
    Effect.gen(function* () {
      const { projectId, threadId } = yield* project()
      const instance = yield* Instance
      const tabs = yield* aTask(projectId, 'Tabs keep their order')
      const adr = yield* aTask(projectId, 'ADR: agents work as yours')
      const act = (source: string, more: Partial<Parameters<typeof recordAct>[0]> = {}, revert = true) =>
        recordAct({
          projectId,
          taskId: tabs,
          threadId,
          kind: 'merge',
          what: 'Merged #634 into main',
          source,
          ...(revert ? { undo: { way: 'revert', url: 'https://github.test/meridian/api/pull/634', name: '#634', branch: 'main' } } : {}),
          actorId: instance.systemId,
          ...more,
        })
      yield* act('merge:634')
      // Kept once for what it acted on: told again, nothing more.
      yield* act('merge:634', { what: 'Merged it twice' })
      yield* act('start:a', { kind: 'start', taskId: adr, what: 'Started “One”' }, false)
      yield* act('start:b', { kind: 'start', taskId: adr, what: 'Started “Two”' }, false)
      yield* act('review:612', { kind: 'post', what: 'Posted a review on dana’s #612', cant: 'Reviews stay posted' }, false)

      const seen = yield* away(projectId, instance.personId)
      assert.isNull(seen.looked)
      assert.deepStrictEqual(
        seen.acts.map((one) => [one.kind, one.what, one.task?.title, one.undo, one.cant]),
        [
          ['post', 'Posted a review on dana’s #612', 'Tabs keep their order', null, 'Reviews stay posted'],
          ['start', 'Started 2 tasks', 'ADR: agents work as yours', null, null],
          ['merge', 'Merged #634 into main', 'Tabs keep their order', 'revert', null],
        ],
      )

      // Cleared up to what that read showed: one done after the read, before the press, still shows.
      yield* act('merge:635', { what: 'Merged #635 into main' })
      yield* clearAway(projectId, instance.personId, seen.upTo)
      const cleared = yield* away(projectId, instance.personId)
      assert.isNotNull(cleared.looked)
      assert.deepStrictEqual(
        cleared.acts.map((one) => one.what),
        ['Merged #635 into main'],
      )
      // A window's older read doesn't bring back what a newer one cleared.
      yield* clearAway(projectId, instance.personId, cleared.upTo)
      yield* clearAway(projectId, instance.personId, seen.upTo)
      assert.lengthOf((yield* away(projectId, instance.personId)).acts, 0)
    }).pipe(Effect.provide(withServices())),
  )

  it.live('shows the newest, says how many earlier there are, and shows those when asked', () =>
    Effect.gen(function* () {
      const { projectId, threadId } = yield* project()
      const instance = yield* Instance
      const tabs = yield* aTask(projectId, 'Tabs keep their order')
      const merged = (n: number) =>
        recordAct({
          projectId,
          taskId: tabs,
          threadId,
          kind: 'merge',
          what: `Merged #${n} into main`,
          source: `merge:${n}`,
          actorId: instance.systemId,
        })
      const all = AWAY_SHOWN + AWAY_MORE + 2
      for (let n = 1; n <= all; n += 1) yield* merged(n)
      const newest = yield* away(projectId, instance.personId)
      assert.deepStrictEqual(
        [newest.acts.length, newest.earlier, newest.acts[0]?.what],
        [AWAY_SHOWN, all - AWAY_SHOWN, `Merged #${all} into main`],
      )
      // Each "N earlier" shows the next page, until there are none.
      const more = yield* away(projectId, instance.personId, AWAY_SHOWN + AWAY_MORE)
      assert.deepStrictEqual([more.acts.length, more.earlier], [AWAY_SHOWN + AWAY_MORE, 2])
      const every = yield* away(projectId, instance.personId, AWAY_SHOWN + 2 * AWAY_MORE)
      assert.deepStrictEqual([every.acts.length, every.earlier, every.acts.at(-1)?.what], [all, 0, 'Merged #1 into main'])
      yield* clearAway(projectId, instance.personId, every.upTo)
      assert.deepStrictEqual((yield* away(projectId, instance.personId)).acts.length, 0)
    }).pipe(Effect.provide(withServices())),
  )

  it.live('an issue an agent moved at once goes back with Undo, through the same tracker', () => {
    const tracker = linear()
    return Effect.gen(function* () {
      const instance = yield* Instance
      yield* (yield* Connections).connectToken({ product: 'linear', token: 't', actorId: instance.personId })
      const { projectId, access } = yield* project()
      const before = (yield* tracker.issue('MER-231')).status.name
      yield* callTool(access, 'change_issues', { changes: [{ issue: 'MER-231', status: 'In Review' }], at_once: true })
      yield* callTool(access, 'comment_on_issue', { issue: 'MER-231', body: 'Fixed in #12.' })
      const listed = (yield* away(projectId, instance.personId)).acts
      assert.deepStrictEqual(
        listed.map((one) => [one.kind, one.what, one.undo, one.cant]),
        [
          ['post', 'Commented on MER-231', null, 'Already sent'],
          ['issue', 'Moved MER-231 to In Review', 'undo', null],
        ],
      )
      const moved = listed[1]!
      const started: Array<string> = []
      yield* undoAct(moved.id, { make: (task) => Effect.sync(() => (started.push(task.title), { id: '' })), launch: () => Effect.void })
      assert.strictEqual((yield* tracker.issue('MER-231')).status.name, before)
      const [now] = (yield* away(projectId, instance.personId)).acts.filter((one) => one.id === moved.id)
      assert.strictEqual(now?.state, 'undone')
      // Done, it isn't done again, and nothing else started.
      yield* undoAct(moved.id, { make: (task) => Effect.sync(() => (started.push(task.title), { id: '' })), launch: () => Effect.void })
      assert.lengthOf(started, 0)
    }).pipe(Effect.provide(withServices({ linear: tracker })))
  })

  it.live('a merge is taken back by a task that reverts it, toward the branch it went into', () =>
    Effect.gen(function* () {
      const { projectId, threadId } = yield* project()
      const instance = yield* Instance
      const tabs = yield* aTask(projectId, 'Tabs keep their order')
      yield* recordAct({
        projectId,
        taskId: tabs,
        threadId,
        kind: 'merge',
        what: 'Merged #634 into main',
        source: 'merge:634',
        undo: { way: 'revert', url: 'https://github.test/meridian/api/pull/634', name: '#634', branch: 'main' },
        actorId: instance.systemId,
      })
      // A release from that repository holds it: the row says so, and its revert is still offered, for what comes next.
      yield* releasedIn(projectId, 'meridian/web', 'v0.8.3')
      assert.isNull((yield* away(projectId, instance.personId)).acts[0]?.cant)
      yield* releasedIn(projectId, 'meridian/api', 'v0.8.4')
      const [merged] = (yield* away(projectId, instance.personId)).acts
      assert.deepStrictEqual([merged?.cant, merged?.undo], ['Released in v0.8.4', 'revert'])
      // Pressed in two windows at once: one revert's task, not two, started once.
      const { revert, made, launched } = yield* reverts(projectId, '50 millis')
      yield* Effect.all([undoAct(merged!.id, revert), undoAct(merged!.id, revert)], { concurrency: 'unbounded' })
      assert.deepStrictEqual([made.length, launched.length], [1, 1])
      const [now] = (yield* away(projectId, instance.personId)).acts
      assert.deepStrictEqual([now?.state, now?.undoTask?.title], ['undoing', 'Revert #634'])
    }).pipe(Effect.provide(withServices())),
  )

  it.live('a take-back cut short by Althar stopping says so, and pressed again makes no second revert', () =>
    Effect.gen(function* () {
      const { projectId, threadId } = yield* project()
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const tabs = yield* aTask(projectId, 'Tabs keep their order')
      yield* recordAct({
        projectId,
        taskId: tabs,
        threadId,
        kind: 'merge',
        what: 'Merged #634 into main',
        source: 'merge:634',
        undo: { way: 'revert', url: 'https://github.test/meridian/api/pull/634', name: '#634', branch: 'main' },
        actorId: instance.systemId,
      })
      const [merged] = (yield* away(projectId, instance.personId)).acts
      const long = new Date(Date.now() - CLAIM_HOLDS_MS - 60_000).toISOString()
      const reverts_ = () => sql<{ n: number }>`SELECT count(*) AS n FROM tasks WHERE title = 'Revert #634'`
      // Claimed, its revert's task made, and Althar stopped before the act was linked to it, or before it started.
      const { revert, made, launched } = yield* reverts(projectId)
      const first = yield* revert.make({ projectId, title: 'Revert #634', description: '', toward: 'main' }, revertCommand(merged!.id))
      for (const linked of [null, first.id]) {
        yield* sql`UPDATE outside_acts SET state = 'undoing', undo_task_id = ${linked}, updated_at = ${long} WHERE id = ${merged!.id}`
        const [stuck] = (yield* away(projectId, instance.personId)).acts
        assert.deepStrictEqual([stuck?.state, stuck?.error], ['failed', 'Althar stopped before it was taken back.'])
      }
      made.length = 0
      yield* undoAct(merged!.id, revert)
      // Pressed again, it is the same task, now started: one revert.
      assert.deepStrictEqual([made, launched], [[first.id], [first.id]])
      assert.strictEqual((yield* reverts_())[0]?.n, 1)
      const [now] = (yield* away(projectId, instance.personId)).acts
      assert.deepStrictEqual([now?.state, now?.undoTask?.taskId], ['undoing', first.id])
      // Started, it holds however long it runs: a press, however much later, starts nothing.
      yield* sql`UPDATE outside_acts SET updated_at = ${long} WHERE id = ${merged!.id}`
      assert.strictEqual((yield* away(projectId, instance.personId)).acts[0]?.state, 'undoing')
      yield* undoAct(merged!.id, revert)
      assert.deepStrictEqual([made.length, launched.length], [1, 1])
      // A claim still holding, with nothing linked yet, isn't taken again either: a slow start goes on alone.
      yield* sql`UPDATE outside_acts SET undo_task_id = NULL, updated_at = ${new Date().toISOString()} WHERE id = ${merged!.id}`
      yield* undoAct(merged!.id, revert)
      assert.deepStrictEqual([made.length, launched.length], [1, 1])
    }).pipe(Effect.provide(withServices())),
  )
})

describe('the coordinator off', () => {
  it.live('refuses the person’s words, and news and Althar’s own go nowhere: nothing starts it', () =>
    Effect.gen(function* () {
      const { projectId, threadId } = yield* project()
      const instance = yield* Instance
      yield* (yield* Policies).set(projectId, { coordinator: false }, instance.personId)
      const coordinator = yield* Coordinator
      const said = yield* Effect.exit(
        coordinator.say({
          envelope: yield* Runtime.envelope('thread.send', { threadId }),
          threadId,
          body: 'Fix the Run menu',
          disposition: 'after_current',
        }),
      )
      const refused = Exit.isFailure(said) ? Option.getOrUndefined(Cause.findErrorOption(said.cause)) : undefined
      assert.instanceOf(refused, CoordinatorOff)
      yield* coordinator.say({
        envelope: yield* Runtime.envelope('coordinator.news', {}),
        threadId,
        body: 'Althar’s merge line (news, not the person’s word): #634 merged.',
        disposition: 'after_current',
        sender: { kind: 'internal' },
        origin: 'news',
        quiet: true,
      })
      const sql = yield* SqlClient.SqlClient
      const [sessions] = yield* sql<{ n: number }>`SELECT count(*) AS n FROM provider_sessions WHERE thread_id = ${threadId}`
      const [inputs] = yield* sql<{ n: number }>`SELECT count(*) AS n FROM user_inputs WHERE thread_id = ${threadId}`
      assert.deepStrictEqual([sessions?.n, inputs?.n], [0, 0])
    }).pipe(Effect.provide(withServices())),
  )

  it.live('turned off through change_settings, as through the window, the coordinator’s running session stops', () =>
    Effect.gen(function* () {
      const { projectId, threadId, access } = yield* project()
      const sessions = yield* Sessions
      yield* (yield* Coordinator).say({
        envelope: yield* Runtime.envelope('thread.send', { threadId }),
        threadId,
        body: 'What is up next?',
        disposition: 'after_current',
      })
      const live = Effect.map(sessions.running(threadId), (running) => (Option.isSome(running) ? [true] : []))
      yield* until(live, (rows) => rows.length === 1)
      assert.match(
        yield* callTool(access, 'change_settings', { section: 'project/general', change: { coordinator: false } }),
        /^Changed General/,
      )
      assert.isFalse(hasCoordinator((yield* (yield* Policies).current(projectId)).rules))
      yield* until(live, (rows) => rows.length === 0)
    }).pipe(Effect.provide(withServices())),
  )

  it.live('Auto gives a new task the team the project’s last task had, else an agent that can work', () =>
    Effect.gen(function* () {
      const { projectId } = yield* project()
      const instance = yield* Instance
      // Nothing planned yet: the first agent that can work, on its own model.
      const first = yield* autoTeam(projectId)
      assert.deepStrictEqual(
        first?.steps.map((step) => [step.key, step.model]),
        [['implement', null]],
      )
      const taskId = yield* aTask(projectId, 'Tabs keep their order')
      const agentId = first?.steps[0]?.agentId ?? ''
      yield* (yield* Plans).propose({
        projectId,
        taskId,
        steps: [
          { key: 'implement', agentId, model: 'opus-5.5', effort: 'high', skipped: false },
          { key: 'review', agentId, model: 'sol', skipped: false },
        ],
        reason: null,
        actorId: instance.coordinatorId,
        held: true,
      })
      const usual = yield* autoTeam(projectId)
      assert.deepStrictEqual(
        usual?.steps.map((step) => [step.key, step.model, step.effort ?? null]),
        [
          ['implement', 'opus-5.5', 'high'],
          ['review', 'sol', null],
        ],
      )
      assert.strictEqual(usual?.reason, 'Auto: the team of the project’s last task')
    }).pipe(Effect.provide(withServices())),
  )
})

describe('a lead’s comment on its pull request', () => {
  it.live('is deleted with Undo while nobody wrote after it; after a reply, it stays, and says who replied', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare) })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const changes = yield* Changes
      const instance = yield* Instance
      const projectId = yield* ask(working, 'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]')
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready')
      const taskId = ready?.taskId ?? ''
      const posts = Effect.map(away(projectId, instance.personId), (seen) => seen.acts.filter((one) => one.kind === 'post'))
      const said = (body: string) => github.commentsOn(1).filter((comment) => comment.body.startsWith(body))
      const noRevert = { make: () => Effect.die('a comment is never reverted'), launch: () => Effect.void }

      yield* changes.reply(taskId, { body: 'Renamed it.', threadId: null, by: 'Claude Code' })
      const [first] = yield* posts
      assert.deepStrictEqual([first?.what, first?.undo, first?.task?.title], ['Commented on #1', 'undo', ready?.title])
      yield* undoAct(first?.id ?? '', noRevert)
      assert.lengthOf(said('Renamed it.'), 0)
      assert.strictEqual((yield* posts).find((one) => one.id === first?.id)?.state, 'undone')

      // Someone wrote after it: it stays, and the row says who in place of Undo.
      yield* changes.reply(taskId, { body: 'Tried again.', threadId: null, by: 'Claude Code' })
      github.commentAs(1, 'dana', 'Why?')
      const second = (yield* posts).find((one) => one.what === 'Commented on #1' && one.state === 'done')
      yield* undoAct(second?.id ?? '', noRevert)
      assert.lengthOf(said('Tried again.'), 1)
      const kept = (yield* posts).find((one) => one.id === second?.id)
      assert.deepStrictEqual([kept?.state, kept?.undo, kept?.cant], ['done', null, 'dana replied'])
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})
