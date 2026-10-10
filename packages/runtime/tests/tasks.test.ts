import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ActorId, ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Deferred, Duration, Effect, Fiber, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'

import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { type PlanStep, Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { actionsOf, Tasks } from '../src/Tasks'
import { fakeConnectors, HOST, hosted, repository, runtime, turns, until } from './support'

/*
 * A task's course as the person steers it (docs/architecture/05, "Task and
 * run lifecycle"): stopping it suspends its run and every agent on it;
 * resuming carries on the step it was on; abandoning settles it with its
 * worktree and branch kept; reopening opens it on them again. A merged task
 * can be neither abandoned nor reopened. The fake agent plays the lead and the reviewer from markers in
 * the task's title.
 */

const withQueries = (more: Parameters<typeof runtime>[2] = {}) =>
  Queries.layer.pipe(Layer.provideMerge(runtime(undefined, undefined, more)))

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd })
    .toString()
    .trim()

const implement = (agentId = 'claude-code'): PlanStep => ({ key: 'implement', agentId, model: null, skipped: false })
const reviewBy = (agentId = 'codex'): PlanStep => ({ key: 'review', agentId, model: null, skipped: false })

/** A project with a task in it, planned: its plan proposed to start in a minute unless started; in the repository at `root`, ending as `end` says. */
const planned = (
  title: string,
  steps: ReadonlyArray<PlanStep> = [implement()],
  more: { readonly root?: string; readonly end?: 'draft' | 'ready' | 'none' | null } = {},
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const projects = yield* Projects
    const plans = yield* Plans
    const root = more.root ?? repository()
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: root })
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId: project.projectId,
      title,
      draft: true,
    })
    const [person] = yield* sql<{ id: string }>`SELECT id FROM actors WHERE kind = 'person'`
    const actor = (person?.id ?? '') as ActorId
    const planId = yield* plans.propose({
      projectId: project.projectId as ProjectId,
      taskId: task.taskId,
      steps,
      reason: null,
      actorId: actor,
      startsIn: Duration.minutes(1),
      ...(more.end === undefined ? {} : { end: more.end }),
    })
    return { root, project, task, planId, actor }
  })

/** The task as its screen reads it: where it stands, and what the person can do to it. */
const shown = (threadId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const { task } = yield* queries.thread(threadId, { limit: 0 })
    return {
      phase: task.phase,
      state: task.state,
      actions: task.actions,
      planId: task.planId,
      worktree: task.worktree,
      branch: task.branch,
    }
  })

const command = (type: string) => Runtime.envelope(type, {})

/**
 * A gate on one of the runtime's own git commands, for a race that needs
 * something to wait in the middle: armed, the `nth` command from then whose
 * words include `words` waits until the gate opens, says it was caught, and
 * says when it is done. Git is found through a wrapper put first on the
 * path, which runs the real one; the path is put back when the test ends.
 */
const gitGate = (words: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const dir = mkdtempSync(join(tmpdir(), 'althar-git-gate-'))
      const real = execFileSync('which', ['git']).toString().trim()
      writeFileSync(
        join(dir, 'git'),
        [
          '#!/bin/sh',
          `case "$*" in *"${words}"*)`,
          `  if [ -e "${dir}/armed" ]; then`,
          `    n=$(($(cat "${dir}/armed") - 1))`,
          `    if [ "$n" -le 0 ]; then`,
          `      rm -f "${dir}/armed"; touch "${dir}/caught"`,
          `      while [ ! -e "${dir}/open" ]; do sleep 0.02; done`,
          `      "${real}" "$@"; status=$?; touch "${dir}/done"; exit $status`,
          `    fi`,
          `    echo "$n" > "${dir}/armed"`,
          `  fi ;;`,
          'esac',
          `exec "${real}" "$@"`,
          '',
        ].join('\n'),
        { mode: 0o755 },
      )
      const path = process.env.PATH
      process.env.PATH = `${dir}:${path ?? ''}`
      return {
        path,
        arm: (nth = 1) => writeFileSync(join(dir, 'armed'), String(nth)),
        caught: () => existsSync(join(dir, 'caught')),
        open: () => writeFileSync(join(dir, 'open'), ''),
        done: () => existsSync(join(dir, 'done')),
      }
    }),
    (gate) =>
      Effect.sync(() => {
        gate.open()
        process.env.PATH = gate.path
      }),
  )

/** The runtime with a fake GitHub, asked for news often. */
const withGitHub = (github: FakeService) => withQueries({ connectors: fakeConnectors({ github }), listenEvery: Duration.millis(100) })

/** Connects GitHub with a pasted token, as the person would. */
const connectGitHub = Effect.gen(function* () {
  const connections = yield* Connections
  const instance = yield* Instance
  yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
})

/** Each node attempt of the task's run, in the order they were admitted: its step, round and state, and whether stopping cut it short. */
const attempts = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ nodeKey: string; iteration: number; state: string; stopped: number | null }>`
      SELECT n.node_key, n.iteration, a.state, json_extract(a.output, '$.stopped') AS stopped
      FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
      JOIN runs r ON r.id = e.run_id WHERE r.task_id = ${taskId} ORDER BY a.admitted_at, a.rowid`
    return rows.map((row) => [row.nodeKey, row.iteration, row.state, row.stopped === 1] as const)
  })

const runOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [run] = yield* sql<{ state: string }>`SELECT state FROM runs WHERE task_id = ${taskId}`
    const tries = yield* sql<{ state: string }>`
      SELECT a.state FROM run_attempts a JOIN runs r ON r.id = a.run_id WHERE r.task_id = ${taskId} ORDER BY a.attempt_number`
    return { state: run?.state, attempts: tries.map((attempt) => attempt.state) }
  })

const callsOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ kind: string; state: string; why: string | null }>`
      SELECT kind, state, json_extract(payload, '$.why') AS why FROM attention_requests WHERE task_id = ${taskId} ORDER BY created_at`
  })

/** Whether an agent is on the thread. */
const onThread = (threadId: string) =>
  Effect.map(
    Effect.flatMap(Sessions, (sessions) => sessions.running(threadId)),
    Option.isSome,
  )

/** Waits until the task stands where `check` says. */
const standsAt = (threadId: string, check: (task: Effect.Success<ReturnType<typeof shown>>) => boolean, limit = Duration.seconds(20)) =>
  until(
    Effect.map(shown(threadId), (task) => [task]),
    ([task]) => task !== undefined && check(task),
    limit,
  )

describe('a task’s course', () => {
  it('offers what applies where a task stands, and nothing for a merged one', () => {
    const open = { state: 'open', planId: null, runState: null, working: false } as const
    assert.deepStrictEqual(actionsOf({ ...open, state: 'done' }), [])
    assert.deepStrictEqual(actionsOf({ ...open, state: 'abandoned', runState: 'suspended' }), ['reopen'])
    assert.deepStrictEqual(actionsOf({ ...open, state: 'draft', planId: 'plan_1' }), ['start', 'abandon'])
    assert.deepStrictEqual(actionsOf({ ...open, runState: 'running' }), ['stop', 'abandon'])
    assert.deepStrictEqual(actionsOf({ ...open, runState: 'suspended' }), ['resume', 'abandon'])
    // Ready, with the lead talking: stopping stops the agent, and nothing is resumed.
    assert.deepStrictEqual(actionsOf({ ...open, runState: 'succeeded', working: true }), ['stop', 'abandon'])
    assert.deepStrictEqual(actionsOf({ ...open, runState: 'succeeded' }), ['abandon'])
  })

  it.live('stops a task in the middle of its step, with nothing to answer, and resumes it from there', () =>
    Effect.gen(function* () {
      const plans = yield* Plans
      const tasks = yield* Tasks
      const sessions = yield* Sessions
      const { task, planId, actor } = yield* planned('Retry checkout [lead:wait]')
      assert.deepStrictEqual((yield* shown(task.threadId)).actions, ['start', 'abandon'])
      assert.strictEqual((yield* shown(task.threadId)).planId, planId)
      yield* plans.start(planId, actor)
      yield* until(
        Effect.map(sessions.running(task.threadId), (live) => (Option.isSome(live) && live.value.turnRunning ? [live] : [])),
        (rows) => rows.length === 1,
      )
      const working = yield* shown(task.threadId)
      assert.deepStrictEqual([working.phase, working.actions, working.planId], ['running', ['stop', 'abandon'], null])

      yield* tasks.stop({ envelope: yield* command('task.stop'), taskId: task.taskId })
      // Its run waits, its step cut short, and no agent is on it.
      assert.deepStrictEqual(yield* runOf(task.taskId), { state: 'suspended', attempts: ['interrupted'] })
      assert.deepStrictEqual(yield* attempts(task.taskId), [['implement', 0, 'cancelled', true]])
      assert.isFalse(yield* onThread(task.threadId))
      const stopped = yield* shown(task.threadId)
      assert.deepStrictEqual([stopped.phase, stopped.actions], ['stopped', ['resume', 'abandon']])
      // The lead going isn't a step needing the person: nothing waits on them.
      yield* Effect.sleep('200 millis')
      assert.deepStrictEqual(yield* callsOf(task.taskId), [])
      // Pressed again, there is nothing to stop.
      yield* tasks.stop({ envelope: yield* command('task.stop'), taskId: task.taskId })
      assert.deepStrictEqual((yield* runOf(task.taskId)).attempts, ['interrupted'])

      // Resumed, the lead carries the step on, told to, in a session of its own.
      yield* tasks.resume({ envelope: yield* command('task.resume'), taskId: task.taskId })
      assert.deepStrictEqual(yield* runOf(task.taskId), { state: 'running', attempts: ['interrupted', 'active'] })
      yield* until(
        Effect.map(turns(task.threadId), (all) =>
          all.filter((turn) => turn.prompt?.includes('Carry on with the task from where it stands') === true),
        ),
        (rows) => rows.length === 1,
      )
      assert.deepStrictEqual(yield* attempts(task.taskId), [
        ['implement', 0, 'cancelled', true],
        ['implement', 0, 'running', false],
      ])
      const sql = yield* SqlClient.SqlClient
      assert.strictEqual(
        (yield* sql<{ n: number }>`SELECT count(*) AS n FROM provider_sessions WHERE thread_id = ${task.threadId}`)[0]?.n,
        2,
      )
      assert.deepStrictEqual((yield* shown(task.threadId)).actions, ['stop', 'abandon'])
      // Resuming what runs does nothing, asked of the task or of its run.
      yield* tasks.resume({ envelope: yield* command('task.resume'), taskId: task.taskId })
      yield* (yield* Runs).resume({ envelope: yield* command('task.resume'), taskId: task.taskId })
      assert.strictEqual((yield* runOf(task.taskId)).attempts.length, 2)

      // Stopped again, what the person says starts it with their words first: the lead reads them, and finishes its step.
      yield* tasks.stop({ envelope: yield* command('task.stop'), taskId: task.taskId })
      yield* sessions.send({
        envelope: yield* command('thread.send'),
        threadId: task.threadId,
        body: 'Go ahead [lead:finish]',
        disposition: 'after_current',
      })
      yield* tasks.resume({
        envelope: yield* command('task.resume'),
        taskId: task.taskId,
        lead: { agentId: 'codex', model: 'large', effort: 'high' },
      })
      const ready = yield* standsAt(task.threadId, (now) => now.phase === 'ready')
      // Ready, with its lead still on it: stopping stops that agent, and there is nothing to resume.
      assert.deepStrictEqual(ready[0]?.actions, ['stop', 'abandon'])
      assert.deepStrictEqual((yield* runOf(task.taskId)).state, 'succeeded')
      // On the agent, model and effort the person picked.
      const [last] = yield* sql<{ agentId: string; model: string | null; effort: string | null }>`
        SELECT agent_id, model, effort FROM provider_sessions WHERE thread_id = ${task.threadId} ORDER BY started_at DESC, rowid DESC LIMIT 1`
      assert.deepStrictEqual({ ...last }, { agentId: 'codex', model: 'large', effort: 'high' })
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('stops a review in the middle, and resumes its round on its reviewer', () =>
    Effect.gen(function* () {
      const plans = yield* Plans
      const tasks = yield* Tasks
      const sql = yield* SqlClient.SqlClient
      const { task, planId, actor } = yield* planned('Retry checkout [lead:finish] [review:wait]', [implement(), reviewBy()])
      yield* plans.start(planId, actor)
      const reviewing = sql<{ threadId: string }>`
        SELECT s.thread_id FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN provider_sessions s ON s.id = a.provider_session_id
        WHERE n.node_key = 'review' AND a.state = 'running'`
      const [review] = yield* until(reviewing, (rows) => rows.length === 1)
      yield* tasks.stop({ envelope: yield* command('task.stop'), taskId: task.taskId })
      // Every agent on it stops: the reviewer's too.
      assert.isFalse(yield* onThread(review?.threadId ?? ''))
      assert.deepStrictEqual(yield* attempts(task.taskId), [
        ['implement', 0, 'succeeded', false],
        ['review', 0, 'cancelled', true],
      ])
      yield* tasks.resume({ envelope: yield* command('task.resume'), taskId: task.taskId })
      yield* until(reviewing, (rows) => rows.length === 1)
      assert.deepStrictEqual((yield* attempts(task.taskId)).slice(2), [['review', 0, 'running', false]])
      assert.isTrue(yield* onThread(review?.threadId ?? ''))
      // The lead had nothing waiting for it, so it stays stopped beside the review.
      assert.isFalse(yield* onThread(task.threadId))
      // What the person says then is read beside the review, by the lead.
      yield* tasks.stop({ envelope: yield* command('task.stop'), taskId: task.taskId })
      const sessions = yield* Sessions
      yield* sessions.send({
        envelope: yield* command('thread.send'),
        threadId: task.threadId,
        body: 'How is it going?',
        disposition: 'after_current',
      })
      yield* tasks.resume({ envelope: yield* command('task.resume'), taskId: task.taskId })
      yield* until(
        Effect.map(onThread(task.threadId), (on) => (on ? [on] : [])),
        (rows) => rows.length === 1,
      )
      assert.isTrue(yield* onThread(review?.threadId ?? ''))
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('resumes a later round of review with what the lead settled before it', () =>
    Effect.gen(function* () {
      const plans = yield* Plans
      const tasks = yield* Tasks
      const sql = yield* SqlClient.SqlClient
      // The first round finds something, the lead settles it, and the reviewer works on the second round until it is stopped.
      const { task, planId, actor } = yield* planned('Tighten the types [lead:finish] [review:findings] [review:wait-later]', [
        implement(),
        reviewBy(),
      ])
      yield* plans.start(planId, actor)
      const secondRound = sql<{ id: string; state: string }>`
        SELECT a.id, a.state FROM node_attempts a JOIN nodes n ON n.id = a.node_id WHERE n.node_key = 'review' AND n.iteration = 1`
      yield* until(secondRound, (rows) => rows.some((row) => row.state === 'running'))
      yield* tasks.stop({ envelope: yield* command('task.stop'), taskId: task.taskId })
      yield* tasks.resume({ envelope: yield* command('task.resume'), taskId: task.taskId })
      // The round runs again, on a fresh reviewer told what the lead settled.
      yield* until(secondRound, (rows) => rows.length === 2 && rows.some((row) => row.state === 'running'))
      const [review] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${task.taskId} AND kind = 'step'`
      const told = yield* until(
        Effect.map(turns(review?.id ?? ''), (all) =>
          all.filter((turn) => turn.prompt?.includes('The lead settled your findings') === true),
        ),
        (rows) => rows.length >= 2,
      )
      assert.include(told.at(-1)?.prompt, 'Fixed the heading.')
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('stops a task waiting on the person, withdrawing its call, and resumes it on another agent', () =>
    Effect.gen(function* () {
      const plans = yield* Plans
      const tasks = yield* Tasks
      const sessions = yield* Sessions
      // Its lead can't start, so Implement needs the person.
      const { task, planId, actor } = yield* planned('Nobody to do it', [implement('missing')])
      yield* plans.start(planId, actor)
      yield* standsAt(task.threadId, (now) => now.phase === 'waiting')
      assert.deepStrictEqual((yield* shown(task.threadId)).actions, ['stop', 'abandon'])
      yield* tasks.stop({ envelope: yield* command('task.stop'), taskId: task.taskId })
      assert.deepStrictEqual(yield* callsOf(task.taskId), [{ kind: 'stuck', state: 'withdrawn', why: 'failed_to_start' }])
      assert.strictEqual((yield* shown(task.threadId)).phase, 'stopped')
      // Resumed on an agent that can't start either, it needs the person again, as a plan starting would.
      yield* tasks.resume({ envelope: yield* command('task.resume'), taskId: task.taskId })
      yield* standsAt(task.threadId, (now) => now.phase === 'waiting')
      assert.strictEqual((yield* callsOf(task.taskId)).filter((call) => call.state === 'open').length, 1)
      // Abandoned while it waits, its call goes with it; reopened, it is stopped where it was.
      yield* tasks.abandon({ envelope: yield* command('task.abandon'), taskId: task.taskId })
      assert.deepStrictEqual(
        (yield* callsOf(task.taskId)).map((call) => call.state),
        ['withdrawn', 'withdrawn'],
      )
      yield* tasks.reopen({ envelope: yield* command('task.reopen'), taskId: task.taskId })
      assert.deepStrictEqual((yield* shown(task.threadId)).actions, ['resume', 'abandon'])
      // On one that can, it carries the step on there.
      yield* tasks.resume({
        envelope: yield* command('task.resume'),
        taskId: task.taskId,
        lead: { agentId: 'codex', model: null, effort: null },
      })
      yield* until(
        Effect.map(sessions.running(task.threadId), (live) => (Option.isSome(live) && live.value.agentId === 'codex' ? [live] : [])),
        (rows) => rows.length === 1,
      )
      assert.deepStrictEqual((yield* attempts(task.taskId)).at(-1), ['implement', 0, 'running', false])
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('carries the lead’s own step on when it stopped between two steps', () =>
    Effect.gen(function* () {
      const plans = yield* Plans
      const tasks = yield* Tasks
      // Out of rounds with settled changes no review has seen: the run waits on the person with no step under way.
      const { task, planId, actor } = yield* planned('Tighten the types [lead:finish] [review:always]', [implement(), reviewBy()])
      yield* plans.start(planId, actor)
      yield* standsAt(task.threadId, (now) => now.phase === 'waiting', Duration.seconds(60))
      assert.deepStrictEqual(
        (yield* callsOf(task.taskId)).map((call) => call.why),
        ['round_limit'],
      )
      yield* tasks.stop({ envelope: yield* command('task.stop'), taskId: task.taskId })
      assert.deepStrictEqual((yield* attempts(task.taskId)).at(-1), ['settle', 2, 'succeeded', false])
      // Resumed, the lead settles what is open again; with still more to see and no rounds left, the person decides again.
      yield* tasks.resume({ envelope: yield* command('task.resume'), taskId: task.taskId })
      yield* until(callsOf(task.taskId), (calls) => calls.filter((call) => call.state === 'open').length === 1, Duration.seconds(30))
      assert.deepStrictEqual((yield* attempts(task.taskId)).slice(-2), [
        ['settle', 2, 'succeeded', false],
        ['settle', 2, 'succeeded', false],
      ])
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('abandons a task, keeping its worktree and branch, and reopens it on them, putting back a folder that went', () =>
    Effect.gen(function* () {
      const plans = yield* Plans
      const tasks = yield* Tasks
      const sql = yield* SqlClient.SqlClient
      const { root, project, task, planId, actor } = yield* planned('Retry checkout [lead:wait]')
      yield* plans.start(planId, actor)
      yield* standsAt(task.threadId, (now) => now.phase === 'running')
      const before = yield* shown(task.threadId)

      yield* tasks.abandon({ envelope: yield* command('task.abandon'), taskId: task.taskId })
      const settled = yield* shown(task.threadId)
      assert.deepStrictEqual([settled.state, settled.phase, settled.actions], ['abandoned', 'settled', ['reopen']])
      assert.isFalse(yield* onThread(task.threadId))
      // Its run waits, cut short, for reopening; its worktree and branch are where they were.
      assert.strictEqual((yield* runOf(task.taskId)).state, 'suspended')
      assert.isTrue(existsSync(before.worktree ?? ''))
      assert.strictEqual(git(root, 'rev-parse', '--verify', '--quiet', `refs/heads/${before.branch}`).length, 40)
      const [kept] = yield* sql<{ settledAt: string | null }>`SELECT settled_at FROM tasks WHERE id = ${task.taskId}`
      assert.isNotNull(kept?.settledAt)
      // Abandoned again, nothing changes; and an abandoned task is neither stopped nor resumed, asked of it or of its run.
      yield* tasks.abandon({ envelope: yield* command('task.abandon'), taskId: task.taskId })
      yield* tasks.resume({ envelope: yield* command('task.resume'), taskId: task.taskId })
      yield* (yield* Runs).resume({ envelope: yield* command('task.resume'), taskId: task.taskId })
      assert.strictEqual((yield* runOf(task.taskId)).state, 'suspended')

      // The person deleted its folder meanwhile: reopening puts it back, on its branch, with what it had committed.
      writeFileSync(join(before.worktree ?? '', 'note.txt'), 'kept\n')
      git(before.worktree ?? '', 'add', '.')
      git(before.worktree ?? '', 'commit', '-q', '-m', 'Keep a note')
      rmSync(before.worktree ?? '', { recursive: true, force: true })
      yield* tasks.reopen({ envelope: yield* command('task.reopen'), taskId: task.taskId })
      assert.strictEqual(git(before.worktree ?? '', 'rev-parse', '--abbrev-ref', 'HEAD'), before.branch)
      assert.isTrue(existsSync(join(before.worktree ?? '', 'note.txt')))
      const reopened = yield* shown(task.threadId)
      assert.deepStrictEqual([reopened.state, reopened.phase, reopened.actions], ['open', 'stopped', ['resume', 'abandon']])
      const [open] = yield* sql<{ settledAt: string | null }>`SELECT settled_at FROM tasks WHERE id = ${task.taskId}`
      assert.isNull(open?.settledAt)
      // Reopening an open task does nothing.
      yield* tasks.reopen({ envelope: yield* command('task.reopen'), taskId: task.taskId })
      assert.strictEqual((yield* shown(task.threadId)).state, 'open')

      // Abandoned with its branch gone too, it can't be reopened on it, and stays as it was.
      yield* tasks.abandon({ envelope: yield* command('task.abandon'), taskId: task.taskId })
      rmSync(before.worktree ?? '', { recursive: true, force: true })
      git(root, 'worktree', 'prune')
      git(root, 'branch', '-D', before.branch ?? '')
      const refused = yield* Effect.flip(tasks.reopen({ envelope: yield* command('task.reopen'), taskId: task.taskId }))
      assert.deepStrictEqual([(refused as { _tag?: string })._tag, (refused as { why?: string }).why], ['TaskRefused', 'branch_gone'])
      assert.strictEqual((yield* shown(task.threadId)).state, 'abandoned')
      // Its project removed from Althar, it isn't reopened there.
      yield* (yield* Projects).remove(project.projectId)
      const gone = yield* Effect.flip(tasks.reopen({ envelope: yield* command('task.reopen'), taskId: task.taskId }))
      assert.deepStrictEqual([(gone as { _tag?: string })._tag, (gone as { kind?: string }).kind], ['NotFound', 'project'])
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('abandons a task before its plan starts, and reopened, its plan waits held', () =>
    Effect.gen(function* () {
      const plans = yield* Plans
      const tasks = yield* Tasks
      const sql = yield* SqlClient.SqlClient
      const { task, planId, actor } = yield* planned('Later [lead:finish]')
      yield* tasks.abandon({ envelope: yield* command('task.abandon'), taskId: task.taskId })
      const [plan] = yield* sql<{ state: string; startsAt: string | null }>`SELECT state, starts_at FROM task_plans WHERE id = ${planId}`
      assert.deepStrictEqual({ ...plan }, { state: 'declined', startsAt: null })
      // Declined, it never starts.
      yield* plans.start(planId, actor)
      assert.strictEqual((yield* sql<{ n: number }>`SELECT count(*) AS n FROM runs`)[0]?.n, 0)

      yield* tasks.reopen({ envelope: yield* command('task.reopen'), taskId: task.taskId })
      const reopened = yield* shown(task.threadId)
      // A draft again, with its plan held: it starts when the person says.
      assert.deepStrictEqual([reopened.state, reopened.phase, reopened.actions], ['draft', 'held', ['start', 'abandon']])
      assert.notStrictEqual(reopened.planId, planId)
      yield* plans.start(reopened.planId ?? '', actor)
      yield* standsAt(task.threadId, (now) => now.phase === 'ready')
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('neither abandons nor reopens a merged task', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const changes = yield* Changes
      const tasks = yield* Tasks
      const sql = yield* SqlClient.SqlClient
      const root = repository()
      git(root, 'config', 'user.name', 'T')
      git(root, 'config', 'user.email', 't@t.test')
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: root })
      const task = yield* projects.createTask({
        envelope: yield* command('task.create'),
        projectId: project.projectId,
        title: 'Add a retry',
      })
      const [worktree] = yield* sql<{ slug: string; path: string }>`
        SELECT b.slug, w.path FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id WHERE w.task_id = ${task.taskId}`
      writeFileSync(join(worktree?.path ?? '', 'retry.ts'), 'retry\n')
      git(worktree?.path ?? '', 'add', '.')
      git(worktree?.path ?? '', 'commit', '-q', '-m', 'Retry')
      yield* changes.mergeHere(task.taskId, [{ repository: worktree?.slug ?? '', head: git(worktree?.path ?? '', 'rev-parse', 'HEAD') }])
      const merged = yield* shown(task.threadId)
      assert.deepStrictEqual([merged.state, merged.actions], ['done', []])
      for (const refused of [
        yield* Effect.flip(tasks.abandon({ envelope: yield* command('task.abandon'), taskId: task.taskId })),
        yield* Effect.flip(tasks.reopen({ envelope: yield* command('task.reopen'), taskId: task.taskId })),
      ])
        assert.deepStrictEqual([(refused as { _tag?: string })._tag, (refused as { why?: string }).why], ['TaskRefused', 'merged'])
      // Stopping or resuming it is nothing; nor has it a run to resume.
      yield* tasks.stop({ envelope: yield* command('task.stop'), taskId: task.taskId })
      yield* tasks.resume({ envelope: yield* command('task.resume'), taskId: task.taskId })
      yield* (yield* Runs).resume({ envelope: yield* command('task.resume'), taskId: task.taskId })
      assert.strictEqual((yield* shown(task.threadId)).state, 'done')
      // A task that isn't there isn't found.
      const missing = yield* Effect.flip(tasks.stop({ envelope: yield* command('task.stop'), taskId: 'task_missing' }))
      assert.strictEqual((missing as { _tag?: string })._tag, 'NotFound')
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('stops a reviewer that was still starting as the task stopped, once it is up', () =>
    Effect.gen(function* () {
      const plans = yield* Plans
      const tasks = yield* Tasks
      const sql = yield* SqlClient.SqlClient
      const { task, planId, actor } = yield* planned('Retry checkout [lead:finish] [review:wait]', [implement(), reviewBy()])
      yield* plans.start(planId, actor)
      // The review is admitted and its reviewer takes its time to start: the task stops meanwhile.
      yield* until(
        sql<{
          id: string
        }>`SELECT a.id FROM node_attempts a JOIN nodes n ON n.id = a.node_id WHERE n.node_key = 'review' AND a.state = 'admitted'`,
        (rows) => rows.length === 1,
      )
      yield* tasks.stop({ envelope: yield* command('task.stop'), taskId: task.taskId })
      const reviewThread = sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${task.taskId} AND kind = 'step'`
      const [thread] = yield* until(reviewThread, (rows) => rows.length === 1)
      // Once up, it is stopped, and its attempt stays as stopping left it.
      yield* until(
        sql<{ state: string }>`SELECT state FROM provider_sessions WHERE thread_id = ${thread?.id ?? ''}`,
        (rows) => rows.length === 1 && rows[0]?.state !== 'starting' && rows[0]?.state !== 'active',
      )
      assert.isFalse(yield* onThread(thread?.id ?? ''))
      assert.deepStrictEqual((yield* attempts(task.taskId)).at(-1), ['review', 0, 'cancelled', true])
      assert.strictEqual((yield* runOf(task.taskId)).state, 'suspended')
      // Resumed, the review starts on its planned reviewer, as it never had one.
      yield* tasks.resume({ envelope: yield* command('task.resume'), taskId: task.taskId })
      const [reviewing] = yield* until(
        sql<{ agentId: string }>`
          SELECT s.agent_id FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN provider_sessions s ON s.id = a.provider_session_id
          WHERE n.node_key = 'review' AND a.state = 'running'`,
        (rows) => rows.length === 1,
      )
      assert.strictEqual(reviewing?.agentId, 'codex')
    }).pipe(Effect.provide(withQueries({ each: { codex: { slowStart: 1_500 } } }))),
  )

  it.live('resumes a review on the agent it was handed to, not the one planned', () =>
    Effect.gen(function* () {
      const plans = yield* Plans
      const tasks = yield* Tasks
      const runs = yield* Runs
      const sql = yield* SqlClient.SqlClient
      // The planned reviewer can't start: the person hands the review to Codex, which reviews until stopped.
      const { task, planId, actor } = yield* planned('Retry checkout [lead:finish] [review:wait]', [implement(), reviewBy('missing')])
      yield* plans.start(planId, actor)
      const [call] = yield* until(
        sql<{ id: string }>`SELECT id FROM attention_requests WHERE task_id = ${task.taskId} AND state = 'open'`,
        (rows) => rows.length === 1,
      )
      yield* runs.answerStuck({
        envelope: yield* command('attention.answer'),
        attentionId: call?.id ?? '',
        answer: { kind: 'retry', agentId: 'codex' },
      })
      const reviewing = sql<{ agentId: string }>`
        SELECT s.agent_id FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN provider_sessions s ON s.id = a.provider_session_id
        WHERE n.node_key = 'review' AND a.state = 'running'`
      yield* until(reviewing, (rows) => rows[0]?.agentId === 'codex')
      yield* tasks.stop({ envelope: yield* command('task.stop'), taskId: task.taskId })
      yield* tasks.resume({ envelope: yield* command('task.resume'), taskId: task.taskId })
      const [again] = yield* until(reviewing, (rows) => rows.length === 1)
      assert.strictEqual(again?.agentId, 'codex')
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('starts no run for a plan accepted as its task was abandoned', () =>
    Effect.gen(function* () {
      const tasks = yield* Tasks
      const runs = yield* Runs
      const sql = yield* SqlClient.SqlClient
      const { task, planId } = yield* planned('Later [lead:finish]')
      yield* tasks.abandon({ envelope: yield* command('task.abandon'), taskId: task.taskId })
      // The plan's start had got past accepting it: its run is what would follow.
      yield* runs.run(planId)
      assert.strictEqual((yield* sql<{ n: number }>`SELECT count(*) AS n FROM runs`)[0]?.n, 0)
      assert.isFalse(yield* onThread(task.threadId))
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('says what publishing did when the task stopped as it published, ends nothing, and adopts it when resumed', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    git(working, 'config', 'user.name', 'Fake')
    git(working, 'config', 'user.email', 'fake@althar.test')
    const gate = Deferred.makeUnsafe<void>()
    // Opening the pull request waits until the test lets it go.
    const slow: FakeService = {
      ...github,
      openChange: (repository, change) => Effect.andThen(Deferred.await(gate), github.openChange(repository, change)),
    }
    return Effect.gen(function* () {
      const plans = yield* Plans
      const tasks = yield* Tasks
      const sql = yield* SqlClient.SqlClient
      yield* connectGitHub
      const { task, planId, actor } = yield* planned('Retry checkout [lead:finish] [lead:edit]', [implement()], {
        root: working,
        end: 'draft',
      })
      yield* plans.start(planId, actor)
      yield* until(
        sql<{
          id: string
        }>`SELECT a.id FROM node_attempts a JOIN nodes n ON n.id = a.node_id WHERE n.node_key = 'publish' AND a.state = 'running'`,
        (rows) => rows.length === 1,
      )
      yield* tasks.stop({ envelope: yield* command('task.stop'), taskId: task.taskId })
      yield* Deferred.succeed(gate, undefined)
      // What it did on the host is said; the run waits, and nothing asks the person.
      yield* until(
        sql<{ summary: string }>`
          SELECT json_extract(content, '$.summary') AS summary FROM thread_items
          WHERE thread_id = ${task.threadId} AND kind = 'step_result' AND json_extract(content, '$.step') = 'publish'`,
        (rows) => rows.length === 1,
      )
      assert.deepStrictEqual(yield* runOf(task.taskId), { state: 'suspended', attempts: ['interrupted'] })
      assert.deepStrictEqual((yield* attempts(task.taskId)).at(-1), ['publish', 0, 'cancelled', true])
      assert.deepStrictEqual(yield* callsOf(task.taskId), [])
      assert.strictEqual(github.changes.length, 1)
      // Resumed, it publishes again and adopts the pull request it opened: ready, with one.
      yield* tasks.resume({ envelope: yield* command('task.resume'), taskId: task.taskId })
      yield* standsAt(task.threadId, (now) => now.phase === 'ready')
      assert.strictEqual(github.changes.length, 1)
      assert.strictEqual((yield* runOf(task.taskId)).state, 'succeeded')
    }).pipe(Effect.provide(withGitHub(slow)))
  })

  it.live('makes an abandoned task done when its pull request merges on the host after all, and then never reopens it', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    git(working, 'config', 'user.name', 'Fake')
    git(working, 'config', 'user.email', 'fake@althar.test')
    return Effect.gen(function* () {
      const plans = yield* Plans
      const tasks = yield* Tasks
      const changes = yield* Changes
      yield* connectGitHub
      const { task, planId, actor } = yield* planned('Retry checkout [lead:finish] [lead:edit]', [implement()], {
        root: working,
        end: 'draft',
      })
      yield* plans.start(planId, actor)
      yield* standsAt(task.threadId, (now) => now.phase === 'ready')
      yield* tasks.abandon({ envelope: yield* command('task.abandon'), taskId: task.taskId })
      assert.deepStrictEqual((yield* shown(task.threadId)).actions, ['reopen'])
      github.mergeByHand(1)
      yield* changes.refresh(task.taskId)
      const [done] = yield* standsAt(task.threadId, (now) => now.state === 'done')
      assert.deepStrictEqual(done?.actions, [])
      const refused = yield* Effect.flip(tasks.reopen({ envelope: yield* command('task.reopen'), taskId: task.taskId }))
      assert.deepStrictEqual([(refused as { _tag?: string })._tag, (refused as { why?: string }).why], ['TaskRefused', 'merged'])
    }).pipe(Effect.provide(withGitHub(github)))
  })

  it.live('brings back, held, the plan of a task abandoned as its plan was starting, so it can start again', () =>
    Effect.gen(function* () {
      const plans = yield* Plans
      const tasks = yield* Tasks
      const runs = yield* Runs
      const sql = yield* SqlClient.SqlClient
      const { task, planId, actor } = yield* planned('Later [lead:finish]')
      // Its start had accepted the plan, and abandoning comes before the run that start makes.
      yield* sql`UPDATE task_plans SET state = 'accepted', starts_at = NULL WHERE id = ${planId}`
      yield* tasks.abandon({ envelope: yield* command('task.abandon'), taskId: task.taskId })
      yield* runs.run(planId)
      assert.strictEqual((yield* sql<{ n: number }>`SELECT count(*) AS n FROM runs`)[0]?.n, 0)
      yield* tasks.reopen({ envelope: yield* command('task.reopen'), taskId: task.taskId })
      const reopened = yield* shown(task.threadId)
      assert.deepStrictEqual([reopened.state, reopened.phase, reopened.actions], ['draft', 'held', ['start', 'abandon']])
      assert.isNotNull(reopened.planId)
      // The start that was on its way makes no run of the plan it had, now declined; the one brought back starts.
      yield* runs.run(planId)
      assert.strictEqual((yield* sql<{ n: number }>`SELECT count(*) AS n FROM runs`)[0]?.n, 0)
      yield* plans.start(reopened.planId ?? '', actor)
      yield* standsAt(task.threadId, (now) => now.phase === 'ready')
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('starts or hands over no agent on an abandoned task until it is reopened', () =>
    Effect.gen(function* () {
      const plans = yield* Plans
      const tasks = yield* Tasks
      const sessions = yield* Sessions
      const { task, planId, actor } = yield* planned('Retry checkout [lead:wait]')
      yield* plans.start(planId, actor)
      yield* standsAt(task.threadId, (now) => now.phase === 'running')
      yield* tasks.abandon({ envelope: yield* command('task.abandon'), taskId: task.taskId })
      for (const refused of [
        yield* Effect.flip(sessions.start({ threadId: task.threadId, agentId: 'codex' })),
        yield* Effect.flip(sessions.switchAgent({ threadId: task.threadId, agentId: 'codex' })),
      ])
        assert.deepStrictEqual([(refused as { _tag?: string })._tag, (refused as { why?: string }).why], ['TaskRefused', 'abandoned'])
      assert.isFalse(yield* onThread(task.threadId))
      // Reopened, an agent starts on it again.
      yield* tasks.reopen({ envelope: yield* command('task.reopen'), taskId: task.taskId })
      yield* sessions.start({ threadId: task.threadId, agentId: 'codex' })
      assert.isTrue(yield* onThread(task.threadId))
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('drops a step’s report that arrives after its task was stopped and resumed, and starts nothing from it', () =>
    Effect.gen(function* () {
      const plans = yield* Plans
      const tasks = yield* Tasks
      const sql = yield* SqlClient.SqlClient
      // The lead's report waits on the runtime's look at what isn't committed: the task is stopped and resumed meanwhile.
      const gate = yield* gitGate('core.quotePath=false diff --name-only HEAD')
      const { task, planId, actor } = yield* planned('Retry checkout [lead:finish] [review:wait]', [implement(), reviewBy()], {
        end: 'none',
      })
      gate.arm()
      yield* plans.start(planId, actor)
      yield* until(
        Effect.sync(() => (gate.caught() ? [true] : [])),
        (rows) => rows.length === 1,
      )
      const [stale] = yield* sql<{ id: string }>`
        SELECT a.id FROM node_attempts a JOIN nodes n ON n.id = a.node_id WHERE n.node_key = 'implement' ORDER BY a.admitted_at LIMIT 1`
      yield* tasks.stop({ envelope: yield* command('task.stop'), taskId: task.taskId })
      yield* tasks.resume({ envelope: yield* command('task.resume'), taskId: task.taskId })
      // The resumed lead reports, and its review starts.
      const reviews = sql<{ id: string }>`
        SELECT a.id FROM node_attempts a JOIN nodes n ON n.id = a.node_id WHERE n.node_key = 'review'`
      yield* until(reviews, (rows) => rows.length === 1)
      // The report from before goes through now: it is dropped, and said in the record.
      gate.open()
      yield* until(
        sql<{
          type: string
        }>`SELECT type FROM record_events WHERE aggregate_id = ${stale?.id ?? ''} AND type = 'node_attempt.report_dropped'`,
        (rows) => rows.length === 1,
      )
      const [kept] = yield* sql<{ state: string; stopped: number | null }>`
        SELECT state, json_extract(output, '$.stopped') AS stopped FROM node_attempts WHERE id = ${stale?.id ?? ''}`
      assert.deepStrictEqual({ ...kept }, { state: 'cancelled', stopped: 1 })
      assert.strictEqual((yield* reviews).length, 1)
      const reported = yield* sql<{ n: number }>`
        SELECT count(*) AS n FROM thread_items WHERE thread_id = ${task.threadId} AND kind = 'step_result' AND json_extract(content, '$.step') = 'implement'`
      assert.strictEqual(reported[0]?.n, 1)
    }).pipe(Effect.scoped, Effect.provide(withQueries({ stopGrace: Duration.millis(500) }))),
  )

  it.live(
    'admits no next step for a report read before its task was stopped and resumed',
    () =>
      Effect.gen(function* () {
        const plans = yield* Plans
        const tasks = yield* Tasks
        const sql = yield* SqlClient.SqlClient
        // The review finds something; the lead settles it, and Althar's look at what settling changed, the third look at the
        // worktree's tree (after the review's copy and settling's start), waits: the task is stopped and resumed meanwhile.
        const gate = yield* gitGate('write-tree')
        const { task, planId, actor } = yield* planned('Tighten the types [lead:finish] [review:findings]', [implement(), reviewBy()])
        gate.arm(3)
        yield* plans.start(planId, actor)
        yield* until(
          Effect.sync(() => (gate.caught() ? [true] : [])),
          (rows) => rows.length === 1,
        )
        yield* tasks.stop({ envelope: yield* command('task.stop'), taskId: task.taskId })
        yield* tasks.resume({ envelope: yield* command('task.resume'), taskId: task.taskId })
        // The settling read before the stop goes on while the resumed one runs: it finds its run resumed since, and admits no
        // round of its own. Only the resumed settling's second round runs.
        gate.open()
        yield* until(
          Effect.sync(() => (gate.done() ? [true] : [])),
          (rows) => rows.length === 1,
        )
        yield* standsAt(task.threadId, (now) => now.phase === 'ready', Duration.seconds(40))
        const secondRounds = yield* sql<{ id: string }>`
        SELECT a.id FROM node_attempts a JOIN nodes n ON n.id = a.node_id WHERE n.node_key = 'review' AND n.iteration = 1`
        assert.strictEqual(secondRounds.length, 1)
        assert.strictEqual((yield* runOf(task.taskId)).state, 'succeeded')
      }).pipe(Effect.scoped, Effect.provide(withQueries({ stopGrace: Duration.millis(500) }))),
    60_000,
  )

  it.live('resumes only once stopping has stopped the lead, so the resumed step keeps its lead', () =>
    Effect.gen(function* () {
      const plans = yield* Plans
      const tasks = yield* Tasks
      const sessions = yield* Sessions
      const sql = yield* SqlClient.SqlClient
      // A lead that doesn't stop when asked: stopping it waits out the grace, and Resume is pressed meanwhile.
      const { task, planId, actor } = yield* planned('Retry checkout [lead:wedge-once] [lead:finish]')
      yield* plans.start(planId, actor)
      yield* until(
        Effect.map(sessions.running(task.threadId), (live) => (Option.isSome(live) && live.value.turnRunning ? [live] : [])),
        (rows) => rows.length === 1,
      )
      const stopping = yield* Effect.forkChild(tasks.stop({ envelope: yield* command('task.stop'), taskId: task.taskId }))
      yield* until(sql<{ state: string }>`SELECT state FROM runs WHERE task_id = ${task.taskId}`, (rows) => rows[0]?.state === 'suspended')
      yield* tasks.resume({ envelope: yield* command('task.resume'), taskId: task.taskId })
      yield* Fiber.join(stopping)
      // The resumed lead is a fresh one, which carries the step on to the end; nothing waits on the person.
      yield* standsAt(task.threadId, (now) => now.phase === 'ready')
      assert.deepStrictEqual(yield* callsOf(task.taskId), [])
      assert.strictEqual(
        (yield* sql<{ n: number }>`SELECT count(*) AS n FROM provider_sessions WHERE thread_id = ${task.threadId}`)[0]?.n,
        2,
      )
    }).pipe(Effect.provide(withQueries({ stopGrace: Duration.seconds(2) }))),
  )
})
