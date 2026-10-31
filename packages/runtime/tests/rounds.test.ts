import { budget } from '@althar/testing'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { DESCRIBED, type FakeAgentOptions, holds } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { NoChangeToOpen } from '../src/errors'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Questions } from '../src/Questions'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import { callTool, fakeConnectors, HOST, hosted, items, notices, repository, runtime, until } from './support'

/*
 * A task goes back to work whenever its lead does, and ships again
 * (ADR-034). What the person says to a lead after its plan opens a round of
 * work of its own: the card says Running while it runs, the lead finishes it
 * with finish_step, and it ends where what it left says: back where it was
 * with nothing new, Needs you on a question, Ready with new commits, which
 * go in a new pull request on a new branch once the last one merged.
 */

const runtimeWith = (github: FakeService, file = ':memory:', agents: FakeAgentOptions = {}) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(file, agents, { connectors: fakeConnectors({ github }), listenEvery: Duration.millis(100) })),
  )

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

/**
 * What the person says to the task's lead, as the task's screen says it: with no agent on the thread, as once its task
 * settled, it starts its lead after queuing what they said.
 */
const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    const held = Option.isSome(yield* sessions.running(threadId))
    yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { threadId, body }), threadId, body })
    // Started already by settling, where it was stopping as it was written to.
    if (!held) yield* Effect.ignore(sessions.startLast(threadId))
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
    const [ready] = yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready' && all[0].change !== null)
    const card = ready ?? assert.fail('no card')
    squashMerge(bare, 'althar/add-a-retry')
    github.mergeByHand(1)
    yield* (yield* Changes).refresh(card.taskId)
    yield* until(cards(project.projectId), (all) => all[0]?.phase === 'settled')
    const sql = yield* SqlClient.SqlClient
    const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${card.taskId}`
    return { projectId: project.projectId, taskId: card.taskId, threadId: card.threadId, path: workspace?.path ?? '' }
  })

/** A repository on the fake GitHub, its lead committing as the person does; `pushes.to` is where what is pushed goes. */
const onGitHub = () => {
  const { working, bare } = hosted()
  const pushes = { to: bare }
  const github = makeFakeService({ pushUrl: () => pushes.to })
  github.addRepository(['meridian', 'api'])
  git(working, 'config', 'user.name', 'Fake')
  git(working, 'config', 'user.email', 'fake@althar.test')
  return { working, bare, github, pushes }
}

describe('a task that goes back to work', () => {
  it.live('runs again when the person writes to a merged task’s lead, and ships what it did as a second pull request', () => {
    const { working, bare, github, pushes } = onGitHub()
    const slow = holds()
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
      slow.open('[lead:slowly]')

      // The lead finishes the round with its summary, the review the plan has looks at what is new, and the task is ready, with
      // a commit that is in no pull request yet.
      const [ready] = yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready')
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

      // Where main can't be fetched, nothing moves: as this Mac last saw it, main hasn't what merged.
      pushes.to = join(bare, 'nowhere')
      yield* Effect.flip(runs.publish(task.taskId))
      assert.strictEqual(git(task.path, 'rev-parse', '--abbrev-ref', 'HEAD'), 'althar/add-a-retry')
      pushes.to = bare
      // A push the host refuses leaves the worktree on the new branch, its commit still offered, and the next try takes that branch.
      const refuse = join(bare, 'hooks', 'pre-receive')
      writeFileSync(refuse, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
      yield* Effect.flip(runs.publish(task.taskId))
      assert.strictEqual(git(task.path, 'rev-parse', '--abbrev-ref', 'HEAD'), 'althar/add-a-retry-2')
      assert.deepStrictEqual((yield* cards(task.projectId))[0]?.unshipped, { commits: 1, add: 1, del: 0 })
      rmSync(refuse)

      // Opened from the task: a new branch from main as the host merged it, with the round's commit alone on it, pushed plainly.
      yield* runs.publish(task.taskId)
      assert.lengthOf(github.changes, 2)
      const second = github.changes[1]
      assert.deepStrictEqual([second?.source, second?.target, second?.draft], ['althar/add-a-retry-2', 'main', true])
      assert.strictEqual(git(bare, 'rev-parse', 'althar/add-a-retry-2^'), git(bare, 'rev-parse', 'main'))
      assert.strictEqual(git(bare, 'rev-list', '--count', 'main..althar/add-a-retry-2'), '1')
      // Described as the lead wrote it for the round's work, with nothing of its review; and the merged branch is as it was merged.
      assert.isTrue(second?.body.startsWith(`${DESCRIBED}\n\n`))
      assert.notMatch(second?.body ?? '', /review/i)
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
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'settled')
      assert.strictEqual((yield* taskRow(task.taskId))?.state, 'done')
    }).pipe(Effect.provide(runtimeWith(github, ':memory:', { holds: slow })))
  })

  it.live('goes back where it was when its lead makes nothing new: settled, at the time it first settled', () => {
    const { working, bare, github } = onGitHub()
    const slow = holds()
    return Effect.gen(function* () {
      const task = yield* merged(working, bare, github)
      const before = yield* taskRow(task.taskId)
      yield* say(task.threadId, 'What did you change? [lead:slowly]')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'running')
      slow.open('[lead:slowly]')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'settled')
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
      // Settled again, its lead stops once its turn ends.
      const sessions = yield* Sessions
      yield* until(
        Effect.map(sessions.running(task.threadId), (running) => (Option.isNone(running) ? [true] : [])),
        (gone) => gone.length === 1,
      )
    }).pipe(Effect.provide(runtimeWith(github, ':memory:', { holds: slow })))
  })

  it.live('counts an edit to a file left uncommitted before the round as new work', () => {
    const { working, bare, github } = onGitHub()
    const slow = holds()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* merged(working, bare, github)
      writeFileSync(join(task.path, 'notes.txt'), 'before\n')
      yield* say(task.threadId, 'Note what you found. [lead:slowly]')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'running')
      // The lead changes the file it had left uncommitted, and its turn ends without a report: not nothing new.
      appendFileSync(join(task.path, 'notes.txt'), 'and after\n')
      slow.open('[lead:slowly]')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'waiting')
      const [call] = yield* sql<{ payload: string }>`
          SELECT payload FROM attention_requests WHERE task_id = ${task.taskId} AND kind = 'stuck' AND state = 'open'`
      assert.include(call?.payload, '"why":"no_report"')
    }).pipe(Effect.provide(runtimeWith(github, ':memory:', { holds: slow })))
  })

  it.live('is ready on the home as on the board when a merged task has commits after its pull request', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const queries = yield* Queries
      const task = yield* merged(working, bare, github)
      const homeHas = Effect.map(queries.home(), (home) => home.tasks.filter((one) => one.taskId === task.taskId).map((one) => one.phase))
      // Merged and settled, it is on neither: the board keeps it below, and the home has no use for it.
      assert.deepStrictEqual(yield* homeHas, [])
      // The person commits to its branch after the merge: still done, but ready for a new pull request, on the board and the home.
      writeFileSync(join(task.path, 'after.txt'), 'after the merge\n')
      git(task.path, 'add', '-A')
      git(task.path, '-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', 'commit', '-q', '-m', 'After the merge')
      const [ready] = yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready')
      assert.strictEqual((yield* taskRow(task.taskId))?.state, 'done')
      assert.strictEqual(ready?.unshipped?.commits, 1)
      yield* until(homeHas, (phases) => phases[0] === 'ready')
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
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'settled')
      assert.strictEqual((yield* taskRow(task.taskId))?.state, 'done')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('needs the person when its lead leaves new work unreported, and given up, goes back where it was, its commit offered', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const runs = yield* Runs
      const sql = yield* SqlClient.SqlClient
      const task = yield* merged(working, bare, github, '[review:pass] [lead:push]')
      const before = yield* taskRow(task.taskId)
      // It commits, and asks for a push to a pull request that merged: refused, it reports nothing, is reminded, and still doesn't.
      yield* say(task.threadId, 'Tidy it up, and push pls.')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'waiting')
      const [call] = yield* sql<{ id: string; payload: string }>`
        SELECT id, payload FROM attention_requests WHERE task_id = ${task.taskId} AND kind = 'stuck' AND state = 'open'`
      assert.include(call?.payload, '"why":"no_report"')
      const [reminded] = yield* sql<{ body: string }>`SELECT body FROM user_inputs WHERE body LIKE 'Your step isn''t done%'`
      assert.include(reminded?.body, "you changed the task's work since the person last wrote to you")
      yield* runs.answerStuck({
        envelope: yield* Runtime.envelope('attention.answer_stuck', {}),
        attentionId: call?.id ?? '',
        answer: { kind: 'abandon' },
      })
      // Back where it was, but its commit is in no pull request: it stays open, offered one, so the home and the board keep it.
      const [card] = yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready')
      assert.deepStrictEqual(card?.unshipped, { commits: 1, add: 1, del: 0 })
      assert.strictEqual(before?.state, 'done')
      assert.deepStrictEqual(yield* taskRow(task.taskId), { state: 'open', settledAt: null })
      const [, round] = yield* runsOf(task.taskId)
      assert.deepStrictEqual([round?.state, round?.endReason], ['succeeded', 'abandoned'])
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('lets the person skip a round’s review', () => {
    const { working, bare, github } = onGitHub()
    const slow = holds()
    return Effect.gen(function* () {
      const runs = yield* Runs
      const queries = yield* Queries
      const task = yield* merged(working, bare, github)
      yield* say(task.threadId, 'Add the slider. [lead:slowly] [lead:finish]')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'running')
      assert.isTrue((yield* queries.thread(task.threadId)).task.skipReview)
      yield* runs.skipReview({ envelope: yield* Runtime.envelope('task.skip_review', {}), taskId: task.taskId })
      assert.isFalse((yield* queries.thread(task.threadId)).task.skipReview)
      slow.open('[lead:slowly]')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready')
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
    }).pipe(Effect.provide(runtimeWith(github, ':memory:', { holds: slow })))
  })

  it.live('withdraws what the reviewer asked when its review is skipped, so the task doesn’t wait on it', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const runs = yield* Runs
      const questions = yield* Questions
      const sql = yield* SqlClient.SqlClient
      yield* connect()
      const projects = yield* Projects
      const coordinator = yield* Coordinator
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const threadId = yield* coordinator.thread(project.projectId)
      const body = 'Add a retry. [coordinator:plan] [lead:finish] [lead:edit] [review:wait]'
      yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
      // The reviewer is at work, and asks the person something.
      const review = yield* until(
        sql<{ projectId: ProjectId; taskId: string; threadId: string; sessionId: string }>`
            SELECT t.project_id, t.task_id, t.id AS thread_id, s.id AS session_id FROM threads t JOIN provider_sessions s ON s.thread_id = t.id
            WHERE t.kind = 'step' AND t.node_key = 'review' AND s.state = 'active'`,
        (rows) => rows.length > 0,
      ).pipe(Effect.map(([row]) => row ?? assert.fail('no reviewer')))
      yield* Effect.forkChild(
        questions.ask(
          { projectId: review.projectId, threadId: review.threadId, taskId: review.taskId, sessionId: review.sessionId },
          {
            message: 'Which cache?',
            fields: [
              {
                id: 'cache',
                question: 'Which cache?',
                type: 'choice',
                options: [{ value: 'Postgres', label: 'Postgres' }],
                multiple: false,
                required: true,
              },
            ],
          },
        ),
      )
      yield* until(cards(project.projectId), (all) => all[0]?.phase === 'waiting')
      yield* runs.skipReview({ envelope: yield* Runtime.envelope('task.skip_review', {}), taskId: review.taskId })
      // Its question goes with it, as one the agent went on without, and the task goes on to its end.
      const [asked] = yield* sql<{ state: string; payload: string }>`
          SELECT state, payload FROM attention_requests WHERE task_id = ${review.taskId} AND kind = 'question'`
      assert.strictEqual(asked?.state, 'withdrawn')
      assert.include(asked?.payload, '"withdrawn":"turn"')
      yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready')
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
      const [ready] = yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready' && all[0].change !== null)
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
      const [after] = yield* until(cards(project.projectId), (all) => all[0]?.unshipped != null)
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
      // Merged, it is done: the pull request closed before it is history, not one still open.
      squashMerge(bare, 'althar/add-a-retry-3')
      github.mergeByHand(3)
      yield* (yield* Changes).refresh(taskId)
      yield* until(cards(project.projectId), (all) => all[0]?.phase === 'settled')
      assert.strictEqual((yield* taskRow(taskId))?.state, 'done')
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
      yield* until(runsOf(task.taskId), (rows) => rows[1]?.state === 'succeeded')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready' && all[0].unshipped != null)
      const refused = (yield* Effect.flip(runs.publish(task.taskId))) as NoChangeToOpen
      assert.deepStrictEqual([refused.why, refused.detail], ['conflicts', 'change.txt'])
      assert.strictEqual(git(task.path, 'rev-parse', '--abbrev-ref', 'HEAD'), 'althar/add-a-retry')
      assert.strictEqual(git(task.path, 'status', '--porcelain'), '')
      assert.lengthOf(github.changes, 1)
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('a task’s next pull request, in its repositories', () => {
  it.live(
    'opens one where a repository’s last merged with commits after it, while another’s stays open; and opens the rest once a try failed half way',
    () => {
      const folder = realpathSync(mkdtempSync(join(tmpdir(), 'althar-folder-')))
      const bares: Record<string, string> = {}
      for (const name of ['api', 'web']) {
        const path = join(folder, name)
        mkdirSync(path)
        git(path, 'init', '-q', '-b', 'main')
        writeFileSync(join(path, 'README.md'), `# ${name}\n`)
        git(path, 'add', '.')
        git(path, '-c', 'user.name=T', '-c', 'user.email=t@t.test', 'commit', '-q', '-m', 'Start')
        git(path, 'remote', 'add', 'origin', `${HOST}/meridian/${name}.git`)
        bares[name] = mkdtempSync(join(tmpdir(), 'althar-remote-'))
        execFileSync('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: bares[name] })
        git(path, 'push', '-q', bares[name] ?? '', 'main')
      }
      const github = makeFakeService({ pushUrl: (path) => bares[path.at(-1) ?? ''] ?? '' })
      github.addRepository(['meridian', 'api'])
      github.addRepository(['meridian', 'web'])
      const commitIn = (path: string, file: string, message: string) => {
        appendFileSync(join(path, file), `${message}\n`)
        git(path, 'add', '-A')
        git(path, '-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', 'commit', '-q', '-m', message)
      }
      return Effect.gen(function* () {
        const runs = yield* Runs
        const sql = yield* SqlClient.SqlClient
        const instance = yield* Instance
        yield* connect()
        const projects = yield* Projects
        const plans = yield* Plans
        const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: folder })
        const task = yield* projects.createTask({
          envelope: yield* Runtime.envelope('task.create', {}),
          projectId: project.projectId,
          title: 'Share the retry',
          description: '[lead:finish]',
          draft: true,
          repositories: ['api', 'web'],
        })
        const worktrees = yield* sql<{ path: string }>`
        SELECT w.path FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id WHERE w.task_id = ${task.taskId} ORDER BY b.created_at, b.rowid`
        const [api = '', web = ''] = worktrees.map((worktree) => worktree.path)
        commitIn(api, 'retry.txt', 'Retry')
        commitIn(web, 'retry.txt', 'Retry')
        const planId = yield* plans.propose({
          projectId: project.projectId as Parameters<typeof plans.propose>[0]['projectId'],
          taskId: task.taskId,
          steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
          reason: null,
          actorId: instance.personId,
        })
        yield* plans.start(planId, instance.personId)
        yield* until(
          Effect.sync(() => github.changes),
          (changes) => changes.length === 2,
        )
        yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready')

        // api's merges, and its lead commits more; web's stays open. api's commit opens a pull request of its own, web's isn't touched.
        squashMerge(bares.api ?? '', task.branch)
        github.mergeByHand(1)
        yield* (yield* Changes).refresh(task.taskId)
        yield* until(cards(project.projectId), (all) => all[0]?.change?.number === 2)
        commitIn(api, 'retry.txt', 'More for api')
        const [mixed] = yield* until(cards(project.projectId), (all) => all[0]?.unshipped != null)
        assert.deepStrictEqual([mixed?.phase, mixed?.change?.number, mixed?.unshipped?.commits], ['ready', 2, 1])
        yield* runs.publish(task.taskId)
        assert.lengthOf(github.changes, 3)
        assert.strictEqual(github.changes[2]?.source, `${task.branch}-2`)
        assert.strictEqual(git(bares.api ?? '', 'log', '-1', '--format=%s', `${task.branch}-2`), 'More for api')
        assert.strictEqual(git(web, 'rev-parse', '--abbrev-ref', 'HEAD'), task.branch)

        // Both merge, and each gets more; web's host refuses the push: api's opens, and trying again opens web's alone.
        squashMerge(bares.api ?? '', `${task.branch}-2`)
        squashMerge(bares.web ?? '', task.branch)
        github.mergeByHand(2)
        github.mergeByHand(3)
        yield* (yield* Changes).refresh(task.taskId)
        yield* until(cards(project.projectId), (all) => all[0]?.phase === 'settled')
        commitIn(api, 'retry.txt', 'Again for api')
        commitIn(web, 'retry.txt', 'More for web')
        yield* until(cards(project.projectId), (all) => all[0]?.unshipped?.commits === 2)
        const refuse = join(bares.web ?? '', 'hooks', 'pre-receive')
        writeFileSync(refuse, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
        yield* Effect.flip(runs.publish(task.taskId))
        assert.lengthOf(github.changes, 4)
        assert.strictEqual(github.changes[3]?.source, `${task.branch}-3`)
        rmSync(refuse)
        yield* runs.publish(task.taskId)
        assert.lengthOf(github.changes, 5)
        assert.strictEqual(github.changes[4]?.source, `${task.branch}-2`)
        assert.strictEqual(git(bares.web ?? '', 'log', '-1', '--format=%s', `${task.branch}-2`), 'More for web')
      }).pipe(Effect.provide(runtimeWith(github)))
    },
    budget.large,
  )

  it.live('starts a fork’s next pull request from the main of the repository it opens on, not the fork’s, behind what merged', () => {
    const { working, bare: fork } = hosted(['you', 'api'])
    git(working, 'remote', 'add', 'upstream', `${HOST}/meridian/api.git`)
    const upstream = mkdtempSync(join(tmpdir(), 'althar-upstream-'))
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: upstream })
    git(working, 'push', '-q', upstream, 'main')
    git(working, 'config', 'user.name', 'Fake')
    git(working, 'config', 'user.email', 'fake@althar.test')
    const github = makeFakeService({ pushUrl: (path) => (path.join('/') === 'meridian/api' ? upstream : fork) })
    github.addRepository(['you', 'api'])
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const runs = yield* Runs
      yield* connect()
      const projects = yield* Projects
      const coordinator = yield* Coordinator
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const [repository] = yield* projects.repositories(project.projectId)
      yield* projects.setRepository({ projectId: project.projectId, repositoryId: repository?.id ?? '', changeTarget: 'upstream' })
      const threadId = yield* coordinator.thread(project.projectId)
      const body = 'Add a retry. [coordinator:plan] [coordinator:plan-no-review] [lead:finish] [lead:edit]'
      yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
      const [ready] = yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready' && all[0].change !== null)
      assert.strictEqual(github.forkOf(1), 'you/api')
      // Upstream merges it, squashed, from the fork's branch; the fork's own main stays where it was.
      const clone = mkdtempSync(join(tmpdir(), 'althar-merge-'))
      execFileSync('git', ['clone', '-q', upstream, clone])
      git(clone, 'fetch', '-q', fork, 'althar/add-a-retry')
      git(clone, '-c', 'user.name=Host', '-c', 'user.email=host@althar.test', 'merge', '-q', '--squash', 'FETCH_HEAD')
      git(clone, '-c', 'user.name=Host', '-c', 'user.email=host@althar.test', 'commit', '-q', '-m', 'Squashed')
      git(clone, 'push', '-q', 'origin', 'main')
      github.mergeByHand(1)
      yield* (yield* Changes).refresh(ready?.taskId ?? '')
      yield* until(cards(project.projectId), (all) => all[0]?.phase === 'settled')
      yield* say(ready?.threadId ?? '', 'Once more. [lead:finish]')
      yield* until(runsOf(ready?.taskId ?? ''), (rows) => rows[1]?.state === 'succeeded')
      // It edits the line the merged pull request added: from upstream's main it applies, from the fork's stale main it wouldn't.
      yield* runs.publish(ready?.taskId ?? '')
      assert.strictEqual(github.changes[1]?.source, 'althar/add-a-retry-2')
      assert.strictEqual(github.forkOf(2), 'you/api')
      assert.strictEqual(git(fork, 'rev-parse', 'althar/add-a-retry-2^'), git(upstream, 'rev-parse', 'main'))
      assert.strictEqual(git(fork, 'rev-parse', 'main'), git(working, 'rev-parse', 'main'))
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('takes what its lead committed after the plan, before it reported, as the round’s: reviewed as the plan says', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* connect()
      const projects = yield* Projects
      const coordinator = yield* Coordinator
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const threadId = yield* coordinator.thread(project.projectId)
      const body = 'Add a retry. [coordinator:plan] [lead:finish] [lead:edit] [review:pass]'
      yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
      const [ready] = yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready' && all[0].change !== null)
      const taskId = ready?.taskId ?? ''
      // Told its checks failed, as Althar tells it with no round, the lead fixes them and commits; then it reports.
      const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${taskId}`
      appendFileSync(join(workspace?.path ?? '', 'fixed.txt'), 'fixed\n')
      git(workspace?.path ?? '', 'add', '-A')
      git(workspace?.path ?? '', '-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', 'commit', '-q', '-m', 'Fix the failing check')
      const [lead] = yield* sql<{
        id: string
      }>`SELECT id FROM provider_sessions WHERE thread_id = ${ready?.threadId ?? ''} ORDER BY started_at DESC LIMIT 1`
      const said = yield* callTool(
        { role: 'lead', projectId: project.projectId, threadId: ready?.threadId ?? '', sessionId: lead?.id ?? '', taskId },
        'finish_step',
        { summary: 'Fixed the failing check.', built: 'The check passes again.' },
      )
      assert.strictEqual(said, 'Althar has your summary. A review starts now; wait for its findings.')
      const [, round] = yield* until(runsOf(taskId), (rows) => rows[1]?.state === 'succeeded')
      assert.deepStrictEqual([round?.planId, round?.endReason], [null, null])
      assert.deepStrictEqual(
        (yield* results(ready?.threadId ?? '')).map((result) => result.step),
        ['implement', 'review', 'publish', 'implement', 'review'],
      )
      const [after] = yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready')
      assert.strictEqual(after?.change?.unpushed, 1)
      assert.strictEqual(git(bare, 'rev-list', '--count', 'main..althar/add-a-retry'), '1')
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('a task’s first pull request in a repository, and a reported round with nothing to go by', () => {
  it.live(
    'opens a repository’s first pull request after another’s merged, as a follow-up changes it for the first time; then each one’s next, described anew',
    () => {
      const folder = realpathSync(mkdtempSync(join(tmpdir(), 'althar-folder-')))
      const bares: Record<string, string> = {}
      for (const name of ['api', 'web']) {
        const path = join(folder, name)
        mkdirSync(path)
        git(path, 'init', '-q', '-b', 'main')
        writeFileSync(join(path, 'README.md'), `# ${name}\n`)
        git(path, 'add', '.')
        git(path, '-c', 'user.name=T', '-c', 'user.email=t@t.test', 'commit', '-q', '-m', 'Start')
        git(path, 'remote', 'add', 'origin', `${HOST}/meridian/${name}.git`)
        bares[name] = mkdtempSync(join(tmpdir(), 'althar-remote-'))
        execFileSync('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: bares[name] })
        git(path, 'push', '-q', bares[name] ?? '', 'main')
      }
      const github = makeFakeService({ pushUrl: (path) => bares[path.at(-1) ?? ''] ?? '' })
      github.addRepository(['meridian', 'api'])
      github.addRepository(['meridian', 'web'])
      const commitIn = (path: string, file: string, message: string) => {
        appendFileSync(join(path, file), `${message}\n`)
        git(path, 'add', '-A')
        git(path, '-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', 'commit', '-q', '-m', message)
      }
      return Effect.gen(function* () {
        const runs = yield* Runs
        const sql = yield* SqlClient.SqlClient
        const instance = yield* Instance
        yield* connect()
        const projects = yield* Projects
        const plans = yield* Plans
        const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: folder })
        const task = yield* projects.createTask({
          envelope: yield* Runtime.envelope('task.create', {}),
          projectId: project.projectId,
          title: 'Share the retry',
          description: '[lead:finish]',
          draft: true,
          repositories: ['api', 'web'],
        })
        const worktrees = yield* sql<{ path: string }>`
        SELECT w.path FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id WHERE w.task_id = ${task.taskId} ORDER BY b.created_at, b.rowid`
        const [api = '', web = ''] = worktrees.map((worktree) => worktree.path)
        // Its plan changes api alone: api's pull request opens, and web has nothing to propose.
        commitIn(api, 'retry.txt', 'Retry')
        const planId = yield* plans.propose({
          projectId: project.projectId as Parameters<typeof plans.propose>[0]['projectId'],
          taskId: task.taskId,
          steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
          reason: null,
          actorId: instance.personId,
        })
        yield* plans.start(planId, instance.personId)
        yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready' && all[0].change !== null)
        assert.lengthOf(github.changes, 1)
        squashMerge(bares.api ?? '', task.branch)
        github.mergeByHand(1)
        yield* (yield* Changes).refresh(task.taskId)
        yield* until(cards(project.projectId), (all) => all[0]?.phase === 'settled')

        // Its lead goes back to work on web, for the first time, and reports.
        commitIn(web, 'retry.txt', 'Web first')
        const [lead] = yield* sql<{
          id: string
        }>`SELECT id FROM provider_sessions WHERE thread_id = ${task.threadId} ORDER BY started_at DESC LIMIT 1`
        const access = {
          role: 'lead',
          projectId: project.projectId,
          threadId: task.threadId,
          sessionId: lead?.id ?? '',
          taskId: task.taskId,
        } as const
        // Web's pull request is its first, so the lead is asked for its description; api's merged one has its own already.
        const asked = yield* callTool(access, 'finish_step', { summary: 'Did web too.', built: 'The retry, in web too.' })
        assert.match(asked, /^Write the description of the task's pull request before you finish, one for each of web\. /)
        const said = yield* callTool(access, 'finish_step', {
          summary: 'Did web too.',
          built: 'The retry, in web too.',
          descriptions: [{ repository: 'web', text: 'Web gave up on the first failed call too. It now retries once, as api does.' }],
        })
        assert.strictEqual(said, 'Althar has your summary. The task is ready for the person.')
        const [ready] = yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready' && all[0].unshipped != null)
        assert.deepStrictEqual(ready?.unshipped, { commits: 1, add: 1, del: 0 })
        assert.isTrue(
          (yield* notices(task.threadId)).some(
            (notice) => notice.title === "web has no pull request, so what the follow-up committed isn't in a pull request yet.",
          ),
        )
        // Web's first opens, from the task's branch, as a first one does; api's merged one stays as it is.
        yield* runs.publish(task.taskId)
        assert.lengthOf(github.changes, 2)
        assert.include(github.changes[1]?.url, '/meridian/web/')
        assert.strictEqual(github.changes[1]?.source, task.branch)
        assert.isTrue(github.changes[1]?.body.startsWith('Web gave up on the first failed call too.'))
        assert.strictEqual(git(bares.web ?? '', 'log', '-1', '--format=%s', task.branch), 'Web first')
        assert.strictEqual(git(api, 'rev-parse', '--abbrev-ref', 'HEAD'), task.branch)

        // Web's merges too, and the lead changes both again. Web's description came after api's pull request opened, but before
        // web's own: each next pull request is asked for one of its own, by when its repository's last one opened.
        squashMerge(bares.web ?? '', task.branch)
        github.mergeByHand(2)
        yield* (yield* Changes).refresh(task.taskId)
        yield* until(cards(project.projectId), (all) => all[0]?.phase === 'settled')
        commitIn(api, 'retry.txt', 'Again for api')
        commitIn(web, 'retry.txt', 'Again for web')
        const again = { summary: 'Did both again.', built: 'The retry, again in both.' }
        assert.match(
          yield* callTool(access, 'finish_step', again),
          /^Write the description of the task's pull request before you finish, one for each of api, web\. /,
        )
        assert.strictEqual(
          yield* callTool(access, 'finish_step', {
            ...again,
            descriptions: [
              { repository: 'api', text: 'Api retries twice now.' },
              { repository: 'web', text: 'Web retries twice now.' },
            ],
          }),
          'Althar has your summary. The task is ready for the person.',
        )
        yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready' && all[0].unshipped?.commits === 2)
        yield* runs.publish(task.taskId)
        assert.deepStrictEqual(
          github.changes.slice(2).map((change) => change.body.split('\n\n')[0]),
          ['Api retries twice now.', 'Web retries twice now.'],
        )
      }).pipe(Effect.provide(runtimeWith(github)))
    },
  )

  it.live('abandons, not leaves out, an open task whose one repository merged while another has commits in no pull request', () => {
    const folder = realpathSync(mkdtempSync(join(tmpdir(), 'althar-folder-')))
    const bares: Record<string, string> = {}
    for (const name of ['api', 'web']) {
      const path = join(folder, name)
      mkdirSync(path)
      git(path, 'init', '-q', '-b', 'main')
      writeFileSync(join(path, 'README.md'), `# ${name}\n`)
      git(path, 'add', '.')
      git(path, '-c', 'user.name=T', '-c', 'user.email=t@t.test', 'commit', '-q', '-m', 'Start')
      git(path, 'remote', 'add', 'origin', `${HOST}/meridian/${name}.git`)
      bares[name] = mkdtempSync(join(tmpdir(), 'althar-remote-'))
      execFileSync('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: bares[name] })
      git(path, 'push', '-q', bares[name] ?? '', 'main')
    }
    const github = makeFakeService({ pushUrl: (path) => bares[path.at(-1) ?? ''] ?? '' })
    github.addRepository(['meridian', 'api'])
    github.addRepository(['meridian', 'web'])
    const commitIn = (path: string, file: string, message: string) => {
      appendFileSync(join(path, file), `${message}\n`)
      git(path, 'add', '-A')
      git(path, '-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', 'commit', '-q', '-m', message)
    }
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const instance = yield* Instance
      yield* connect()
      const projects = yield* Projects
      const plans = yield* Plans
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: folder })
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Share the retry',
        description: '[lead:finish]',
        draft: true,
        repositories: ['api', 'web'],
      })
      const worktrees = yield* sql<{ path: string }>`
        SELECT w.path FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id WHERE w.task_id = ${task.taskId} ORDER BY b.created_at, b.rowid`
      const [api = '', web = ''] = worktrees.map((worktree) => worktree.path)
      // Its plan changes api alone: api's pull request opens, and web has nothing to propose.
      commitIn(api, 'retry.txt', 'Retry')
      const planId = yield* plans.propose({
        projectId: project.projectId as Parameters<typeof plans.propose>[0]['projectId'],
        taskId: task.taskId,
        steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
        reason: null,
        actorId: instance.personId,
      })
      yield* plans.start(planId, instance.personId)
      yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready' && all[0].change !== null)
      assert.lengthOf(github.changes, 1)

      // web gets a commit in no pull request, then api's merges, with one after it: api is merged, web isn't, so it stays open.
      commitIn(web, 'retry.txt', 'Web first')
      squashMerge(bares.api ?? '', task.branch)
      github.mergeByHand(1)
      yield* (yield* Changes).refresh(task.taskId)
      yield* until(cards(project.projectId), (all) => all[0]?.change?.state === 'merged')
      commitIn(api, 'retry.txt', 'More for api')
      yield* until(cards(project.projectId), (all) => all[0]?.unshipped != null)
      assert.strictEqual((yield* taskRow(task.taskId))?.state, 'open')
      assert.isFalse(yield* (yield* Changes).merged(task.taskId))

      // Leaving out wouldn't settle it, so Abandon abandons it, and leaving out leaves nothing out.
      const actions = (yield* (yield* Queries).thread(task.threadId)).task.actions
      assert.isTrue(actions.includes('abandon') && !actions.includes('leaveOut'))
      yield* (yield* Tasks).leaveOut({ envelope: yield* Runtime.envelope('task.leave_out', {}), taskId: task.taskId })
      assert.strictEqual((yield* taskRow(task.taskId))?.state, 'open')
      assert.isFalse((yield* notices(task.threadId)).some((notice) => notice.title?.startsWith('Abandoned ') === true))
      assert.isNotNull((yield* cards(project.projectId))[0]?.unshipped)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live(
    'starts a reported round of a task with no pull request or review where its last run left it, and from its start where that isn’t known',
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const plans = yield* Plans
        const projects = yield* Projects
        const instance = yield* Instance
        const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
        const created = yield* projects.createTask({
          envelope: yield* Runtime.envelope('task.create', {}),
          projectId: project.projectId,
          title: 'Keep the retry here',
          description: 'Do it. [lead:finish] [lead:edit]',
          draft: true,
        })
        const planId = yield* plans.propose({
          projectId: project.projectId as Parameters<typeof plans.propose>[0]['projectId'],
          taskId: created.taskId,
          steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
          reason: null,
          actorId: instance.personId,
        })
        yield* plans.start(planId, instance.personId)
        yield* until(runsOf(created.taskId), (rows) => rows[0]?.state === 'succeeded')
        const [workspace] = yield* sql<{ id: string; path: string }>`SELECT id, path FROM workspaces WHERE task_id = ${created.taskId}`
        const path = workspace?.path ?? ''
        // Where its run left it is kept: its head as the run ended.
        assert.strictEqual(git(path, 'rev-parse', `refs/althar/rested/${workspace?.id ?? ''}`), git(path, 'rev-parse', 'HEAD'))
        const [lead] = yield* sql<{
          id: string
        }>`SELECT id FROM provider_sessions WHERE thread_id = ${created.threadId} ORDER BY started_at DESC LIMIT 1`
        const report = (summary: string) =>
          callTool(
            { role: 'lead', projectId: project.projectId, threadId: created.threadId, sessionId: lead?.id ?? '', taskId: created.taskId },
            'finish_step',
            // A round that made something says what the task built (#152); one that made nothing needn't.
            { summary, built: 'What the round made.' },
          )
        const quiet = 'Althar has your summary. Nothing on the branch changed this round, so the task is back where it was.'
        const ready = 'Althar has your summary. The task is ready for the person.'
        // Nothing since: back where it was.
        assert.strictEqual(yield* report('Looked again.'), quiet)
        // A commit the moment after the run ended, within the same second, is the round's.
        appendFileSync(join(path, 'later.txt'), 'later\n')
        git(path, 'add', '-A')
        git(path, '-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', 'commit', '-q', '-m', 'Later')
        assert.strictEqual(yield* report('Did a little more.'), ready)
        assert.strictEqual(git(path, 'rev-parse', `refs/althar/rested/${workspace?.id ?? ''}`), git(path, 'rev-parse', 'HEAD'))
        // Where it isn't known where the last run left it, everything since its branch started is the round's: nothing goes unreviewed.
        git(path, 'update-ref', '-d', `refs/althar/rested/${workspace?.id ?? ''}`)
        assert.strictEqual(yield* report('Looked once more.'), ready)
        const all = yield* runsOf(created.taskId)
        assert.deepStrictEqual(
          all.map((run) => [run.planId === null, run.endReason]),
          [
            [false, null],
            [true, 'nothing_new'],
            [true, null],
            [true, null],
          ],
        )
      }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:'))))),
  )
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
        yield* until(runsOf(created.taskId), (rows) => rows[0]?.state === 'succeeded')
        yield* say(created.threadId, 'One more thing. [lead:wait]')
        yield* until(runsOf(created.taskId), (rows) => rows[1]?.state === 'running' && rows[1].planId === null)
        return { ...created, projectId: project.projectId }
      }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(file)))))

      yield* Effect.gen(function* () {
        // It carries on by itself, says so, and its lead finishes it, with a new commit.
        yield* until(notices(started.threadId), (all) =>
          all.some((notice) => notice.title === 'Althar restarted; the step carried on from here.'),
        )
        const [, round] = yield* until(runsOf(started.taskId), (rows) => rows[1]?.state === 'succeeded')
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

/** What the lead commits in the task's worktree, as a lead did after its plan before rounds existed: no round, no report. */
const commitIn = (path: string, file: string, message: string) => {
  appendFileSync(join(path, file), `${message}\n`)
  git(path, 'add', '-A')
  git(path, '-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', 'commit', '-q', '-m', message)
  return git(path, 'rev-parse', 'HEAD')
}

describe('a merged task with commits after its pull request', () => {
  it.live(
    'needs the person, and offers to leave them out: it settles without them, at the time it first settled, and they stay on its branch',
    () => {
      const { working, bare, github } = onGitHub()
      return Effect.gen(function* () {
        const tasks = yield* Tasks
        const queries = yield* Queries
        const task = yield* merged(working, bare, github)
        const before = yield* taskRow(task.taskId)
        assert.deepStrictEqual((yield* queries.thread(task.threadId)).task.actions, [])

        // As DEV-58's lead did: a commit after the pull request merged, in no round and no pull request.
        const slider = commitIn(task.path, 'slider.txt', 'Slider')
        const [ready] = yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready')
        assert.deepStrictEqual(ready?.unshipped, { commits: 1, add: 1, del: 0 })
        assert.deepStrictEqual(yield* taskRow(task.taskId), before)
        // In Needs you, it offers something to do about it: before, a merged task offered nothing at all.
        assert.deepStrictEqual((yield* queries.thread(task.threadId)).task.actions, ['leaveOut'])

        yield* tasks.leaveOut({ envelope: yield* Runtime.envelope('task.leave_out', {}), taskId: task.taskId })
        const [settled] = yield* until(cards(task.projectId), (all) => all[0]?.phase === 'settled')
        assert.isNull(settled?.unshipped ?? null)
        assert.deepStrictEqual(yield* taskRow(task.taskId), before)
        assert.deepStrictEqual((yield* queries.thread(task.threadId)).task.actions, [])
        assert.strictEqual(git(task.path, 'rev-parse', 'HEAD'), slider)
        assert.strictEqual(git(task.path, 'rev-parse', '--abbrev-ref', 'HEAD'), 'althar/add-a-retry')
        assert.isTrue(
          (yield* notices(task.threadId)).some(
            (notice) =>
              notice.title === 'Abandoned 1 commit after PR #1.' &&
              notice.description ===
                "The task stays merged. The commit stays on althar/add-a-retry, in the task's worktree; what's committed after counts again.",
          ),
        )
        // Pressed again, there is nothing to leave out.
        yield* tasks.leaveOut({ envelope: yield* Runtime.envelope('task.leave_out', {}), taskId: task.taskId })
        assert.deepStrictEqual(yield* taskRow(task.taskId), before)

        // What is committed after counts again, alone.
        commitIn(task.path, 'slider.txt', 'Slider, warmer')
        const [again] = yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready')
        assert.deepStrictEqual(again?.unshipped, { commits: 1, add: 1, del: 0 })
      }).pipe(Effect.provide(runtimeWith(github)))
    },
  )

  it.live('settles an open one whose pull request merged as done once the person abandons it, leaving them out', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const runs = yield* Runs
      const tasks = yield* Tasks
      const sql = yield* SqlClient.SqlClient
      const task = yield* merged(working, bare, github, '[review:pass] [lead:push]')
      // A round that committed and was given up leaves a merged task open, its commit offered (ADR-034).
      yield* say(task.threadId, 'Tidy it up, and push pls.')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'waiting')
      const [call] = yield* sql<{ id: string }>`
          SELECT id FROM attention_requests WHERE task_id = ${task.taskId} AND kind = 'stuck' AND state = 'open'`
      yield* runs.answerStuck({
        envelope: yield* Runtime.envelope('attention.answer_stuck', {}),
        attentionId: call?.id ?? '',
        answer: { kind: 'abandon' },
      })
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready')
      assert.strictEqual((yield* taskRow(task.taskId))?.state, 'open')
      const queries = yield* Queries
      // Its lead's session is still there, between turns, so stopping it is offered as ever; abandoning it leaves the commit out.
      assert.deepStrictEqual((yield* queries.thread(task.threadId)).task.actions, ['stop', 'leaveOut'])

      yield* tasks.leaveOut({ envelope: yield* Runtime.envelope('task.leave_out', {}), taskId: task.taskId })
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'settled')
      assert.strictEqual((yield* taskRow(task.taskId))?.state, 'done')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('never ships what the person left out in its next pull request: after a merge its lead brought in, and after a close', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const runs = yield* Runs
      const tasks = yield* Tasks
      const task = yield* merged(working, bare, github)
      // Its lead brings main in, with what merged: the branch has main's tip, as a new pull request starts from.
      git(task.path, 'fetch', '-q', bare, 'main')
      git(task.path, '-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', 'merge', '-q', '--no-edit', 'FETCH_HEAD')
      commitIn(task.path, 'left.txt', 'Left out')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready')
      yield* tasks.leaveOut({ envelope: yield* Runtime.envelope('task.leave_out', {}), taskId: task.taskId })
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'settled')
      commitIn(task.path, 'kept.txt', 'Kept')
      const [ready] = yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready')
      assert.deepStrictEqual(ready?.unshipped, { commits: 1, add: 1, del: 0 })

      // The pull request has what the card said, and nothing the person left out.
      yield* runs.publish(task.taskId)
      assert.strictEqual(github.changes[1]?.source, 'althar/add-a-retry-2')
      assert.strictEqual(git(bare, 'log', '--format=%s', 'main..althar/add-a-retry-2'), 'Kept')
      assert.strictEqual(git(bare, 'diff', '--name-only', 'main', 'althar/add-a-retry-2'), 'kept.txt')
      // The commit left out is still on the task's first branch.
      assert.strictEqual(git(task.path, 'log', '-1', '--format=%s', 'althar/add-a-retry^'), 'Left out')

      // Closed without merging, it isn't merged: abandoning it abandons it, so nothing is left out.
      github.close(2)
      yield* (yield* Changes).refresh(task.taskId)
      yield* until(cards(task.projectId), (all) => all[0]?.change?.state === 'closed')
      commitIn(task.path, 'kept.txt', 'Kept again')
      yield* until(cards(task.projectId), (all) => all[0]?.unshipped?.commits === 1)
      const actions = (yield* (yield* Queries).thread(task.threadId)).task.actions
      assert.isTrue(actions.includes('abandon') && !actions.includes('leaveOut'))
      yield* tasks.leaveOut({ envelope: yield* Runtime.envelope('task.leave_out', {}), taskId: task.taskId })
      yield* until(cards(task.projectId), (all) => all[0]?.unshipped?.commits === 1)
      yield* runs.publish(task.taskId)
      assert.strictEqual(github.changes[2]?.source, 'althar/add-a-retry-3')
      // Its next has all of the closed one, and what came after it, and still nothing left out before.
      assert.strictEqual(git(bare, 'log', '--format=%s', 'main..althar/add-a-retry-3'), 'Kept again\nKept')
      assert.strictEqual(git(bare, 'diff', '--name-only', 'main', 'althar/add-a-retry-3'), 'kept.txt')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('finds a commit cherry-picked into the default branch on whichever copy of it has it, a stale one beside it or not', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* merged(working, bare, github)
      const slider = commitIn(task.path, 'slider.txt', 'Slider')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready')
      // Althar fetched main for a next pull request once: that copy stays as it was then, behind what merges after.
      git(task.path, 'update-ref', 'refs/althar/base/main', git(working, 'rev-parse', 'main'))

      // The slider is cherry-picked into another pull request, which merges; this Mac's main has it, the copy Althar fetched doesn't.
      const clone = mkdtempSync(join(tmpdir(), 'althar-theirs-'))
      execFileSync('git', ['clone', '-q', bare, clone])
      git(clone, 'fetch', '-q', task.path, slider)
      git(clone, '-c', 'user.name=Host', '-c', 'user.email=host@althar.test', 'cherry-pick', slider)
      git(clone, 'push', '-q', 'origin', 'main')
      git(working, 'pull', '-q', '--ff-only', bare, 'main')
      const [settled] = yield* until(cards(task.projectId), (all) => all[0]?.phase === 'settled')
      assert.isNull(settled?.unshipped ?? null)
      assert.deepStrictEqual(yield* (yield* Changes).unshipped(task.taskId), [])
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('doesn’t count commits the default branch has already: brought in by a merge, or cherry-picked into another pull request', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* merged(working, bare, github)
      const slider = commitIn(task.path, 'slider.txt', 'Slider')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready')

      // Someone else's work merges on the host, and the lead brings main in: what main brought isn't the task's to ship.
      const clone = mkdtempSync(join(tmpdir(), 'althar-theirs-'))
      execFileSync('git', ['clone', '-q', bare, clone])
      commitIn(clone, 'theirs.txt', 'Theirs')
      git(clone, 'push', '-q', 'origin', 'main')
      git(working, 'pull', '-q', '--ff-only', bare, 'main')
      git(task.path, '-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', 'merge', '-q', '--no-edit', 'main')
      const [merging] = yield* until(cards(task.projectId), (all) => all[0]?.unshipped?.commits === 1)
      assert.deepStrictEqual(merging?.unshipped, { commits: 1, add: 1, del: 0 })

      // Its commit is cherry-picked into another pull request, which merges: the same change under another hash.
      git(clone, 'fetch', '-q', task.path, 'althar/add-a-retry')
      git(clone, '-c', 'user.name=Host', '-c', 'user.email=host@althar.test', 'cherry-pick', slider)
      git(clone, 'push', '-q', 'origin', 'main')
      git(working, 'pull', '-q', '--ff-only', bare, 'main')
      // It's in, so nothing keeps the task before the person: settled, with nothing in none.
      const [settled] = yield* until(cards(task.projectId), (all) => all[0]?.phase === 'settled')
      assert.isNull(settled?.unshipped ?? null)
      assert.strictEqual((yield* taskRow(task.taskId))?.state, 'done')
      assert.deepStrictEqual(yield* (yield* Changes).unshipped(task.taskId), [])
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})
