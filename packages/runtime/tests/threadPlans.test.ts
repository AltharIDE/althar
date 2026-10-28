import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient, Statement } from 'effect/sql'

import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { hosted, runtime } from './support'

/*
 * Opening a task or the coordinator reads a page of its thread. Every query
 * that read runs has to find its rows by an index: a query that scans a table
 * which grows with use reads it whole for each item on the page, and a store
 * with a long history takes seconds to open a thread. SQLite plans the same
 * with a few rows as with many, so a small store shows the plan a large one
 * gets.
 */

/** The tables that grow with every item of a thread: never read whole. */
const PER_ITEM = [
  'attention_requests',
  'decisions',
  'permission_requests',
  'record_events',
  'thread_items',
  'turn_deliveries',
  'user_inputs',
]
/** The tables that grow with every task and session: read whole once at most, never once for each row. */
const PER_TASK = ['node_attempts', 'provider_sessions', 'tasks', 'threads']

/** The SQL a read runs, each statement once. */
const statementsOf = <A, E, R>(read: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const seen = new Map<string, ReadonlyArray<unknown>>()
    yield* read.pipe(
      Effect.provideService(Statement.CurrentTransformer, (statement) => {
        const [text, params] = statement.compile()
        if (/^\s*SELECT|^\s*WITH/i.test(text)) seen.set(text, params)
        return Effect.succeed(statement)
      }),
    )
    return [...seen]
  })

/** The table a plan's step reads whole, by its name or its alias in the query. */
const scanned = (detail: string, aliases: ReadonlyMap<string, string>) => {
  const name = /^SCAN (\w+)/.exec(detail)?.[1]
  return name === undefined ? undefined : (aliases.get(name) ?? name)
}

/** The steps of a statement's plan that read a growing table whole, where they cost a store with a long history. */
const scansOf = (text: string, params: ReadonlyArray<unknown>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const plan = yield* sql.unsafe<{ id: number; parent: number; detail: string }>(`EXPLAIN QUERY PLAN ${text}`, params)
    const aliases = new Map([...text.matchAll(/\b(?:FROM|JOIN)\s+(\w+)\s+(?:AS\s+)?(\w+)/gi)].map(([, table, alias]) => [alias!, table!]))
    const byId = new Map(plan.map((step) => [step.id, step]))
    // Run once for each row: within a correlated subquery, or a join's inner loop, after the first loop of its level.
    const repeated = (step: { id: number; parent: number }): boolean => {
      const siblings = plan.filter((other) => other.parent === step.parent && /^(SCAN|SEARCH) /.test(other.detail))
      if (siblings.length > 0 && siblings[0]!.id !== step.id && /^(SCAN|SEARCH) /.test(byId.get(step.id)?.detail ?? '')) return true
      const parent = byId.get(step.parent)
      return parent !== undefined && (parent.detail.startsWith('CORRELATED') || repeated(parent))
    }
    return plan.flatMap((step) => {
      const table = scanned(step.detail, aliases)
      if (table === undefined) return []
      return PER_ITEM.includes(table) || (PER_TASK.includes(table) && repeated(step)) ? [`${table}: ${step.detail}`] : []
    })
  })

describe('opening a thread', () => {
  it.live('finds every row it reads by an index, in a task and in the coordinator', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const queries = yield* Queries
      const opened = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: hosted().working })
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: opened.projectId,
        title: 'Answer the review',
      })
      const reads = [
        ...(yield* statementsOf(queries.thread(task.threadId, { limit: 0 }))),
        ...(yield* statementsOf(queries.thread(task.threadId, {}))),
        ...(yield* statementsOf(queries.coordinator(opened.projectId))),
      ]
      assert.isAbove(reads.length, 5)
      const scans = []
      for (const [text, params] of reads) {
        const found = yield* scansOf(text, params)
        if (found.length > 0) scans.push({ scans: found, query: text.replace(/\s+/g, ' ').slice(0, 300) })
      }
      assert.deepStrictEqual(scans, [])
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:'))))),
  )
})
