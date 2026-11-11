import { budget } from '@althar/testing'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { type FakeAgentOptions, holds } from '@althar/provider-adapters/testing'
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
import type { ToolAccess } from '../src/ToolServer'
import { Tasks } from '../src/Tasks'
import { withoutReview } from './changesSupport'
import { callTool, fakeConnectors, HOST, hosted, items, notices, runtime, turns, until, withWork } from './support'

/*
 * A task goes back to work whenever its lead does, and ships again
 * (ADR-034). What the person says to a lead after its plan is a turn, not a
 * round (a task is a conversation plus parts): the card says Running while it
 * runs, and it ends where what it left says: back where it was with nothing
 * new, Needs you on a question, and what it committed held for Ship
 * (ship.test.ts). Commits after the last pull request merged go in a new one,
 * on a new branch, as the person opens it or Ship does.
 */

const runtimeWith = (github: FakeService, file = ':memory:', agents: FakeAgentOptions = {}, perUse?: ReadonlyArray<string>) =>
  Queries.layer.pipe(
    Layer.provideMerge(
      runtime(file, agents, {
        connectors: fakeConnectors({ github }),
        listenEvery: Duration.hours(1),
        ...(perUse === undefined ? {} : { perUse }),
      }),
    ),
  )

/** Agents Althar won't hand a step on to by itself, as it spends on a key only where the person picks: the lead's alone is free. */
const NOT_FREE = ['codex', 'opencode']

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
  it.live('opens a merged task’s next pull request for its commits after it, on a new branch from main as the host merged it', () => {
    const { working, bare, github, pushes } = onGitHub()
    return Effect.gen(function* () {
      const runs = yield* Runs
      const sql = yield* SqlClient.SqlClient
      const task = yield* merged(working, bare, github)
      assert.strictEqual((yield* taskRow(task.taskId))?.state, 'done')
      const mergedHead = git(bare, 'rev-parse', 'althar/add-a-retry')

      // A commit after it merged, made by hand: it holds nothing for Ship, and is the person's to open a pull request for.
      commitIn(task.path, 'slider.txt', 'Add the slider')
      const [ready] = yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready')
      assert.deepStrictEqual(ready?.unshipped, { commits: 1, add: 1, del: 0 })
      assert.deepStrictEqual([ready?.change?.number, ready?.change?.state], [1, 'merged'])
      assert.isUndefined(ready?.held)
      // Its lead's summary with the next one's description, given in a turn: kept, and nothing opens for it yet.
      const [lead] = yield* sql<{ id: string }>`
        SELECT id FROM provider_sessions WHERE thread_id = ${task.threadId} ORDER BY started_at DESC LIMIT 1`
      assert.strictEqual(
        yield* callTool(
          { role: 'lead', projectId: task.projectId, threadId: task.threadId, sessionId: lead?.id ?? '', taskId: task.taskId },
          'finish_step',
          {
            summary: 'Added the slider.',
            built: 'The slider we agreed on, beside the retry.',
            descriptions: [{ text: 'Adds the slider we agreed on, beside the retry.' }],
          },
        ),
        'Althar has your summary.',
      )
      assert.lengthOf(github.changes, 1)
      assert.lengthOf(yield* runsOf(task.taskId), 1)

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

      // Opened from the task: a new branch from main as the host merged it, with the commit alone on it, pushed plainly.
      yield* runs.publish(task.taskId)
      assert.lengthOf(github.changes, 2)
      const second = github.changes[1]
      assert.deepStrictEqual([second?.source, second?.target, second?.draft], ['althar/add-a-retry-2', 'main', true])
      assert.strictEqual(git(bare, 'rev-parse', 'althar/add-a-retry-2^'), git(bare, 'rev-parse', 'main'))
      assert.strictEqual(git(bare, 'rev-list', '--count', 'main..althar/add-a-retry-2'), '1')
      // Described as the lead wrote it in its turn, with nothing of its review but what Althar adds of it; and the merged branch
      // is as it was merged.
      assert.isTrue(withoutReview(second?.body ?? '').startsWith('Adds the slider we agreed on, beside the retry.\n\n'))
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
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live(
    'answers on a merged task as a turn: its answer waits for the person, then settled still, at the time it first settled, where the turn made nothing',
    () => {
      const { working, bare, github } = onGitHub()
      const slow = holds()
      return Effect.gen(function* () {
        const task = yield* merged(working, bare, github)
        const before = yield* taskRow(task.taskId)
        yield* say(task.threadId, 'What did you change? [lead:slowly]')
        yield* until(cards(task.projectId), (all) => all[0]?.phase === 'running')
        slow.open('[lead:slowly]')
        // It answered and made nothing: its answer waits for the person, and read, the task is settled as it was.
        yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready' && all[0].replied !== undefined)
        yield* (yield* Tasks).see({ taskId: task.taskId })
        yield* until(cards(task.projectId), (all) => all[0]?.phase === 'settled' && all[0].replied === undefined)
        assert.deepStrictEqual(yield* taskRow(task.taskId), before)
        // A turn, not a round: the plan's run is its only one, and nothing asked its lead to report.
        assert.lengthOf(yield* runsOf(task.taskId), 1)
        const sql = yield* SqlClient.SqlClient
        const reminded = yield* sql<{ id: string }>`SELECT id FROM user_inputs WHERE body LIKE 'Your step isn''t done%'`
        assert.lengthOf(reminded, 0)
        // Its report with no step open is kept as its summary, and opens nothing.
        const [lead] = yield* sql<{
          id: string
        }>`SELECT id FROM provider_sessions WHERE thread_id = ${task.threadId} ORDER BY started_at DESC LIMIT 1`
        const said = yield* callTool(
          { role: 'lead', projectId: task.projectId, threadId: task.threadId, sessionId: lead?.id ?? '', taskId: task.taskId },
          'finish_step',
          { summary: 'Looked again: nothing to change.' },
        )
        assert.strictEqual(said, 'Althar has your summary.')
        assert.deepStrictEqual(yield* taskRow(task.taskId), before)
        assert.strictEqual((yield* results(task.threadId)).at(-1)?.summary, 'Looked again: nothing to change.')
        assert.lengthOf(yield* runsOf(task.taskId), 1)
        // Settled still, its lead stops once its turn ends.
        const sessions = yield* Sessions
        yield* until(
          Effect.map(sessions.running(task.threadId), (running) => (Option.isNone(running) ? [true] : [])),
          (gone) => gone.length === 1,
        )
      }).pipe(Effect.provide(runtimeWith(github, ':memory:', { holds: slow })))
    },
  )

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

  it.live('needs the person when its lead asks them something in a turn, and goes on with their answer', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const runs = yield* Runs
      const sql = yield* SqlClient.SqlClient
      const task = yield* merged(working, bare, github)
      yield* say(task.threadId, 'Should the cache move? [lead:ask]')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'waiting')
      const [question] = yield* sql<{ id: string; payload: string }>`
        SELECT id, payload FROM attention_requests WHERE task_id = ${task.taskId} AND kind = 'question' AND state = 'open'`
      const field = (JSON.parse(question?.payload ?? '{}') as { fields: ReadonlyArray<{ id: string }> }).fields[0]?.id ?? ''
      yield* runs.answer({
        envelope: yield* Runtime.envelope('attention.answer_question', {}),
        attentionId: question?.id ?? '',
        answers: { [field]: { values: ['Postgres'] } },
      })
      // Answered, it changed nothing: its answer waits for the person, and read, the task is back where it was.
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready' && all[0].replied !== undefined)
      yield* (yield* Tasks).see({ taskId: task.taskId })
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'settled')
      assert.strictEqual((yield* taskRow(task.taskId))?.state, 'done')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('holds what its lead commits in a turn on a merged task for Ship, and asks it for no report', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* merged(working, bare, github, '[review:pass] [lead:push]')
      const before = yield* taskRow(task.taskId)
      // It commits, and asks for a push to a pull request that merged: told its commit waits for Ship, it ends its turn.
      yield* say(task.threadId, 'Tidy it up, and push pls.')
      // Held as its lead pushes, mid-turn: the card is at work, Ship not yet the person's, until the turn is over.
      const [first] = yield* until(cards(task.projectId), (all) => all[0]?.held !== undefined)
      assert.oneOf(first?.phase, ['running', 'ready'])
      const [card] = yield* until(cards(task.projectId), (all) => all[0]?.held !== undefined && all[0].phase === 'ready')
      assert.strictEqual(card?.held?.commits, 1)
      assert.deepStrictEqual(card?.unshipped, { commits: 1, add: 1, del: 0 })
      // Neither stuck nor reminded: a turn has no report to give.
      const stuck = yield* sql<{ id: string }>`SELECT id FROM attention_requests WHERE task_id = ${task.taskId} AND kind = 'stuck'`
      assert.lengthOf(stuck, 0)
      const reminded = yield* sql<{ body: string }>`SELECT body FROM user_inputs WHERE body LIKE 'Your step isn''t done%'`
      assert.lengthOf(reminded, 0)
      // Merged and settled as it was, until Ship sends it up; no round opened.
      assert.deepStrictEqual(yield* taskRow(task.taskId), before)
      assert.lengthOf(yield* runsOf(task.taskId), 1)
    }).pipe(Effect.provide(runtimeWith(github, ':memory:', {}, NOT_FREE)))
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
      assert.isTrue((yield* notices(ready?.threadId ?? '')).some((notice) => notice.title === 'Not done yet: 1 commit in no pull request.'))
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
      // Its lead changes that line again after the merge, as a commit of its own, in no pull request yet.
      commitIn(task.path, 'change.txt', 'Once more')
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
      const sql = yield* SqlClient.SqlClient
      const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${ready?.taskId ?? ''}`
      commitIn(workspace?.path ?? '', 'change.txt', 'Once more')
      yield* until(cards(project.projectId), (all) => all[0]?.unshipped != null)
      // It edits the line the merged pull request added: from upstream's main it applies, from the fork's stale main it wouldn't.
      yield* runs.publish(ready?.taskId ?? '')
      assert.strictEqual(github.changes[1]?.source, 'althar/add-a-retry-2')
      assert.strictEqual(github.forkOf(2), 'you/api')
      assert.strictEqual(git(fork, 'rev-parse', 'althar/add-a-retry-2^'), git(upstream, 'rev-parse', 'main'))
      assert.strictEqual(git(fork, 'rev-parse', 'main'), git(working, 'rev-parse', 'main'))
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

        // Its lead goes back to work on web, for the first time, and describes what it made: a turn, so nothing opens yet.
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
        const said = yield* callTool(access, 'finish_step', {
          summary: 'Did web too.',
          built: 'The retry, in web too.',
          descriptions: [{ repository: 'web', text: 'Web gave up on the first failed call too. It now retries once, as api does.' }],
        })
        assert.strictEqual(said, 'Althar has your summary.')
        assert.lengthOf(github.changes, 1)
        // Opened as the person says, web's first, from the task's branch, as a first one does; api's merged one stays as it is.
        yield* (yield* Runs).publish(task.taskId)
        yield* until(
          Effect.sync(() => github.changes),
          (all) => all.length === 2,
        )
        yield* until(cards(project.projectId), (all) => all[0]?.change?.number === 2)
        assert.include(github.changes[1]?.url, '/meridian/web/')
        assert.strictEqual(github.changes[1]?.source, task.branch)
        assert.isTrue(withoutReview(github.changes[1]?.body ?? '').startsWith('Web gave up on the first failed call too.'))
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
        assert.strictEqual(
          yield* callTool(access, 'finish_step', {
            ...again,
            descriptions: [
              { repository: 'api', text: 'Api retries twice now.' },
              { repository: 'web', text: 'Web retries twice now.' },
            ],
          }),
          'Althar has your summary.',
        )
        yield* until(cards(project.projectId), (all) => all[0]?.unshipped?.commits === 2)
        yield* (yield* Runs).publish(task.taskId)
        yield* until(
          Effect.sync(() => github.changes),
          (all) => all.length === 4,
        )
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
})

describe('a round of work and a restart', () => {
  it.live('holds for Ship what a turn cut short by a restart committed, before anything goes up', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'althar-rounds-')), 'althar.db')
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      // Its draft pull request open; then the person asks its lead for more, which commits and is still at it when Althar stops.
      const started = yield* Effect.gen(function* () {
        yield* connect()
        const projects = yield* Projects
        const coordinator = yield* Coordinator
        const sql = yield* SqlClient.SqlClient
        const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
        const threadId = yield* coordinator.thread(project.projectId)
        const body = 'Add a retry. [coordinator:plan] [coordinator:plan-no-review] [lead:finish] [lead:edit]'
        yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
        const [ready] = yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready' && all[0].change !== null)
        const card = ready ?? assert.fail('no card')
        yield* say(card.threadId, 'One more thing. [lead:wait]')
        // Where its turn began is kept with it, then the lead commits as it works.
        yield* until(
          sql<{ heads: string | null }>`SELECT heads FROM turn_deliveries WHERE thread_id = ${card.threadId} AND heads IS NOT NULL`,
          (rows) => rows.length === 1,
        )
        const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${card.taskId}`
        commitIn(workspace?.path ?? '', 'more.txt', 'One more thing')
        return { projectId: project.projectId, taskId: card.taskId, pushed: git(bare, 'rev-parse', 'althar/add-a-retry') }
      }).pipe(Effect.provide(runtimeWith(github, file)))

      yield* Effect.gen(function* () {
        // Started again, it holds that commit for Ship, as the turn's end would have, before what leads left waiting goes up.
        const sql = yield* SqlClient.SqlClient
        yield* until(
          sql<{ heldAt: string | null }>`SELECT held_at FROM workspaces WHERE task_id = ${started.taskId}`,
          (rows) => rows[0]?.heldAt != null,
        )
        const [card] = yield* until(cards(started.projectId), (all) => all[0]?.held !== undefined)
        assert.deepStrictEqual([card?.phase, card?.held?.commits], ['ready', 1])
        assert.strictEqual(git(bare, 'rev-parse', 'althar/add-a-retry'), started.pushed)
        assert.lengthOf(yield* runsOf(started.taskId), 1)
      }).pipe(Effect.provide(runtimeWith(github, file)))
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
          (yield* notices(task.threadId)).some((notice) => notice.title === 'Abandoned 1 commit.' && notice.description === undefined),
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

  it.live(
    'settles a merged one whose lead committed in a turn once the person leaves the commit out and reads its answer, letting go of its hold',
    () => {
      const { working, bare, github } = onGitHub()
      return Effect.gen(function* () {
        const tasks = yield* Tasks
        const task = yield* merged(working, bare, github, '[review:pass] [lead:push]')
        const before = yield* taskRow(task.taskId)
        // A turn that committed holds its commit for Ship: the merged task waits on the person, offered to leave it out.
        yield* say(task.threadId, 'Tidy it up, and push pls.')
        yield* until(cards(task.projectId), (all) => all[0]?.held !== undefined)
        const queries = yield* Queries
        yield* until(
          Effect.map(queries.thread(task.threadId), (header) => header.task.actions),
          (actions) => actions.includes('leaveOut'),
        )

        // Left out, nothing is held; what its lead answered still waits for the person, and read, the task is settled as it was.
        yield* tasks.leaveOut({ envelope: yield* Runtime.envelope('task.leave_out', {}), taskId: task.taskId })
        const [answered] = yield* until(cards(task.projectId), (all) => all[0]?.held === undefined && all[0]?.unshipped === null)
        assert.deepStrictEqual([answered?.phase, answered?.replied !== undefined], ['ready', true])
        yield* tasks.see({ taskId: task.taskId })
        const [settled] = yield* until(cards(task.projectId), (all) => all[0]?.phase === 'settled')
        assert.isUndefined(settled?.held)
        assert.deepStrictEqual(yield* taskRow(task.taskId), before)
      }).pipe(Effect.provide(runtimeWith(github, ':memory:', {}, NOT_FREE)))
    },
  )

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

