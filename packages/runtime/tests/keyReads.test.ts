import { execFileSync } from 'node:child_process'

import { makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer, Option, Tracer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { fakeConnectors, HOST, hosted, runtime, until } from './support'

/*
 * What the person waits on stays quick however long Althar has been used
 * (docs/decisions, "The window answers while the computer is busy"): the
 * board, the home and a task's view read the store on every change an agent
 * makes, so none of their statements may go through every row of a table
 * that grows with each turn; one that did (the reply each card reads) took a
 * third of a second a read on the person's store. And Ship answers once its
 * run is admitted, while its reviewer's agent is still starting.
 */

/** Tables that grow with every turn, every event, every change: a key read finds its rows by an index, never by reading them all. */
const GROWING = [
  'thread_items',
  'turn_deliveries',
  'record_events',
  'change_log',
  'permission_requests',
  'decisions',
  'artifacts',
  'artifact_links',
]

/** Words that follow a table's name in a statement without naming it again. */
const KEYWORDS = new Set([
  'ON',
  'WHERE',
  'JOIN',
  'LEFT',
  'INNER',
  'CROSS',
  'USING',
  'GROUP',
  'ORDER',
  'LIMIT',
  'UNION',
  'AS',
  'AND',
  'OR',
  'NATURAL',
  'WINDOW',
  'HAVING',
])

/** Every statement run while it's on, by its text. */
const statements = () => {
  const seen = new Set<string>()
  const ever = new Set<string>()
  let on = false
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options)
      const end = span.end.bind(span)
      span.end = (endTime, exit) => {
        end(endTime, exit)
        const text = span.attributes.get('db.query.text')
        if (typeof text === 'string') ever.add(text)
        if (on && typeof text === 'string') seen.add(text)
      }
      return span
    },
  })
  return {
    layer: Layer.succeed(Tracer.Tracer, tracer),
    /** Every statement run since `afresh`, whatever ran it. */
    all: () => [...ever],
    /** From now on: what opening the store ran, its migrations, isn't what the runtime reads as it works. */
    afresh: Effect.sync(() => ever.clear()),
    during: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          seen.clear()
          on = true
        }),
        () => effect,
        () => Effect.sync(() => void (on = false)),
      ).pipe(Effect.map(() => [...seen])),
  }
}

