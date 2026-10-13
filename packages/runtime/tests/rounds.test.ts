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
import { NoChangeToOpen } from '../src/errors'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { callTool, fakeConnectors, HOST, hosted, items, notices, repository, runtime, until } from './support'

/*
 * A task goes back to work whenever its lead does, and ships again
 * (ADR-034). What the person says to a lead after its plan opens a round of
 * work of its own: the card says Running while it runs, the lead finishes it
 * with finish_step, and it ends where what it left says: back where it was
 * with nothing new, Needs you on a question, Ready with new commits, which
 * go in a new pull request on a new branch once the last one merged.
 */

const runtimeWith = (github: FakeService, file = ':memory:') =>
  Queries.layer.pipe(Layer.provideMerge(runtime(file, {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.millis(100) })))

const git = (cwd: string, ...args: Array<string>) => execFileSync('git', args, { cwd }).toString().trim()

/** The host merges a pull request by squashing it: main gets one commit with its branch's change, and the branch stays as it was. */
const squashMerge = (bare: string, branch: string) => {
  const clone = mkdtempSync(join(tmpdir(), 'althar-merge-'))
  execFileSync('git', ['clone', '-q', bare, clone])
  const as = ['-c', 'user.name=Host', '-c', 'user.email=host@althar.test']
  git(clone, ...as, 'merge', '-q', '--squash', `origin/${branch}`)
  git(clone, ...as, 'commit', '-q', '-m', `Squashed ${branch}`)
  git(clone, 'push', '-q', 'origin', 'main')
}

const connect = () =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    return yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
  })

const cards = (projectId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const snapshot = yield* Effect.orDie(queries.coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

const taskRow = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ state: string; settledAt: string | null }>`SELECT state, settled_at FROM tasks WHERE id = ${taskId}`
    return row
  })

const runsOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ state: string; planId: string | null; endReason: string | null; parameters: string }>`
      SELECT state, plan_id, end_reason, parameters FROM runs WHERE task_id = ${taskId} ORDER BY created_at, rowid`
  })

/** What the person says to the task's lead. */
const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { threadId, body }), threadId, body })
  })

const results = (threadId: string) =>
  Effect.map(items(threadId), (all) => all.filter((item) => item.kind === 'step_result').map((item) => item.content))

/**
 * A planned task whose lead and reviewer did their part, whose draft pull
 * request opened, and which the host merged by squashing it: settled.
 */
