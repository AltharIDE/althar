import { execFileSync } from 'node:child_process'

import { makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient, Statement } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { fakeConnectors, HOST, hosted, runtime, until } from './support'

/*
 * Opening a task or the coordinator reads a page of its thread. Every query
 * that read runs has to find its rows by an index: a query that reads a table
 * which grows with use whole, for each item on the page, takes seconds to open
 * a thread in a store with a long history. SQLite plans the same with a few
 * rows as with many, so a small store shows the plan a large one gets.
 */

/** The tables that grow with every item of a thread: never read whole. */
const PER_ITEM = [
  'artifact_links',
  'artifacts',
  'attention_requests',
  'change_log',
  'command_receipts',
  'decisions',
  'permission_requests',
  'record_events',
  'thread_items',
  'turn_deliveries',
  'turn_delivery_inputs',
  'user_inputs',
]

/*
 * Read whole for each task card today, with a few dozen rows in a store of
 * hundreds of tasks: one for each conflict settled, issue drafted or change a
 * task attached.
 */
const FEW = ['conflict_resolutions', 'issue_drafts', 'repository_changes']

/** Any other table grows with tasks and sessions: read whole once at most, never once for each row or each card. */
const checked = (table: string) => !table.startsWith('vocab_') && !FEW.includes(table)

/** The SQL a read runs, with how many times it ran each statement. */
const statementsOf = <A, E, R>(read: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const seen = new Map<string, { readonly params: ReadonlyArray<unknown>; times: number }>()
    yield* read.pipe(
      Effect.provideService(Statement.CurrentTransformer, (statement) => {
        const [text, params] = statement.compile()
        if (/^\s*(SELECT|WITH)\b/i.test(text)) {
          const known = seen.get(text)
          if (known === undefined) seen.set(text, { params, times: 1 })
          else known.times += 1
        }
        return Effect.succeed(statement)
      }),
    )
    return seen
  })

/**
 * A step that reads its table whole: a scan, or an index SQLite builds for the
 * statement by reading it. Not `json_each` over one row's JSON, a virtual table.
 */
const WHOLE = /^(?:SCAN (\w+)\b(?! VIRTUAL TABLE)|SEARCH (\w+) USING AUTOMATIC )/

/** The steps of a statement's plan that read a growing table whole where it costs a store with a long history. */
const scansOf = (text: string, params: ReadonlyArray<unknown>, times: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const plan = yield* sql.unsafe<{ id: number; parent: number; detail: string }>(`EXPLAIN QUERY PLAN ${text}`, params)
    // A plan names a table by its alias where the query gives one; an alias used twice may be either table.
    const aliases = new Map<string, Set<string>>()
    for (const [, table, alias] of text.matchAll(/\b(?:FROM|JOIN)\s+(\w+)\s+(?:AS\s+)?(\w+)/gi))
      aliases.set(alias!, (aliases.get(alias!) ?? new Set()).add(table!))
    const byId = new Map(plan.map((step) => [step.id, step]))
    const loop = (detail: string) => /^(SCAN|SEARCH) /.test(detail)
    // Run once for each row: within a correlated subquery, or a join's inner loop, after the first loop of its level.
    const repeated = (step: { id: number; parent: number; detail: string }): boolean => {
      if (loop(step.detail) && plan.find((other) => other.parent === step.parent && loop(other.detail))?.id !== step.id) return true
      const parent = byId.get(step.parent)
      return parent !== undefined && (parent.detail.startsWith('CORRELATED') || repeated(parent))
    }
    return plan.flatMap((step) => {
      const match = WHOLE.exec(step.detail)
      const name = match?.[1] ?? match?.[2]
      if (name === undefined) return []
      const tables = [...(aliases.get(name) ?? [name])]
      const costly = tables.some((table) => PER_ITEM.includes(table) || (checked(table) && (times > 1 || repeated(step))))
      return costly ? [`${tables.join(' or ')}: ${step.detail}`] : []
    })
  })

const git = (cwd: string, ...args: Array<string>) => execFileSync('git', args, { cwd }).toString().trim()

describe('opening a thread', () => {
  it.live(
    'finds every row it reads by an index, in a task with a run and a long thread, and in the coordinator',
    () => {
      const { working, bare } = hosted()
      const github = makeFakeService({ pushUrl: () => bare })
      github.addRepository(['meridian', 'api'])
      git(working, 'config', 'user.name', 'Fake')
      git(working, 'config', 'user.email', 'fake@althar.test')
      return Effect.gen(function* () {
        const instance = yield* Instance
        const projects = yield* Projects
        const queries = yield* Queries
        const sql = yield* SqlClient.SqlClient
        yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
        const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
        // A task the coordinator plans and runs to its pull request, so its thread has a graph of steps.
        const coordinator = yield* Coordinator
        const coordinatorThread = yield* coordinator.thread(project.projectId)
        const body = 'Add a retry. [coordinator:plan] [lead:finish] [lead:edit] [review:findings]'
        yield* coordinator.say({
          envelope: yield* Runtime.envelope('thread.send', { body }),
          threadId: coordinatorThread,
          body,
          disposition: 'after_current',
        })
        const cards = Effect.map(Effect.orDie(queries.coordinator(project.projectId)), (snapshot) =>
          snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : [])),
        )
        const [ready] = yield* until(cards, (all) => all[0]?.phase === 'ready' && all[0].change !== null, Duration.seconds(30))
        const threadId = (ready ?? assert.fail('no card')).threadId
        // A second card, so the coordinator reads a card more than once.
        yield* projects.createTask({
          envelope: yield* Runtime.envelope('task.create', {}),
          projectId: project.projectId,
          title: 'Answer the review',
        })
        // More items than a page holds, after the round's start, so the page reaches back to it.
        yield* sql`
          WITH RECURSIVE n(k) AS (SELECT 1 UNION ALL SELECT k + 1 FROM n WHERE k < 150)
          INSERT INTO thread_items (id, project_id, thread_id, sequence, kind, content, created_at)
          SELECT 'item_' || lower(hex(randomblob(16))), project_id, thread_id, sequence + k, 'agent_message', '{"text":"More."}', created_at
          FROM n, (SELECT * FROM thread_items WHERE thread_id = ${threadId} ORDER BY sequence DESC LIMIT 1)`

        const reads = new Map<string, { readonly params: ReadonlyArray<unknown>; times: number }>()
        const opens: ReadonlyArray<Effect.Effect<unknown, unknown>> = [
          queries.thread(threadId, { limit: 0 }),
          queries.thread(threadId, {}),
          queries.coordinator(project.projectId),
        ]
        for (const read of opens)
          for (const [text, run] of yield* statementsOf(read)) {
            const known = reads.get(text)
            if (known === undefined) reads.set(text, run)
            else known.times = Math.max(known.times, run.times)
          }
        // The parts of the read that only a task with a run, and a page with earlier items, reach.
        const texts = [...reads.keys()].join('\n')
        assert.include(texts, 'turn_deliveries')
        assert.include(texts, 'execution_graph_revisions')
        assert.match(texts, /i\.sequence <= \?/)
        assert.isTrue([...reads.values()].some((run) => run.times > 1))

        const scans = []
        for (const [text, { params, times }] of reads) {
          const found = yield* scansOf(text, params, times)
          if (found.length > 0) scans.push({ scans: found, times, query: text.replace(/\s+/g, ' ').slice(0, 300) })
        }
        assert.deepStrictEqual(scans, [])
      }).pipe(
        Effect.provide(
          Queries.layer.pipe(
            Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.millis(100) })),
          ),
        ),
      )
    },
    60_000,
  )
})
