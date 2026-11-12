import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Fiber, Layer, Option, Tracer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../../src/Connections'
import { Coordinator } from '../../src/Coordinator'
import { Instance } from '../../src/Instance'
import { Projects } from '../../src/Projects'
import { Queries } from '../../src/Queries'
import { Runs } from '../../src/Runs'
import * as Runtime from '../../src/Runtime'
import { Sessions } from '../../src/Sessions'
import { fakeConnectors, HOST, hosted, runtime, until } from '../support'
import { lag, type Priority, profiled, spans, spawns, stress, summary } from './load'

/*
 * How quickly the runtime answers the window while the computer is busy, run
 * by hand (`bunx vp test run --config vite.real.config.ts`), never in CI. It
 * builds a profile the size of a real one: a project of 400 tasks, one of
 * them with 5,000 items and 500 turns in its thread, on a store on disk; a
 * window that reads the board and the home again as the change feed says;
 * and agents at work in other tasks. Then it times what the person waits
 * on: a task's view opening, the board, the home, and Ship from the press to
 * its answer and to its commits on the host, with nothing else running, and
 * again with every core busy and the disk written to, as agents' builds do.
 * What it finds goes to stdout and to `ALTHAR_RESPONSIVENESS_OUT`, as JSON.
 */

const PHASES = (process.env.ALTHAR_PHASES ?? 'idle,load').split(',') as ReadonlyArray<'idle' | 'load' | 'load-bg'>
const REPEATS = Number(process.env.ALTHAR_REPEATS ?? 6)
const SHIPS = Number(process.env.ALTHAR_SHIPS ?? 3)
const SETTLED = Number(process.env.ALTHAR_SETTLED ?? 380)
const ITEMS = Number(process.env.ALTHAR_ITEMS ?? 5000)
const TURNS = Number(process.env.ALTHAR_TURNS ?? 500)
/** How far away the host is: each of its API's calls waits this long, as GitHub's took on average in the person's log. */
const HOST_MS = Number(process.env.ALTHAR_HOST_MS ?? 400)

/** A line of what it found, on stdout, where the run's output is read. */
const say = (...what: ReadonlyArray<unknown>) =>
  void process.stdout.write(`${what.map((one) => (typeof one === 'string' ? one : JSON.stringify(one, null, 1))).join(' ')}\n`)

const git = (cwd: string, ...args: Array<string>) => execFileSync('git', args, { cwd }).toString().trim()

const store = join(mkdtempSync(join(tmpdir(), 'althar-responsive-')), 'althar.sqlite')
const traced = spans()
const started = spawns()

const onGitHub = () => {
  const { working, bare } = hosted()
  const github = makeFakeService({
    pushUrl: () => bare,
    waitsFor: () => Effect.sleep(Duration.millis(HOST_MS)),
  })
  github.addRepository(['meridian', 'api'])
  git(working, 'config', 'user.name', 'Fake')
  git(working, 'config', 'user.email', 'fake@althar.test')
  return { working, bare, github }
}

const runtimeWith = (github: FakeService) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(store, {}, { connectors: fakeConnectors({ github }) })),
    Layer.provide(Layer.succeed(Tracer.Tracer, traced.tracer)),
  )

