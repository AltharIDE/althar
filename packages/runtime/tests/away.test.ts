import { makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Cause, Effect, Exit, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { autoTeam } from '../src/autoTeam'
import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Coordinator, CoordinatorOff } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { away, clearAway, recordAct, releasedIn, undoAct } from '../src/outsideActs'
import { Plans } from '../src/Plans'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
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

      // Cleared, it starts again from then: only what comes after shows.
      yield* clearAway(projectId, instance.personId)
      const cleared = yield* away(projectId, instance.personId)
      assert.isNotNull(cleared.looked)
      assert.lengthOf(cleared.acts, 0)
      yield* act('merge:635', { what: 'Merged #635 into main' })
      assert.deepStrictEqual(
        (yield* away(projectId, instance.personId)).acts.map((one) => one.what),
        ['Merged #635 into main'],
      )
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
      yield* undoAct(moved.id, (task) => Effect.sync(() => (started.push(task.title), { id: '' })))
      assert.strictEqual((yield* tracker.issue('MER-231')).status.name, before)
      const [now] = (yield* away(projectId, instance.personId)).acts.filter((one) => one.id === moved.id)
      assert.strictEqual(now?.state, 'undone')
      // Done, it isn't done again, and nothing else started.
      yield* undoAct(moved.id, (task) => Effect.sync(() => (started.push(task.title), { id: '' })))
      assert.lengthOf(started, 0)
    }).pipe(Effect.provide(withServices({ linear: tracker })))
  })

  it.live('a merge is taken back by a task that reverts it, toward the branch it went into', () =>
    Effect.gen(function* () {
      const { projectId, threadId } = yield* project()
      const instance = yield* Instance
      const tabs = yield* aTask(projectId, 'Tabs keep their order')
      const revert = yield* aTask(projectId, 'Revert #634')
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
      const asked: Array<{ readonly title: string; readonly toward: string }> = []
      yield* undoAct(merged!.id, (task) => Effect.sync(() => (asked.push({ title: task.title, toward: task.toward }), { id: revert })))
      assert.deepStrictEqual(asked, [{ title: 'Revert #634', toward: 'main' }])
      const [now] = (yield* away(projectId, instance.personId)).acts
      assert.deepStrictEqual([now?.state, now?.undoTask?.title], ['undoing', 'Revert #634'])
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
      const noRevert = () => Effect.die('a comment is never reverted')

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