describe('changing the team of a task that has begun', () => {
  const step = (key: 'implement' | 'review', agentId: string, model: string | null = null, skipped = false, effort?: string) => ({
    key,
    agentId,
    model,
    ...(effort === undefined ? {} : { effort }),
    skipped,
  })

  /** The person changes the team, as the API does: the task's steps as the dialog sends them. */
  const changeTeam = (taskId: string, steps: ReadonlyArray<ReturnType<typeof step>>) =>
    Effect.gen(function* () {
      const instance = yield* Instance
      return yield* (yield* Runs).changeTeam({ taskId, steps, actorId: instance.personId })
    })

  const leadsOn = (threadId: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return (yield* sql<{
        agentId: string
      }>`SELECT agent_id FROM provider_sessions WHERE thread_id = ${threadId} ORDER BY started_at, rowid`).map((row) => row.agentId)
    })

  const planOf = (taskId: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [plan] = yield* sql<{ parameters: string }>`SELECT parameters FROM task_plans WHERE task_id = ${taskId} AND state = 'accepted'`
      return JSON.parse(plan?.parameters ?? '{}') as {
        steps: ReadonlyArray<{ key: string; agentId: string; model: string | null; skipped: boolean }>
      }
    })

  /** A task the coordinator planned, its lead at work on it: claude-code leading and codex reviewing. */
  const start = (working: string, markers: string) =>
    Effect.gen(function* () {
      yield* connect()
      const projects = yield* Projects
      const coordinator = yield* Coordinator
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const threadId = yield* coordinator.thread(project.projectId)
      const body = `Add a retry. [coordinator:plan] ${withWork(markers, true)}`
      yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
      const [card] = yield* until(cards(project.projectId), (all) => all[0]?.phase === 'running')
      const task = card ?? assert.fail('no card')
      return { projectId: project.projectId, taskId: task.taskId, threadId: task.threadId }
    })

  it.live('puts another agent on the lead from its next turn, never in the one it is in, briefed with the work so far', () => {
    const { working, github } = onGitHub()
    const slow = holds()
    return Effect.gen(function* () {
      const sessions = yield* Sessions
      const task = yield* start(working, '[lead:slowly] [lead:finish] [lead:edit] [review:pass]')
      const before = (yield* until(
        Effect.map(sessions.running(task.threadId), (one) => (Option.isSome(one) ? [one.value] : [])),
        (all) => all[0]?.turnRunning === true,
      ))[0]
      if (before === undefined) return assert.fail('no lead')

      // Its turn is under way: it carries on, on the agent it began with.
      const changed = yield* changeTeam(task.taskId, [step('implement', 'codex', 'large'), step('review', 'codex')])
      assert.deepStrictEqual([changed.lead?.when, changed.review], ['next_turn', undefined])
      const during = Option.getOrThrow(yield* sessions.running(task.threadId))
      assert.deepStrictEqual([during.sessionId, during.agentId, during.turnRunning], [before.sessionId, 'claude-code', true])
      assert.deepStrictEqual(
        (yield* planOf(task.taskId)).steps.map((one) => [one.key, one.agentId, one.model]),
        [
          ['implement', 'codex', 'large'],
          ['review', 'codex', null],
        ],
      )

      // Its turn ends as it was going to: the review, and the pull request, as planned.
      slow.open('[lead:slowly]')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready')
      assert.deepStrictEqual(yield* leadsOn(task.threadId), ['claude-code'])

      // What the person says next is read by the agent it was changed to, which was given the thread so far.
      yield* say(task.threadId, 'Add the slider as well. [lead:finish]')
      yield* until(leadsOn(task.threadId), (agents) => agents.length === 2)
      assert.deepStrictEqual(yield* leadsOn(task.threadId), ['claude-code', 'codex'])
      const [taken] = (yield* notices(task.threadId)).filter((notice) => notice.title?.startsWith('Switched from') === true)
      assert.include(taken?.title, 'to Fake codex')
      const prompts = (yield* until(turns(task.threadId), (rows) => rows.length >= 2 && rows.at(-1)?.prompt != null)).map(
        (row) => row.prompt ?? '',
      )
      assert.include(prompts.at(-1), 'Add the slider as well.')
      assert.include(prompts.at(-1), 'The thread so far')
    }).pipe(Effect.provide(runtimeWith(github, ':memory:', { holds: slow })))
  })

  it.live('changes only the effort of the lead without handing it over', () => {
    const { working, github } = onGitHub()
    const slow = holds()
    return Effect.gen(function* () {
      const sessions = yield* Sessions
      const task = yield* start(working, '[lead:slowly] [lead:finish] [review:pass]')
      yield* until(
        Effect.map(sessions.running(task.threadId), (one) => (Option.isSome(one) ? [one.value] : [])),
        (all) => all[0]?.turnRunning === true,
      )
      const changed = yield* changeTeam(task.taskId, [step('implement', 'claude-code', null, false, 'high'), step('review', 'codex')])
      assert.deepStrictEqual([changed.lead?.step.effort, changed.lead?.was.effort ?? null], ['high', null])
      slow.open('[lead:slowly]')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready')
      yield* say(task.threadId, 'More. [lead:finish]')
      yield* until(turns(task.threadId), (rows) => rows.length >= 2 && rows.every((row) => !['pending', 'delivered'].includes(row.state)))
      // The same session, on the same agent: nothing was handed over.
      assert.deepStrictEqual(yield* leadsOn(task.threadId), ['claude-code'])
    }).pipe(Effect.provide(runtimeWith(github, ':memory:', { holds: slow })))
  })

  it.live('changes, adds and removes the reviewer until its round starts, and says so on the card', () => {
    const { working, github } = onGitHub()
    const slow = holds()
    return Effect.gen(function* () {
      const queries = yield* Queries
      const task = yield* start(working, '[lead:slowly] [lead:finish] [lead:edit] [review:pass]')
      const standing = () => Effect.map(cards(task.projectId), (all) => all[0]?.reviewerChange)
      assert.strictEqual(yield* standing(), 'now')
      // Taken off, put back on another model, and changed to another agent, all before its round: the last is the one that reviews.
      const removed = yield* changeTeam(task.taskId, [step('implement', 'claude-code'), step('review', 'codex', null, true)])
      assert.deepStrictEqual([removed.review?.step, removed.review?.when], [null, 'now'])
      assert.deepStrictEqual(
        (yield* planOf(task.taskId)).steps.map((one) => [one.key, one.skipped]),
        [
          ['implement', false],
          ['review', true],
        ],
      )
      const added = yield* changeTeam(task.taskId, [step('implement', 'claude-code'), step('review', 'claude-code', 'large')])
      assert.deepStrictEqual([added.review?.step?.agentId, added.review?.step?.model, added.review?.when], ['claude-code', 'large', 'now'])
      // Changing nothing changes nothing.
      assert.deepStrictEqual(yield* changeTeam(task.taskId, [step('implement', 'claude-code'), step('review', 'claude-code', 'large')]), {})
      const [run] = yield* runsOf(task.taskId)
      assert.deepStrictEqual(
        (JSON.parse(run?.parameters ?? '{}') as { steps: ReadonlyArray<{ key: string; agentId: string; skipped: boolean }> }).steps.map(
          (one) => [one.key, one.agentId, one.skipped],
        ),
        [
          ['implement', 'claude-code', false],
          ['review', 'claude-code', false],
        ],
      )
      slow.open('[lead:slowly]')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready')
      const reviewed = (yield* results(task.threadId)).find((result) => result.step === 'review')
      assert.deepStrictEqual([reviewed?.agentId, reviewed?.verdict], ['claude-code', 'pass'])
      // Its review is done: the reviewer can't change any more, though the lead can.
      assert.strictEqual(yield* standing(), 'never')
      const refused = yield* Effect.flip(changeTeam(task.taskId, [step('implement', 'claude-code'), step('review', 'codex')]))
      assert.strictEqual((refused as { why?: string }).why, 'review_done')
      assert.deepStrictEqual(
        (yield* changeTeam(task.taskId, [step('implement', 'codex'), step('review', 'claude-code', 'large')])).lead?.step.agentId,
        'codex',
      )
      // The lead it has now takes over from its next turn: the picker shows it, and the thread's lead is who runs until then.
      assert.deepStrictEqual((yield* queries.thread(task.threadId)).session?.nextLead?.agentId, 'codex')
    }).pipe(Effect.provide(runtimeWith(github, ':memory:', { holds: slow })))
  })

  it.live('changes the reviewer in the middle of a review round without stopping it, and the next round has the new one', () => {
    const { working, github } = onGitHub()
    const slow = holds()
    return Effect.gen(function* () {
      const sessions = yield* Sessions
      const sql = yield* SqlClient.SqlClient
      const task = yield* start(working, '[lead:finish] [lead:edit] [review:findings] [review:slowly]')
      const reviewThread = () =>
        sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${task.taskId} AND kind = 'step' AND node_key = 'review'`
      const [round] = yield* until(reviewThread(), (rows) => rows.length > 0)
      const reviewer = yield* until(
        Effect.map(sessions.running(round?.id ?? ''), (one) => (Option.isSome(one) ? [one.value] : [])),
        (all) => all.length > 0,
      )
      assert.strictEqual(reviewer[0]?.agentId, 'codex')
      assert.strictEqual((yield* cards(task.projectId))[0]?.reviewerChange, 'next_round')

      // The round carries on with the reviewer it began with; the change waits for the next.
      const changed = yield* changeTeam(task.taskId, [step('implement', 'claude-code'), step('review', 'claude-code', 'large')])
      assert.deepStrictEqual([changed.review?.step?.agentId, changed.review?.when], ['claude-code', 'next_round'])
      const during = Option.getOrThrow(yield* sessions.running(round?.id ?? ''))
      assert.deepStrictEqual([during.sessionId, during.agentId], [reviewer[0]?.sessionId, 'codex'])

      // Its findings are reported, its lead settles them, and the next round is the new reviewer's, who passes it.
      slow.open('[review:slowly]')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready')
      const reviews = (yield* results(task.threadId)).filter((result) => result.step === 'review')
      // The round under way was codex's, and every one after is the reviewer it was changed to: it passes the last.
      assert.strictEqual(reviews[0]?.agentId, 'codex')
      assert.isAbove(reviews.length, 1)
      assert.isTrue(reviews.slice(1).every((result) => result.agentId === 'claude-code'))
      assert.strictEqual(reviews.at(-1)?.verdict, 'pass')
    }).pipe(Effect.provide(runtimeWith(github, ':memory:', { holds: slow })))
  })

  it.live('is changed by the coordinator’s change_lead too: the reviewer, with the line in both threads, and not once a review ran', () => {
    const { working, github } = onGitHub()
    const slow = holds()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* start(working, '[lead:slowly] [lead:finish] [lead:edit] [review:pass]')
      const [row] = yield* sql<{ slug: string }>`SELECT slug FROM tasks WHERE id = ${task.taskId}`
      const slug = row?.slug ?? ''
      const coordinatorThread = yield* (yield* Coordinator).thread(task.projectId)
      const access: ToolAccess = {
        role: 'coordinator',
        projectId: task.projectId,
        threadId: coordinatorThread,
        sessionId: 'none',
        taskId: null,
      }
      assert.match(
        yield* callTool(access, 'change_lead', { task: slug, review: { agent: 'claude-code' }, why: 'the person asked' }),
        /^add-a-retry: changed the review to Fake claude-code's default model\. Both threads have a line saying so\.$/,
      )
      assert.deepStrictEqual(
        (yield* notices(task.threadId)).map((notice) => notice.title).filter((title) => title?.includes('review') === true),
        ["The coordinator changed the review to Fake claude-code's default model: the person asked"],
      )
      assert.isTrue((yield* notices(coordinatorThread)).some((notice) => notice.title?.startsWith('Changed the review to') === true))
      assert.deepStrictEqual(
        (yield* planOf(task.taskId)).steps.map((one) => [one.key, one.agentId, one.skipped]),
        [
          ['implement', 'claude-code', false],
          ['review', 'claude-code', false],
        ],
      )
      assert.match(yield* callTool(access, 'change_lead', { task: slug }), /^Name the lead, the review, or both/)
      assert.match(yield* callTool(access, 'change_lead', { task: slug, review: null }), /^add-a-retry: removed the review\./)
      slow.open('[lead:slowly]')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready')
      // No review ran: it was taken off before its round, which is not a review done. It can be added back until the task merges.
      assert.match(
        yield* callTool(access, 'change_lead', { task: slug, review: { agent: 'codex' } }),
        /^add-a-retry: changed the review to Fake codex's default model\./,
      )
      // Its round reads the work that is up, and once it ran, the review is done.
      yield* until(results(task.threadId), (all) => all.some((result) => result.step === 'review'))
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready' && all[0]?.reviewerChange === 'never')
      assert.match(
        yield* callTool(access, 'change_lead', { task: slug, review: { agent: 'claude-code' } }),
        /Its review is done, so its reviewer can’t change/,
      )
    }).pipe(Effect.provide(runtimeWith(github, ':memory:', { holds: slow })))
  })

  /** The plan as the coordinator's propose_plan makes it with no review: no review step in it, nor in the run it started. */
  const withoutReview = (taskId: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const bare = (text: string) => {
        const parameters = JSON.parse(text) as { steps: Array<{ key: string }> }
        return JSON.stringify({ ...parameters, steps: parameters.steps.filter((one) => one.key !== 'review') })
      }
      for (const row of yield* sql<{ id: string; parameters: string }>`SELECT id, parameters FROM task_plans WHERE task_id = ${taskId}`)
        yield* sql`UPDATE task_plans SET parameters = ${bare(row.parameters)} WHERE id = ${row.id}`
      for (const row of yield* sql<{ id: string; parameters: string }>`SELECT id, parameters FROM runs WHERE task_id = ${taskId}`)
        yield* sql`UPDATE runs SET parameters = ${bare(row.parameters)} WHERE id = ${row.id}`
    })

  it.live('adds a reviewer to a plan made with no review step, and the review round then runs', () => {
    const { working, github } = onGitHub()
    const slow = holds()
    return Effect.gen(function* () {
      const task = yield* start(working, '[lead:slowly] [lead:finish] [lead:edit] [review:pass]')
      yield* withoutReview(task.taskId)
      assert.deepStrictEqual(
        (yield* planOf(task.taskId)).steps.map((one) => one.key),
        ['implement'],
      )
      const added = yield* changeTeam(task.taskId, [step('implement', 'claude-code'), step('review', 'claude-code', 'large')])
      assert.deepStrictEqual([added.review?.step?.agentId, added.review?.was, added.review?.when], ['claude-code', null, 'now'])
      assert.deepStrictEqual(
        (yield* planOf(task.taskId)).steps.map((one) => [one.key, one.agentId, one.skipped]),
        [
          ['implement', 'claude-code', false],
          ['review', 'claude-code', false],
        ],
      )
      slow.open('[lead:slowly]')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready')
      const reviewed = (yield* results(task.threadId)).find((result) => result.step === 'review')
      assert.deepStrictEqual([reviewed?.agentId, reviewed?.verdict], ['claude-code', 'pass'])
    }).pipe(Effect.provide(runtimeWith(github, ':memory:', { holds: slow })))
  })

  it.live('keeps the reviewer once its review passed, though the run still publishes; the lead still changes', () => {
    const { working, github } = onGitHub()
    const slow = holds()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* start(working, '[lead:slowly] [lead:finish] [lead:edit] [review:pass]')
      // Its review passed and its run went on to publish, which is under way: the run is still running.
      const [attempt] = yield* sql<{ runAttemptId: string; at: string }>`
        SELECT a.run_attempt_id, a.admitted_at AS at FROM node_attempts a JOIN nodes n ON n.id = a.node_id
        WHERE n.node_key = 'implement' AND n.execution_id IN (SELECT e.id FROM workflow_executions e JOIN runs r ON r.id = e.run_id
          WHERE r.task_id = ${task.taskId})`
      yield* sql`
        INSERT INTO nodes (id, project_id, execution_id, node_key, iteration, type, added_in_revision, state, created_at)
        SELECT 'node_' || lower(hex(randomblob(16))), project_id, execution_id, key, 0, 'integration', 1, state, created_at
        FROM nodes, (SELECT 'review' AS key UNION ALL SELECT 'publish') WHERE node_key = 'implement' AND execution_id IN (
          SELECT e.id FROM workflow_executions e JOIN runs r ON r.id = e.run_id WHERE r.task_id = ${task.taskId})`
      yield* sql`
        INSERT INTO node_attempts (id, project_id, node_id, attempt_number, run_attempt_id, controller_generation, state, output, admitted_at)
        SELECT 'natt_' || lower(hex(randomblob(16))), project_id, id, 1, ${attempt?.runAttemptId ?? ''}, 1, 'succeeded',
          '{"verdict":"pass"}', ${attempt?.at ?? ''} FROM nodes WHERE node_key = 'review'`
      assert.strictEqual((yield* cards(task.projectId))[0]?.reviewerChange, 'never')
      const refused = yield* Effect.flip(
        changeTeam(task.taskId, [step('implement', 'claude-code'), step('review', 'claude-code', 'large')]),
      )
      assert.strictEqual((refused as { why?: string }).why, 'review_done')
      assert.strictEqual(
        (yield* changeTeam(task.taskId, [step('implement', 'codex'), step('review', 'codex')])).lead?.step.agentId,
        'codex',
      )
      slow.open('[lead:slowly]')
    }).pipe(Effect.provide(runtimeWith(github, ':memory:', { holds: slow })))
  })

  it.live('adds a skipped review back once the work is up: a round reads all of it, and a review that ran stays done', () => {
    const { working, github } = onGitHub()
    const slow = holds()
    return Effect.gen(function* () {
      const task = yield* start(working, '[lead:slowly] [lead:finish] [lead:edit] [review:pass]')
      // Skipped when planned: the work finishes and goes up with no review.
      yield* changeTeam(task.taskId, [step('implement', 'claude-code'), step('review', 'codex', null, true)])
      slow.open('[lead:slowly]')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready')
      assert.deepStrictEqual(
        (yield* results(task.threadId)).filter((result) => result.step === 'review'),
        [],
      )
      // Not done: nothing ran. Until it merges, the person adds it back and picks its model.
      assert.strictEqual((yield* cards(task.projectId))[0]?.reviewerChange, 'now')
      const added = yield* changeTeam(task.taskId, [step('implement', 'claude-code'), step('review', 'claude-code', 'large')])
      assert.deepStrictEqual([added.review?.step?.agentId, added.review?.step?.model, added.review?.when], ['claude-code', 'large', 'now'])
      // Its round reads the task's head, and its findings, if any, go to the lead as ever.
      const reviewed = (yield* until(results(task.threadId), (all) => all.some((result) => result.step === 'review'))).find(
        (result) => result.step === 'review',
      )
      assert.deepStrictEqual([reviewed?.agentId, reviewed?.verdict], ['claude-code', 'pass'])
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready' && all[0]?.reviewerChange === 'never')
      // A review that ran keeps today's rule: done stays done.
      const refused = yield* Effect.flip(changeTeam(task.taskId, [step('implement', 'claude-code'), step('review', 'codex')]))
      assert.strictEqual((refused as { why?: string }).why, 'review_done')
    }).pipe(Effect.provide(runtimeWith(github, ':memory:', { holds: slow })))
  })

  it.live('reads the pushed head for a review added back while more is held for Ship, and leaves what is held unshipped', () => {
    const { working, bare, github } = onGitHub()
    const slow = holds()
    return Effect.gen(function* () {
      const task = yield* start(working, '[lead:slowly] [lead:finish] [lead:edit] [review:pass]')
      yield* changeTeam(task.taskId, [step('implement', 'claude-code'), step('review', 'codex', null, true)])
      slow.open('[lead:slowly]')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready' && all[0]?.change != null)
      // The lead commits after the push, and the commit is held for Ship: it goes up only with it, beside the pull request.
      const sql = yield* SqlClient.SqlClient
      const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${task.taskId}`
      yield* sql`UPDATE workspaces SET held_at = ${new Date().toISOString()} WHERE task_id = ${task.taskId}`
      commitIn(workspace?.path ?? '', 'later.txt', 'Later')
      yield* (yield* Changes).refresh(task.taskId)
      yield* until(cards(task.projectId), (all) => all[0]?.held?.commits === 1)
      // Adding the review back starts a round all the same: the pull request is not left unreviewed until Ship.
      yield* changeTeam(task.taskId, [step('implement', 'claude-code'), step('review', 'codex')])
      const reviewed = (yield* until(results(task.threadId), (all) => all.some((result) => result.step === 'review'))).find(
        (result) => result.step === 'review',
      )
      assert.deepStrictEqual([reviewed?.agentId, reviewed?.verdict], ['codex', 'pass'])
      // What was held still waits: the review sent nothing up.
      const [after] = yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready' && all[0]?.reviewerChange === 'never')
      assert.strictEqual(after?.held?.commits, 1)
      assert.notInclude(git(bare, 'log', '--format=%s', 'althar/add-a-retry'), 'Later')
    }).pipe(Effect.provide(runtimeWith(github, ':memory:', { holds: slow })))
  })

  it.live('offers a review only where a lead offers one, as a line of its thread, once, and not again once turned down', () => {
    const { working, github } = onGitHub()
    const slow = holds()
    return Effect.gen(function* () {
      const instance = yield* Instance
      const task = yield* start(working, '[lead:slowly] [lead:finish] [lead:edit] [review:pass]')
      const offer = () => Effect.map(cards(task.projectId), (all) => all[0]?.reviewOffer)
      const lead: ToolAccess = { role: 'lead', projectId: task.projectId, threadId: task.threadId, sessionId: 'none', taskId: task.taskId }
      // Planned with a reviewer: nothing to offer, and the lead is told who reviews it.
      assert.match(yield* callTool(lead, 'offer_review', {}), /has a review already, by .*change_lead changes its reviewer/)
      // A plan made with no review, as a prototype's: its pull request opens, and still nothing is offered by itself.
      yield* withoutReview(task.taskId)
      slow.open('[lead:slowly]')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready' && all[0]?.change != null)
      assert.strictEqual(yield* offer(), undefined)
      // Its lead offers it, as the person asked to harden it: the one the rules would pick, another maker's than the lead's.
      assert.match(yield* callTool(lead, 'offer_review', {}), /^Offered .* a review by .*Nothing is added until the person adds it\.$/)
      const offered = yield* offer()
      assert.deepStrictEqual([offered?.key, offered?.agentId, offered?.skipped], ['review', 'codex', false])
      // A line of its thread, with the reviewer its buttons put on.
      const line = (yield* notices(task.threadId)).find((one) => one['offer'] !== undefined) as Record<string, unknown> | undefined
      assert.deepStrictEqual(
        [line?.['title'], (line?.['offer'] as Record<string, unknown> | undefined)?.['kind']],
        ['Add a review?', 'review'],
      )
      assert.strictEqual((line?.['offer'] as Record<string, unknown> | undefined)?.['agentId'], 'codex')
      // Nothing was added by itself, and one that stands isn't offered twice.
      assert.deepStrictEqual(
        (yield* planOf(task.taskId)).steps.map((one) => [one.key, one.skipped]),
        [['implement', false]],
      )
      assert.match(yield* callTool(lead, 'offer_review', {}), /is offered already: it waits on the person\./)
      assert.strictEqual((yield* notices(task.threadId)).filter((one) => one['offer'] !== undefined).length, 1)
      // Turned down, it doesn't come back, however often it is asked again, and the review can still be added by hand.
      yield* (yield* Runs).declineReview(task.taskId, instance.personId)
      yield* (yield* Runs).declineReview(task.taskId, instance.personId)
      assert.strictEqual(yield* offer(), undefined)
      assert.match(yield* callTool(lead, 'offer_review', {}), /turned down a review of .*: it isn't offered again/)
      assert.strictEqual((yield* cards(task.projectId))[0]?.reviewerChange, 'now')
    }).pipe(Effect.provide(runtimeWith(github, ':memory:', { holds: slow })))
  })

  it.live('keeps an offer answered once its review is added, even where the review is taken off before it starts', () => {
    const { working, github } = onGitHub()
    const slow = holds()
    return Effect.gen(function* () {
      const task = yield* start(working, '[lead:slowly] [lead:finish] [lead:edit] [review:pass]')
      const lead: ToolAccess = { role: 'lead', projectId: task.projectId, threadId: task.threadId, sessionId: 'none', taskId: task.taskId }
      const offer = () => Effect.map(cards(task.projectId), (all) => all[0]?.reviewOffer)
      yield* withoutReview(task.taskId)
      // Offered while its lead still works, so the review added has nothing to read yet.
      assert.match(yield* callTool(lead, 'offer_review', {}), /^Offered /)
      const offered = yield* offer()
      assert.strictEqual(offered?.agentId, 'codex')
      yield* changeTeam(task.taskId, [step('implement', 'claude-code'), step('review', offered?.agentId ?? '', offered?.model ?? null)])
      assert.strictEqual(yield* offer(), undefined)
      // Taken off again before it ran: the offer was answered, and its line keeps no buttons.
      yield* changeTeam(task.taskId, [step('implement', 'claude-code')])
      assert.deepStrictEqual(
        (yield* planOf(task.taskId)).steps.filter((one) => one.key === 'review' && !one.skipped),
        [],
      )
      assert.strictEqual(yield* offer(), undefined)
      slow.open('[lead:slowly]')
    }).pipe(Effect.provide(runtimeWith(github, ':memory:', { holds: slow })))
  })

  it.live('stops offering a review once it is added, and the review it adds reads the pushed head', () => {
    const { working, github } = onGitHub()
    const slow = holds()
    return Effect.gen(function* () {
      const task = yield* start(working, '[lead:slowly] [lead:finish] [lead:edit] [review:pass]')
      const lead: ToolAccess = { role: 'lead', projectId: task.projectId, threadId: task.threadId, sessionId: 'none', taskId: task.taskId }
      yield* withoutReview(task.taskId)
      slow.open('[lead:slowly]')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready' && all[0]?.change != null)
      // The coordinator offers it, as the person asked it there: the line stands in its own thread, and names the task.
      const coordinatorThread = yield* (yield* Coordinator).thread(task.projectId)
      const coordinator: ToolAccess = {
        role: 'coordinator',
        projectId: task.projectId,
        threadId: coordinatorThread,
        sessionId: 'none',
        taskId: null,
      }
      assert.match(yield* callTool(coordinator, 'offer_review', {}), /Name the task/)
      assert.match(yield* callTool(coordinator, 'offer_review', { task: task.taskId }), /^Offered /)
      const line = (yield* notices(coordinatorThread)).find((one) => one['offer'] !== undefined)
      assert.match(line?.['title'] ?? '', /^Add a review of “.+”\?$/)
      assert.isUndefined((yield* notices(task.threadId)).find((one) => one['offer'] !== undefined))
      const offered = (yield* cards(task.projectId))[0]?.reviewOffer
      // Add, as its line's button does: the offer's step, through the dialog's own command.
      assert.strictEqual(offered?.agentId, 'codex')
      yield* changeTeam(task.taskId, [step('implement', 'claude-code'), step('review', offered?.agentId ?? '', offered?.model ?? null)])
      assert.strictEqual((yield* cards(task.projectId))[0]?.reviewOffer, undefined)
      const reviewed = (yield* until(results(task.threadId), (all) => all.some((result) => result.step === 'review'))).find(
        (result) => result.step === 'review',
      )
      assert.deepStrictEqual([reviewed?.agentId, reviewed?.verdict], ['codex', 'pass'])
      // Reviewed: a review that ran can't be offered again.
      yield* until(cards(task.projectId), (all) => all[0]?.reviewerChange === 'never')
      assert.match(yield* callTool(lead, 'offer_review', {}), /has a review already/)
    }).pipe(Effect.provide(runtimeWith(github, ':memory:', { holds: slow })))
  })

  it.live('lets a skipped review be added where its run is at its publishing, which has no review in it', () => {
    const { working, github } = onGitHub()
    const slow = holds()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* start(working, '[lead:slowly] [lead:finish] [lead:edit] [review:pass]')
      yield* changeTeam(task.taskId, [step('implement', 'claude-code'), step('review', 'codex', null, true)])
      // Its run went on to publish with no review: the review is skipped, not done.
      yield* sql`
        INSERT INTO nodes (id, project_id, execution_id, node_key, iteration, type, added_in_revision, state, created_at)
        SELECT 'node_' || lower(hex(randomblob(16))), project_id, execution_id, 'publish', 0, 'integration', 1, state, created_at
        FROM nodes WHERE node_key = 'implement' AND execution_id IN (SELECT e.id FROM workflow_executions e JOIN runs r ON r.id = e.run_id
          WHERE r.task_id = ${task.taskId})`
      assert.strictEqual((yield* cards(task.projectId))[0]?.reviewerChange, 'now')
      const added = yield* changeTeam(task.taskId, [step('implement', 'claude-code'), step('review', 'codex')])
      assert.deepStrictEqual([added.review?.step?.agentId, added.review?.when], ['codex', 'now'])
      slow.open('[lead:slowly]')
    }).pipe(Effect.provide(runtimeWith(github, ':memory:', { holds: slow })))
  })

  it.live('takes any agent on a review’s team, Codex included, whoever asks', () => {
    const { working, github } = onGitHub()
    const slow = holds()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* start(working, '[lead:slowly] [lead:finish] [lead:edit] [review:pass]')
      // A review's plan: its lead only reads.
      for (const row of yield* sql<{
        id: string
        parameters: string
      }>`SELECT id, parameters FROM task_plans WHERE task_id = ${task.taskId}`)
        yield* sql`UPDATE task_plans SET parameters = ${JSON.stringify({ ...JSON.parse(row.parameters), reads: true })} WHERE id = ${row.id}`
      const before = yield* planOf(task.taskId)
      // An agent Althar doesn't have is still refused, and nothing changes.
      const refused = yield* Effect.flip(changeTeam(task.taskId, [step('implement', 'nobody'), step('review', 'claude-code')]))
      assert.strictEqual((refused as { _tag?: string })._tag, 'ReviewRefused')
      assert.strictEqual((refused as { message?: string }).message, 'Althar has no such agent.')
      assert.deepStrictEqual(yield* planOf(task.taskId), before)
      // The coordinator's tool goes through the same path, and gives a review to Codex.
      const [row] = yield* sql<{ slug: string }>`SELECT slug FROM tasks WHERE id = ${task.taskId}`
      const coordinatorThread = yield* (yield* Coordinator).thread(task.projectId)
      const access: ToolAccess = {
        role: 'coordinator',
        projectId: task.projectId,
        threadId: coordinatorThread,
        sessionId: 'none',
        taskId: null,
      }
      assert.notMatch(
        yield* callTool(access, 'change_lead', { task: row?.slug ?? '', lead: { agent: 'codex' } }),
        /can't be held to reading only/,
      )
      slow.open('[lead:slowly]')
    }).pipe(Effect.provide(runtimeWith(github, ':memory:', { holds: slow })))
  })

  it.live('refuses a merged task, with the reason, and a removed review that was never to come', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* merged(working, bare, github)
      const refused = yield* Effect.flip(changeTeam(task.taskId, [step('implement', 'codex'), step('review', 'codex')]))
      assert.strictEqual((refused as { _tag?: string; why?: string })._tag, 'TaskRefused')
      assert.strictEqual((refused as { why?: string }).why, 'merged')
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})
