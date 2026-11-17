import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { Ledger } from '@althar/persistence-sqlite'
import { measure } from '@althar/testing/performance'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { SqlClient } from 'effect/sql'
import { afterAll, beforeAll, test } from 'vitest'

import { Connections } from '../src/Connections'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Tasks } from '../src/Tasks'
import { recorder } from '../src/threads'
import { lengthen, lengthenCoordinator, type Made, onGitHub, ready, settled } from './real/seed'
import { fakeConnectors, HOST, runtime, until } from './support'

/*
 * How fast what a window waits on as the feed moves is, and what one change
 * costs the runtime, for the performance run (`bun run test:performance`),
 * which gates nothing: on a small store of the person's shape, made once for
 * the file on disk (seed.ts, as tests/real/responsiveness.test.ts makes one of
 * their size): 60 tasks, 8 of them open, two led to a draft pull request, one
 * with a thread of 1,000 items, and a coordinator's thread of 400 with its
 * cards. A board, the home, a task's latest page and the coordinator's are
 * what each window reads again as agents work; a tool call's update is what
 * an agent writes most; and a card worked out again is what each change
 * costs before any window hears of it.
 */

const store = join(mkdtempSync(join(tmpdir(), 'althar-bench-')), 'althar.sqlite')
const { working, github } = onGitHub(() => 0)
const layer = Queries.layer.pipe(Layer.provideMerge(runtime(store, {}, { connectors: fakeConnectors({ github }) })))
const made = ManagedRuntime.make(layer)
const run = <A, E>(effect: Effect.Effect<A, E, Layer.Success<typeof layer>>) => made.runPromise(effect)

let projectId = ''
let long: Made | undefined
let open: Made | undefined
let sessionId = ''

beforeAll(async () => {
  await run(
    Effect.gen(function* () {
      const instance = yield* Instance
      yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
      const projects = yield* Projects
      projectId = (yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })).projectId
      const led = yield* ready(projectId, 2)
      long = led[0]
      open = led[1]
      // Six more open, made as the person makes one, not yet started.
      for (let index = 0; index < 6; index += 1) {
        const title = `Open task ${index + 1}`
        yield* projects.createTask({ envelope: yield* Runtime.envelope('task.create', { projectId, title }), projectId, title })
      }
      if (long === undefined || open === undefined) return
      yield* lengthen(long.threadId, 1_000, 100)
      const old = yield* settled(long, 52)
      yield* lengthenCoordinator(projectId, 400, [long.taskId, open.taskId, ...old])
      const sql = yield* SqlClient.SqlClient
      const [session] = yield* sql<{
        id: string
      }>`SELECT id FROM provider_sessions WHERE thread_id = ${open.threadId} ORDER BY rowid DESC LIMIT 1`
      sessionId = session?.id ?? ''
      // At rest before anything is timed: what making the store set going, its cards worked out among it, over.
      let last = { cursor: -1, at: 0 }
      yield* until(
        Effect.map(sql<{ cursor: number }>`SELECT coalesce(max(cursor), 0) AS cursor FROM change_log`, ([row]) => row?.cursor ?? 0),
        (cursor) => {
          if (cursor !== last.cursor) last = { cursor, at: performance.now() }
          return performance.now() - last.at > 1_000
        },
        'the store at rest',
      )
    }),
  )
})

afterAll(async () => {
  await made.dispose()
  rmSync(dirname(store), { recursive: true, force: true })
})

/*
 * The budgets, in ms on average: a read half a window call's (100 ms with the Mac busy, foundations.md, The UI is
 * instant, rule 5), on a store a tenth the person's size with nothing else at work; a write a small part of what the
 * reads after it cost; a card's round its gather (Queries `CARDS_GATHER`, 50 ms) and as much again.
 */
const READ = 50
const WRITE = 5
const ROUND = 150

/** A read of the store, as a window's call makes it. */
const reading = (read: (queries: Queries['Service']) => Effect.Effect<unknown, unknown>) => () =>
  run(
    Effect.gen(function* () {
      return yield* read(yield* Queries)
    }),
  )

test('reads what a window reads again as the feed moves', (context) =>
  measure(context, READ, {
    'queries.board': reading((queries) => queries.board(projectId)),
    'queries.home': reading((queries) => queries.home()),
    'queries.thread, its latest page': reading((queries) => queries.thread(long?.threadId ?? '')),
    'queries.coordinator, its latest page': reading((queries) => queries.coordinator(projectId)),
  }))

let updates = 0
test('writes one tool call’s update as its session does', (context) => {
  const writer = recorder({ projectId: projectId as never, threadId: open?.threadId ?? '', sessionId })
  return run(writer.record({ _tag: 'ToolCall', toolCallId: 'bench', title: 'Read README.md', kind: 'read', status: 'in_progress' })).then(
    () =>
      measure(context, WRITE, {
        'a tool call update': () =>
          run(writer.record({ _tag: 'ToolCallUpdate', toolCallId: 'bench', title: `Read README.md, ${(updates += 1)}` })),
      }),
  )
})

let renames = 0
/** A change to a task its card shows, and the card watcher's round that works it out again, to the feed's saying so. */
const cardAgain = () =>
  run(
    Effect.scoped(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const grown = yield* (yield* Ledger).listen
        const [{ cursor } = { cursor: 0 }] = yield* sql<{ cursor: number }>`SELECT coalesce(max(cursor), 0) AS cursor FROM change_log`
        const taskId = open?.taskId ?? ''
        const title = `Retry the payment call, ${(renames += 1)}`
        yield* (yield* Tasks).rename({ envelope: yield* Runtime.envelope('task.rename', { taskId, title }), taskId, title, follow: 'none' })
        const said = sql<{ n: number }>`
          SELECT count(*) AS n FROM change_log WHERE cursor > ${cursor} AND aggregate_type = 'card' AND aggregate_id = ${taskId}`
        // Woken as the feed grows, not on a timer of its own: the round's end is what is timed.
        while (((yield* said)[0]?.n ?? 0) === 0) yield* grown
      }),
    ),
  )

test('works a task’s card out again after one change', (context) => measure(context, ROUND, { 'a rename, to its card': cardAgain }))