/** Where a statement reads every row of a growing table, by SQLite's plan for it: none for one that finds its rows. */
const scansIn = (text: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    if (!/^\s*(SELECT|WITH)\b/i.test(text) && !/^\s*--/.test(text)) return []
    const plan = yield* sql.unsafe<{ detail: string }>(`EXPLAIN QUERY PLAN ${text}`).pipe(Effect.orElseSucceed(() => []))
    // The plan names a table by what the statement calls it: `SCAN i` for `FROM thread_items i`.
    const aliases = new Map<string, string>()
    for (const [, table, alias] of text.matchAll(/\b(?:FROM|JOIN)\s+(\w+)(?:\s+(?:AS\s+)?(\w+))?/gi))
      if (table !== undefined) {
        aliases.set(table, table)
        if (alias !== undefined && !KEYWORDS.has(alias.toUpperCase())) aliases.set(alias, table)
      }
    // A scan of a partial index reads only the rows it keeps, such as the turns under way: bounded, however long Althar is used.
    const partial = new Set(
      (yield* sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'index' AND sql LIKE '% WHERE %'`).map((row) => row.name),
    )
    return plan.flatMap((row) => {
      const scanned = /^SCAN (\w+)/.exec(row.detail)?.[1]
      const by = /USING (?:COVERING )?INDEX (\w+)/.exec(row.detail)?.[1]
      const table = scanned === undefined ? undefined : (aliases.get(scanned) ?? scanned)
      return table === undefined || !GROWING.includes(table) || (by !== undefined && partial.has(by))
        ? []
        : [`${row.detail} (${table})\n  in ${text.replace(/\s+/g, ' ').slice(0, 300)}`]
    })
  })

const git = (cwd: string, ...args: Array<string>) => execFileSync('git', args, { cwd }).toString().trim()

describe('the reads the person waits on', () => {
  it.live('find their rows by an index, never by reading every turn, item or event', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    git(working, 'config', 'user.name', 'Fake')
    git(working, 'config', 'user.email', 'fake@althar.test')
    const traced = statements()
    return Effect.gen(function* () {
      yield* traced.afresh
      const connections = yield* Connections
      const instance = yield* Instance
      yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
      const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const coordinator = yield* Coordinator
      const queries = yield* Queries
      const threadId = yield* coordinator.thread(project.projectId)
      const body = 'Add a retry. [coordinator:plan] [lead:finish] [lead:edit] [review:pass]'
      yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
      const shown = yield* until(
        Effect.map(Effect.orDie(queries.coordinator(project.projectId)), (snapshot) =>
          snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : [])),
        ),
        (cards) => cards[0]?.phase === 'ready' && cards[0].change !== null,
      )
      const card = shown[0] ?? assert.fail('no card')
      const read = [
        ...traced.all(),
        ...(yield* traced.during(queries.board(project.projectId))),
        ...(yield* traced.during(queries.home())),
        ...(yield* traced.during(queries.thread(card.threadId, { fresh: true }))),
        ...(yield* traced.during(queries.coordinator(project.projectId))),
      ]
      assert.isAbove(read.length, 20)
      const scans = (yield* Effect.forEach([...new Set(read)], scansIn)).flat()
      assert.deepStrictEqual(scans, [])
    }).pipe(
      Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }) })))),
      Effect.provide(traced.layer),
    )
  })
})

describe('Ship', () => {
  it.live("answers once its run is admitted, while its reviewer's agent is still starting", () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    git(working, 'config', 'user.name', 'Fake')
    git(working, 'config', 'user.email', 'fake@althar.test')
    // The reviewer's agent starts at once, until the test holds it.
    let start: Promise<void> = Promise.resolve()
    let let_go = () => {}
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
      const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const coordinator = yield* Coordinator
      const queries = yield* Queries
      const sessions = yield* Sessions
      const threadId = yield* coordinator.thread(project.projectId)
      const body = 'Add a retry. [coordinator:plan] [lead:finish] [lead:edit] [review:pass]'
      yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
      const shown = yield* until(
        Effect.map(Effect.orDie(queries.coordinator(project.projectId)), (snapshot) =>
          snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : [])),
        ),
        (cards) => cards[0]?.phase === 'ready' && cards[0].change !== null,
      )
      const card = shown[0] ?? assert.fail('no card')
      yield* until(sessions.busy(card.threadId), (busy) => !busy)
      // A tweak the lead commits in a turn, held for Ship.
      const tweak = 'Make it retry twice. tidy pls [lead:commit]'
      const live = Option.isSome(yield* sessions.running(card.threadId))
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', { threadId: card.threadId, body: tweak }),
        threadId: card.threadId,
        body: tweak,
      })
      if (!live) yield* Effect.ignore(sessions.startLast(card.threadId))
      yield* until(
        sql<{ heldAt: string | null }>`SELECT held_at FROM workspaces WHERE task_id = ${card.taskId}`,
        (rows) => rows[0]?.heldAt != null,
      )
      yield* until(sessions.busy(card.threadId), (busy) => !busy)
      const [{ branch } = { branch: '' }] = yield* sql<{ branch: string }>`SELECT branch FROM workspaces WHERE task_id = ${card.taskId}`
      const before = git(bare, 'rev-parse', branch)

      // Its reviewer from the plan stopped, the Ship's review starts one afresh; held at its start, it can't be what the press waits on.
      const [reviewer] = yield* sql<{
        id: string
      }>`SELECT id FROM threads WHERE task_id = ${card.taskId} AND kind = 'step' AND node_key = 'review'`
      if (reviewer !== undefined && Option.isSome(yield* sessions.running(reviewer.id))) yield* sessions.stop(reviewer.id)
      if (reviewer !== undefined) yield* until(sessions.running(reviewer.id), Option.isNone)
      start = new Promise<void>((resolve) => (let_go = resolve))
      yield* (yield* Runs).ship({ envelope: yield* Runtime.envelope('task.ship', { taskId: card.taskId }), taskId: card.taskId })
      const [run] = yield* sql<{
        state: string
      }>`SELECT state FROM runs WHERE task_id = ${card.taskId} ORDER BY created_at DESC, rowid DESC LIMIT 1`
      assert.strictEqual(run?.state, 'running')
      assert.strictEqual(git(bare, 'rev-parse', branch), before)
      // Let go, it reviews and sends the commits up, as it always did.
      let_go()
      yield* until(
        Effect.sync(() => git(bare, 'rev-parse', branch)),
        (there) => there !== before,
      )
    }).pipe(
      Effect.provide(
        Queries.layer.pipe(
          Layer.provideMerge(
            runtime(':memory:', {}, { connectors: fakeConnectors({ github }), each: { codex: { beforeNewSession: () => start } } }),
          ),
        ),
      ),
    )
  })
})