const cards = (projectId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const snapshot = yield* Effect.orDie(queries.coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

const idle = (threadId: string) =>
  until(
    Effect.flatMap(Sessions, (sessions) => sessions.busy(threadId)),
    (busy) => !busy,
  )

/** Tasks planned by the coordinator, led to a draft pull request and reviewed: ready, as most open tasks stand. */
const ready = (projectId: string, count: number) =>
  Effect.gen(function* () {
    const coordinator = yield* Coordinator
    const threadId = yield* coordinator.thread(projectId)
    const made: Array<{ taskId: string; threadId: string; path: string; branch: string }> = []
    const sql = yield* SqlClient.SqlClient
    for (let index = 0; index < count; index += 1) {
      const body = `Add retry number ${index + 1}. [coordinator:plan] [lead:finish] [lead:edit] [review:pass]`
      yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
      const all = yield* until(
        cards(projectId),
        (shown) => shown.filter((card) => card.phase === 'ready' && card.change !== null).length > index,
        'the task ready',
      )
      const card = all.find((one) => one.phase === 'ready' && !made.some((was) => was.taskId === one.taskId))
      if (card === undefined) return assert.fail('no card')
      yield* idle(card.threadId)
      const [workspace] = yield* sql<{ path: string; branch: string }>`SELECT path, branch FROM workspaces WHERE task_id = ${card.taskId}`
      made.push({ taskId: card.taskId, threadId: card.threadId, path: workspace?.path ?? '', branch: workspace?.branch ?? '' })
    }
    return made
  })

/** A thread as long as the person's longest: its items copied to `items` and its turns to `turns`, each new. */
const lengthen = (threadId: string, items: number, turns: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const prompt = 'x'.repeat(24_000)
    yield* sql.withTransaction(
      Effect.gen(function* () {
        const [turn] = yield* sql<{ id: string }>`SELECT id FROM turn_deliveries WHERE thread_id = ${threadId} LIMIT 1`
        for (let index = 0; index < turns; index += 1)
          yield* sql.unsafe(
            `INSERT INTO turn_deliveries (id, project_id, thread_id, provider_session_id, node_attempt_id, controller_generation, model, effort, usage,
              stop_reason, state, requested_at, delivered_at, ended_at, prompt, origin, heads, timings)
             SELECT 'turn_' || lower(hex(randomblob(16))), project_id, thread_id, provider_session_id, node_attempt_id, controller_generation, model, effort,
              usage, stop_reason, 'completed', requested_at, delivered_at, coalesce(ended_at, requested_at), ?, origin, heads, timings
             FROM turn_deliveries WHERE id = ?`,
            [prompt, turn?.id ?? ''],
          )
        const [{ top } = { top: 0 }] = yield* sql<{
          top: number
        }>`SELECT max(sequence) AS top FROM thread_items WHERE thread_id = ${threadId}`
        const kinds = yield* sql<{ id: string }>`
          SELECT id FROM thread_items WHERE thread_id = ${threadId} AND kind IN ('tool_call', 'agent_message', 'agent_thought') ORDER BY sequence`
        for (let index = 0; index < items; index += 1) {
          const from = kinds[index % kinds.length]
          yield* sql.unsafe(
            `INSERT INTO thread_items (id, project_id, thread_id, sequence, kind, user_input_id, delivery_id, provider_session_id, tool_call_id, content, created_at, revision)
             SELECT 'item_' || lower(hex(randomblob(16))), project_id, thread_id, ?, kind, user_input_id, delivery_id, provider_session_id,
              CASE WHEN tool_call_id IS NULL THEN NULL ELSE tool_call_id || '-' || ? END, content, created_at, revision
             FROM thread_items WHERE id = ?`,
            [top + index + 1, index, from?.id ?? ''],
          )
        }
      }),
    )
  })

/** Tasks long finished, as most of the person's are: made, then marked done and settled. */
const settled = (projectId: string, count: number) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const sql = yield* SqlClient.SqlClient
    for (let index = 0; index < count; index += 1) {
      const title = `Old task ${index + 1}`
      const made = yield* projects.createTask({ envelope: yield* Runtime.envelope('task.create', { title }), projectId, title })
      yield* sql`UPDATE tasks SET state = 'done', settled_at = '2026-10-01T09:00:00.000Z' WHERE id = ${made.taskId}`
    }
  })