const merged = (working: string, bare: string, github: FakeService, markers = '[review:pass]') =>
  Effect.gen(function* () {
    yield* connect()
    const projects = yield* Projects
    const coordinator = yield* Coordinator
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const threadId = yield* coordinator.thread(project.projectId)
    const body = `Add a retry. [coordinator:plan] [lead:finish] [lead:edit] ${markers}`
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
    const [ready] = yield* until(
      cards(project.projectId),
      (all) => all[0]?.phase === 'ready' && all[0].change !== null,
      Duration.seconds(30),
    )
    const card = ready ?? assert.fail('no card')
    squashMerge(bare, 'althar/add-a-retry')
    github.mergeByHand(1)
    yield* (yield* Changes).refresh(card.taskId)
    yield* until(cards(project.projectId), (all) => all[0]?.phase === 'settled', Duration.seconds(10))
    const sql = yield* SqlClient.SqlClient
    const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${card.taskId}`
    return { projectId: project.projectId, taskId: card.taskId, threadId: card.threadId, path: workspace?.path ?? '' }
  })

/** A repository on the fake GitHub, its lead committing as the person does. */
const onGitHub = () => {
  const { working, bare } = hosted()
  const github = makeFakeService({ pushUrl: () => bare })
  github.addRepository(['meridian', 'api'])
  git(working, 'config', 'user.name', 'Fake')
  git(working, 'config', 'user.email', 'fake@althar.test')
  return { working, bare, github }
}

describe('a task that goes back to work', () => {
  it.live('runs again when the person writes to a merged task’s lead, and ships what it did as a second pull request', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const runs = yield* Runs
      const sql = yield* SqlClient.SqlClient
      const task = yield* merged(working, bare, github)
      assert.strictEqual((yield* taskRow(task.taskId))?.state, 'done')
      const mergedHead = git(bare, 'rev-parse', 'althar/add-a-retry')

      // Back to running while its lead works, on a round of its own: the merged task is open again.
      yield* say(task.threadId, 'Add the slider we agreed on. [lead:slowly] [lead:finish]')
      // The card says so as soon as the lead's turn starts, and the round is recorded as it does.
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'running')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'running' && all[0].followUp === true)
      assert.strictEqual((yield* taskRow(task.taskId))?.state, 'open')

      // The lead finishes the round with its summary, the review the plan has looks at what is new, and the task is ready, with
      // a commit that is in no pull request yet.
      const [ready] = yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(30))
      assert.deepStrictEqual(ready?.unshipped, { commits: 1, add: 1, del: 0 })
      assert.deepStrictEqual([ready?.change?.number, ready?.change?.state], [1, 'merged'])
      assert.isFalse(ready?.followUp)
      const all = yield* runsOf(task.taskId)
      assert.deepStrictEqual(
        all.map((run) => [run.state, run.planId === null]),
        [
          ['succeeded', false],
          ['succeeded', true],
        ],
      )
      assert.deepStrictEqual(
        (yield* results(task.threadId)).map((result) => result.step),
        ['implement', 'review', 'publish', 'implement', 'review'],
      )
      const [told] = yield* sql<{ body: string }>`
        SELECT i.body FROM user_inputs i JOIN threads t ON t.id = i.thread_id
        WHERE t.task_id = ${task.taskId} AND t.kind = 'step' AND i.body LIKE 'More to review%'`
      assert.include(told?.body, `git diff ${mergedHead.slice(0, 12)}`)
      assert.isTrue(
        (yield* notices(task.threadId)).some(
          (notice) => notice.title === "PR #1 is merged, so what the follow-up committed isn't in a pull request yet.",
        ),
      )

      // Opened from the task: a new branch from main as the host merged it, with the round's commit alone on it, pushed plainly.
      yield* runs.publish(task.taskId)
      assert.lengthOf(github.changes, 2)
      const second = github.changes[1]
      assert.deepStrictEqual([second?.source, second?.target, second?.draft], ['althar/add-a-retry-2', 'main', true])
      assert.strictEqual(git(bare, 'rev-parse', 'althar/add-a-retry-2^'), git(bare, 'rev-parse', 'main'))
      assert.strictEqual(git(bare, 'rev-list', '--count', 'main..althar/add-a-retry-2'), '1')
      // Described from the round's work, reviewed once; and the merged branch is as it was merged: nothing forced onto it.
      assert.include(second?.body, 'Passed after one round of review.')
      assert.strictEqual(git(bare, 'rev-parse', 'althar/add-a-retry'), mergedHead)
      assert.strictEqual(git(task.path, 'rev-parse', '--abbrev-ref', 'HEAD'), 'althar/add-a-retry-2')
      const [workspace] = yield* sql<{
        branch: string
        baseCommit: string
      }>`SELECT branch, base_commit FROM workspaces WHERE task_id = ${task.taskId}`
      assert.deepStrictEqual([workspace?.branch, workspace?.baseCommit], ['althar/add-a-retry-2', git(bare, 'rev-parse', 'main')])

      // The task shows both: the new one, and the merged one before it.
      const [both] = yield* until(cards(task.projectId), (cards) => cards[0]?.change?.number === 2)
      assert.deepStrictEqual(
        both?.earlier?.map((change) => [change.number, change.state]),
        [[1, 'merged']],
      )
      assert.isNull(both?.unshipped ?? null)
      const queries = yield* Queries
      const header = yield* queries.thread(task.threadId)
      assert.deepStrictEqual(
        header.task.changes.map((change) => change.number),
        [1, 2],
      )
      // So does the coordinator, the latest first.
      const [coordinatorSession] = yield* sql<{ id: string; threadId: string }>`
        SELECT s.id, s.thread_id FROM provider_sessions s JOIN threads t ON t.id = s.thread_id WHERE t.kind = 'coordinator' LIMIT 1`
      const access = {
        role: 'coordinator' as const,
        projectId: task.projectId,
        threadId: coordinatorSession?.threadId ?? '',
        sessionId: coordinatorSession?.id ?? '',
        taskId: null,
      }
      assert.include(yield* callTool(access, 'list_tasks'), 'PR #2 draft')
      assert.include(yield* callTool(access, 'list_tasks'), 'earlier PR #1 merged')

      // Merged in turn, the task is done again.
      squashMerge(bare, 'althar/add-a-retry-2')
      github.mergeByHand(2)
      yield* (yield* Changes).refresh(task.taskId)
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'settled', Duration.seconds(10))
      assert.strictEqual((yield* taskRow(task.taskId))?.state, 'done')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('goes back where it was when its lead makes nothing new: settled, at the time it first settled', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* merged(working, bare, github)
      const before = yield* taskRow(task.taskId)
      yield* say(task.threadId, 'What did you change? [lead:slowly]')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'running')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'settled', Duration.seconds(20))
      assert.deepStrictEqual(yield* taskRow(task.taskId), before)
      const [, round] = yield* runsOf(task.taskId)
      assert.deepStrictEqual([round?.state, round?.planId, round?.endReason], ['succeeded', null, 'nothing_new'])
      // It wasn't reminded to report: there was nothing to report.
      const sql = yield* SqlClient.SqlClient
      const reminded = yield* sql<{ id: string }>`SELECT id FROM user_inputs WHERE body LIKE 'Your step isn''t done%'`
      assert.lengthOf(reminded, 0)
      // Asked again, the lead's report with no step open finishes a round of its own, and the task is back where it was again.
      const [lead] = yield* sql<{
        id: string
      }>`SELECT id FROM provider_sessions WHERE thread_id = ${task.threadId} ORDER BY started_at DESC LIMIT 1`
      const said = yield* callTool(
        { role: 'lead', projectId: task.projectId, threadId: task.threadId, sessionId: lead?.id ?? '', taskId: task.taskId },
        'finish_step',
        { summary: 'Looked again: nothing to change.' },
      )
      assert.strictEqual(said, 'Althar has your summary. Nothing on the branch changed this round, so the task is back where it was.')
      assert.deepStrictEqual(yield* taskRow(task.taskId), before)
      assert.strictEqual((yield* results(task.threadId)).at(-1)?.summary, 'Looked again: nothing to change.')
      assert.lengthOf(yield* runsOf(task.taskId), 3)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('needs the person when its lead asks them something in a round, and goes on with their answer', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const runs = yield* Runs
      const sql = yield* SqlClient.SqlClient
      const task = yield* merged(working, bare, github)
      yield* say(task.threadId, 'Should the cache move? [lead:ask]')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'waiting' && all[0].followUp === true)
      const [question] = yield* sql<{ id: string; payload: string }>`
        SELECT id, payload FROM attention_requests WHERE task_id = ${task.taskId} AND kind = 'question' AND state = 'open'`
      const field = (JSON.parse(question?.payload ?? '{}') as { fields: ReadonlyArray<{ id: string }> }).fields[0]?.id ?? ''
      yield* runs.answer({
        envelope: yield* Runtime.envelope('attention.answer_question', {}),
        attentionId: question?.id ?? '',
        answers: { [field]: { values: ['Postgres'] } },
      })
      // Answered, it changed nothing, so the task is back where it was.
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'settled', Duration.seconds(20))
      assert.strictEqual((yield* taskRow(task.taskId))?.state, 'done')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('lets the person skip a round’s review', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const runs = yield* Runs
      const queries = yield* Queries
      const task = yield* merged(working, bare, github)
      yield* say(task.threadId, 'Add the slider. [lead:slowly] [lead:finish]')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'running')
      assert.isTrue((yield* queries.thread(task.threadId)).task.skipReview)
      yield* runs.skipReview({ envelope: yield* Runtime.envelope('task.skip_review', {}), taskId: task.taskId })
      assert.isFalse((yield* queries.thread(task.threadId)).task.skipReview)
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(30))
      // No review of the round: the plan's, then the round's own report.
      assert.deepStrictEqual(
        (yield* results(task.threadId)).map((result) => result.step),
        ['implement', 'review', 'publish', 'implement'],
      )
      const [plan, round] = yield* runsOf(task.taskId)
      const reviewOf = (parameters: string | undefined) =>
        (JSON.parse(parameters ?? '{}') as { steps: ReadonlyArray<{ key: string; skipped: boolean }> }).steps.find(
          (step) => step.key === 'review',
        )?.skipped
      assert.deepStrictEqual([reviewOf(plan?.parameters), reviewOf(round?.parameters)], [false, true])
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('stays ready when its pull request merges with commits after it, and ships them; and after a close, all of it', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const runs = yield* Runs
      yield* connect()
      const projects = yield* Projects
      const coordinator = yield* Coordinator
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const threadId = yield* coordinator.thread(project.projectId)
      const body = 'Add a retry. [coordinator:plan] [coordinator:plan-no-review] [lead:finish] [lead:edit]'
      yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
      const [ready] = yield* until(
        cards(project.projectId),
        (all) => all[0]?.phase === 'ready' && all[0].change !== null,
        Duration.seconds(30),
      )
      const taskId = ready?.taskId ?? ''
      const sql = yield* SqlClient.SqlClient
      const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${taskId}`
      const path = workspace?.path ?? ''
      // Its lead commits after the push, and the pull request merges without it.
      appendFileSync(join(path, 'later.txt'), 'later\n')
      git(path, 'add', '-A')
      git(path, '-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', 'commit', '-q', '-m', 'Later')
      squashMerge(bare, 'althar/add-a-retry')
      github.mergeByHand(1)
      yield* (yield* Changes).refresh(taskId)
      const [after] = yield* until(cards(project.projectId), (all) => all[0]?.unshipped != null, Duration.seconds(10))
      assert.deepStrictEqual([after?.phase, after?.unshipped], ['ready', { commits: 1, add: 1, del: 0 }])
      assert.strictEqual((yield* taskRow(taskId))?.state, 'open')
      assert.isTrue(
        (yield* notices(ready?.threadId ?? '')).some(
          (notice) => notice.title === "Not done yet: 1 commit after PR #1 isn't in a pull request.",
        ),
      )
      yield* runs.publish(taskId)
      assert.strictEqual(github.changes[1]?.source, 'althar/add-a-retry-2')
      assert.strictEqual(git(bare, 'log', '-1', '--format=%s', 'althar/add-a-retry-2'), 'Later')
      // Nothing new now, there is nothing to open, and its pull request is open: the card pushes to it.
      assert.strictEqual(((yield* Effect.flip(runs.publish(taskId))) as NoChangeToOpen).why, 'opened')

      // Closed without merging, a next pull request has all of the branch: nothing of it is in.
      github.close(2)
      yield* (yield* Changes).refresh(taskId)
      yield* until(cards(project.projectId), (all) => all[0]?.change?.state === 'closed')
      assert.strictEqual(((yield* Effect.flip(runs.publish(taskId))) as NoChangeToOpen).why, 'nothing')
      appendFileSync(join(path, 'more.txt'), 'more\n')
      git(path, 'add', '-A')
      git(path, '-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', 'commit', '-q', '-m', 'More')
      yield* until(cards(project.projectId), (all) => all[0]?.unshipped != null)
      yield* runs.publish(taskId)
      assert.strictEqual(github.changes[2]?.source, 'althar/add-a-retry-3')
      assert.strictEqual(git(bare, 'rev-list', '--count', 'main..althar/add-a-retry-3'), '2')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('refuses a next pull request whose commits conflict with main, and leaves the worktree on its branch', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const runs = yield* Runs
      const task = yield* merged(working, bare, github)
      // Someone else changes on main the line the round changes again.
      const clone = mkdtempSync(join(tmpdir(), 'althar-other-'))
      execFileSync('git', ['clone', '-q', bare, clone])
      appendFileSync(join(clone, 'change.txt'), 'theirs\n')
      git(clone, 'add', '-A')
      git(clone, '-c', 'user.name=Other', '-c', 'user.email=other@althar.test', 'commit', '-q', '-m', 'Theirs')
      git(clone, 'push', '-q', 'origin', 'main')
      yield* say(task.threadId, 'Once more. [lead:finish]')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready' && all[0].unshipped != null, Duration.seconds(30))
      const refused = (yield* Effect.flip(runs.publish(task.taskId))) as NoChangeToOpen
      assert.deepStrictEqual([refused.why, refused.detail], ['conflicts', 'change.txt'])
      assert.strictEqual(git(task.path, 'rev-parse', '--abbrev-ref', 'HEAD'), 'althar/add-a-retry')
      assert.strictEqual(git(task.path, 'status', '--porcelain'), '')
      assert.lengthOf(github.changes, 1)
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('a round of work and a restart', () => {
  it.live('carries on a round under way when Althar restarts, and its lead finishes it', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'althar-rounds-')), 'althar.db')
    return Effect.gen(function* () {
      // A plan that ends on its branch, done; then the person asks its lead for more, which it is at when Althar stops.
      const started = yield* Effect.gen(function* () {
        const plans = yield* Plans
        const projects = yield* Projects
        const sql = yield* SqlClient.SqlClient
        const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
        const [person] = yield* sql<{ id: string }>`SELECT id FROM actors WHERE kind = 'person'`
        const actor = (person?.id ?? '') as Parameters<typeof plans.hold>[1]
        const created = yield* projects.createTask({
          envelope: yield* Runtime.envelope('task.create', {}),
          projectId: project.projectId,
          title: 'Carry on after a restart',
          description: 'Do it. [lead:finish] [lead:edit]',
          draft: true,
        })
        const planId = yield* plans.propose({
          projectId: project.projectId as Parameters<typeof plans.propose>[0]['projectId'],
          taskId: created.taskId,
          steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
          reason: null,
          actorId: actor,
        })
        yield* plans.start(planId, actor)
        yield* until(runsOf(created.taskId), (rows) => rows[0]?.state === 'succeeded', Duration.seconds(20))
        yield* say(created.threadId, 'One more thing. [lead:wait]')
        yield* until(runsOf(created.taskId), (rows) => rows[1]?.state === 'running' && rows[1].planId === null)
        return { ...created, projectId: project.projectId }
      }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(file)))))

      yield* Effect.gen(function* () {
        // It carries on by itself, says so, and its lead finishes it, with a new commit.
        yield* until(notices(started.threadId), (all) =>
          all.some((notice) => notice.title === 'Althar restarted; the step carried on from here.'),
        )
        const [, round] = yield* until(runsOf(started.taskId), (rows) => rows[1]?.state === 'succeeded', Duration.seconds(20))
        assert.deepStrictEqual([round?.planId, round?.endReason], [null, null])
        const [card] = yield* until(cards(started.projectId), (all) => all[0]?.phase === 'ready')
        assert.strictEqual(card?.change, null)
        const sql = yield* SqlClient.SqlClient
        const [workspace] = yield* sql<{
          path: string
          baseCommit: string
        }>`SELECT path, base_commit FROM workspaces WHERE task_id = ${started.taskId}`
        assert.strictEqual(git(workspace?.path ?? '', 'rev-list', '--count', `${workspace?.baseCommit ?? ''}..HEAD`), '2')
      }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(file)))))
    })
  })
})