/** Rows the change feed has carried, as many as the person's store has had. */
const history = (rows: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql.unsafe(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
       INSERT INTO change_log (project_id, aggregate_type, aggregate_id, aggregate_revision, changed_at)
       SELECT NULL, 'thread_item', 'item_' || printf('%032x', i), 1, '2026-10-01T09:00:00.000Z' FROM n`,
      [rows],
    )
  })

/** A window: what the change feed says, every 60 ms, and the board and the home read again as it does (feed.ts). */
const window = (projectId: string, reads: Array<{ what: string; ms: number }>) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    let after = yield* queries.cursor
    for (;;) {
      yield* Effect.sleep(Duration.millis(60))
      const changes = yield* queries.changesSince(after, 500)
      if (changes.length === 0) continue
      after = changes.at(-1)?.cursor ?? after
      const board = changes.some((change) =>
        [
          'task',
          'task_plan',
          'run',
          'node_attempt',
          'provider_session',
          'turn_delivery',
          'attention_request',
          'external_link',
          'workspace',
        ].includes(change.aggregateType),
      )
      if (!board) continue
      const began = performance.now()
      yield* Effect.ignore(queries.board(projectId))
      reads.push({ what: 'board', ms: performance.now() - began })
      const home = performance.now()
      yield* Effect.ignore(queries.home())
      reads.push({ what: 'home', ms: performance.now() - home })
    }
  })

/** Agents at work in other tasks: each lead given something to do in turn, as long as the run lasts. */
const working = (threads: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    for (let index = 0; ; index += 1) {
      const threadId = threads[index % threads.length] ?? ''
      if (!(yield* sessions.busy(threadId))) {
        const body = `Keep going ${index}. [lead:edit]`
        const live = Option.isSome(yield* sessions.running(threadId))
        yield* Effect.ignore(sessions.send({ envelope: yield* Runtime.envelope('thread.send', { threadId, body }), threadId, body }))
        if (!live) yield* Effect.ignore(sessions.startLast(threadId))
      }
      yield* Effect.sleep(Duration.millis(1500))
    }
  })

const timed = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const began = performance.now()
    yield* effect
    return performance.now() - began
  })

describe('the runtime under load', () => {
  it.live(
    'answers the window as quickly busy as idle',
    () => {
      const { working: checkout, bare, github } = onGitHub()
      return Effect.gen(function* () {
        const connections = yield* Connections
        const instance = yield* Instance
        const queries = yield* Queries
        const runs = yield* Runs
        const sql = yield* SqlClient.SqlClient
        yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
        const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: checkout })
        const projectId = project.projectId
        const seeding = performance.now()
        const [long, shipped, ...others] = yield* ready(projectId, 4)
        if (long === undefined || shipped === undefined) return assert.fail('no tasks')
        yield* lengthen(long.threadId, ITEMS, TURNS)
        traced.clear()
        started.clear()
        const making = performance.now()
        yield* settled(projectId, SETTLED)
        say(JSON.stringify({ createTaskEach: Math.round((performance.now() - making) / Math.max(1, SETTLED)), long: traced.long() }))
        yield* history(Number(process.env.ALTHAR_CHANGES ?? 1_000_000))
        say(`seeded in ${Math.round((performance.now() - seeding) / 1000)} s`)

        const results: Record<string, unknown> = {}
        // What each read starts, with nothing else at work: the git commands a task's view, the board and the home run.
        yield* Effect.sleep(Duration.seconds(3))
        const quiet: Record<string, unknown> = {}
        const reads: ReadonlyArray<readonly [string, Effect.Effect<unknown, unknown>]> = [
          ['open', queries.thread(long.threadId, { fresh: true })],
          ['open again', queries.thread(long.threadId)],
          ['board', queries.board(projectId)],
          ['home', queries.home()],
        ]
        for (const [what, read] of reads) {
          started.clear()
          traced.clear()
          const ms = yield* timed(read)
          quiet[what] = { ms: Math.round(ms), spawned: started.top(12), spans: traced.top(8) }
        }
        results.quiet = quiet
        say(JSON.stringify(quiet, null, 1))
        for (const phase of PHASES) {
          const load = phase === 'idle' ? undefined : stress(phase === 'load-bg' ? ('background' satisfies Priority) : 'normal')
          // Its processes take a moment to take the cores.
          yield* Effect.sleep(Duration.seconds(2))
          traced.clear()
          started.clear()
          const reads: Array<{ what: string; ms: number }> = []
          const watching = yield* Effect.forkChild(window(projectId, reads))
          const busy = yield* Effect.forkChild(working(others.map((one) => one.threadId)))
          const loop = lag()
          const profile = process.env.ALTHAR_PROFILE_CPU === '1' ? yield* Effect.promise(profiled) : undefined
          const open: Array<number> = []
          const board: Array<number> = []
          const home: Array<number> = []
          const answered: Array<number> = []
          const up: Array<number> = []
          for (let index = 0; index < REPEATS; index += 1) {
            open.push(yield* timed(queries.thread(long.threadId, { fresh: true })))
            board.push(yield* timed(queries.board(projectId)))
            home.push(yield* timed(queries.home()))
          }
          for (let index = 0; index < SHIPS; index += 1) {
            // What the person asked of the lead after its review, committed in a turn and held for Ship.
            const sessions = yield* Sessions
            const body = `Tidy it, ${phase} ${index}. tidy pls [lead:commit]`
            const live = Option.isSome(yield* sessions.running(shipped.threadId))
            yield* sessions.send({
              envelope: yield* Runtime.envelope('thread.send', { threadId: shipped.threadId, body }),
              threadId: shipped.threadId,
              body,
            })
            if (!live) yield* Effect.ignore(sessions.startLast(shipped.threadId))
            yield* until(
              sql<{ heldAt: string | null }>`SELECT held_at FROM workspaces WHERE task_id = ${shipped.taskId}`,
              (rows) => rows[0]?.heldAt != null,
              'the commit held',
            )
            yield* idle(shipped.threadId)
            const before = git(bare, 'rev-parse', shipped.branch)
            const began = performance.now()
            yield* runs.ship({ envelope: yield* Runtime.envelope('task.ship', { taskId: shipped.taskId }), taskId: shipped.taskId })
            answered.push(performance.now() - began)
            // Up once the host has the branch as it is here: what the turn committed, and anything the round added.
            yield* until(
              Effect.sync(() => {
                const there = git(bare, 'rev-parse', shipped.branch)
                return there !== before && there === git(shipped.path, 'rev-parse', 'HEAD')
              }),
              (up) => up,
              'the commit on the host',
            )
            up.push(performance.now() - began)
            yield* until(
              sql<{ state: string }>`SELECT state FROM runs WHERE task_id = ${shipped.taskId} ORDER BY created_at DESC, rowid DESC LIMIT 1`,
              (rows) => rows[0]?.state !== 'running',
              'the ship over',
            )
            yield* idle(shipped.threadId)
          }
          const delay = loop.read()
          const cpu = profile === undefined ? undefined : yield* Effect.promise(() => profile.stop())
          yield* Fiber.interrupt(watching)
          yield* Fiber.interrupt(busy)
          load?.stop()
          const of = (what: string) => summary(reads.filter((read) => read.what === what).map((read) => read.ms))
          results[phase] = {
            open: summary(open),
            board: summary(board),
            home: summary(home),
            shipAnswered: summary(answered),
            shipUp: summary(up),
            windowBoard: of('board'),
            windowHome: of('home'),
            eventLoopDelay: delay,
            spans: traced.top(30),
            spawned: started.top(30),
            longTransactions: traced.long(),
            ...(cpu === undefined ? {} : { cpu: cpu.top }),
          }
          say(JSON.stringify({ phase, ...(results[phase] as object) }, null, 1))
          yield* Effect.sleep(Duration.seconds(2))
        }
        const out = process.env.ALTHAR_RESPONSIVENESS_OUT
        if (out !== undefined) writeFileSync(out, JSON.stringify(results, null, 2))
      }).pipe(Effect.provide(runtimeWith(github)))
    },
    60 * 60_000,
  )
})
