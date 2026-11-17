import { execFileSync } from 'node:child_process'

import { makeFakeService } from '@althar/connectors/testing'
import { assert } from '@effect/vitest'
import { Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../../src/Coordinator'
import { Queries } from '../../src/Queries'
import * as Runtime from '../../src/Runtime'
import { Sessions } from '../../src/Sessions'
import { hosted, until } from '../support'

/*
 * How the responsiveness run (responsiveness.test.ts) and the nightly benches
 * (tests/responsiveness.bench.ts) make a store of the person's shape: tasks
 * led to a draft pull request on a fake GitHub, a thread as long as their
 * longest, a coordinator's thread of their length with its cards, tasks long
 * settled and the change feed's history, written straight into the store
 * where making each the way the person does would take hours.
 */

export const git = (cwd: string, ...args: Array<string>) => execFileSync('git', args, { cwd }).toString().trim()

/**
 * A repository on a fake GitHub whose every call waits as long as `hostMs` says at the time, as GitHub's took on
 * average in the person's log: none while the store is made, so making it takes less long.
 */
export const onGitHub = (hostMs: () => number) => {
  const { working, bare } = hosted()
  const github = makeFakeService({
    pushUrl: () => bare,
    waitsFor: () => (hostMs() > 0 ? Effect.sleep(Duration.millis(hostMs())) : Effect.void),
  })
  github.addRepository(['meridian', 'api'])
  git(working, 'config', 'user.name', 'Fake')
  git(working, 'config', 'user.email', 'fake@althar.test')
  return { working, bare, github }
}

/** The task cards in a project's coordinator thread, as its latest page shows them. */
export const cards = (projectId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const snapshot = yield* Effect.orDie(queries.coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

export const idle = (threadId: string) =>
  until(
    Effect.flatMap(Sessions, (sessions) => sessions.busy(threadId)),
    (busy) => !busy,
  )

export interface Made {
  readonly taskId: string
  readonly threadId: string
  readonly path: string
  readonly branch: string
}

/**
 * Tasks planned by the coordinator, led to a draft pull request and reviewed: ready, as most open tasks stand. With
 * `nothing`, led to say they built nothing, so Done settles them as they are.
 */
export const ready = (projectId: string, count: number, nothing = false) =>
  Effect.gen(function* () {
    const coordinator = yield* Coordinator
    const threadId = yield* coordinator.thread(projectId)
    const made: Array<Made> = []
    const sql = yield* SqlClient.SqlClient
    const markers = nothing ? '[lead:finish] [lead:nothing]' : '[lead:finish] [lead:edit] [review:pass]'
    // Those ready already, made by an earlier call: none of them is one of these.
    const before = new Set((yield* cards(projectId)).flatMap((card) => (card.phase === 'ready' ? [card.taskId] : [])))
    const fresh = (card: { readonly taskId: string; readonly phase: string; readonly change: unknown }) =>
      card.phase === 'ready' && (nothing || card.change !== null) && !before.has(card.taskId)
    for (let index = 0; index < count; index += 1) {
      const body = `Add retry number ${before.size + index + 1}. [coordinator:plan] ${markers}`
      yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
      const all = yield* until(cards(projectId), (shown) => shown.filter(fresh).length > index, 'the task ready')
      const card = all.find((one) => fresh(one) && !made.some((was) => was.taskId === one.taskId))
      if (card === undefined) return assert.fail('no card')
      yield* idle(card.threadId)
      const [workspace] = yield* sql<{ path: string; branch: string }>`SELECT path, branch FROM workspaces WHERE task_id = ${card.taskId}`
      made.push({ taskId: card.taskId, threadId: card.threadId, path: workspace?.path ?? '', branch: workspace?.branch ?? '' })
    }
    return made
  })

/** A thread as long as the person's longest: its items copied to `items` and its turns to `turns`, each new. */
export const lengthen = (threadId: string, items: number, turns: number) =>
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

/**
 * A coordinator's thread as long as the person's: its items copied to `items`, a task's card among them as often as the
 * coordinator made one in the thread so far, as it adds one for each task it plans (cards.ts), each of one of `tasks`
 * in turn. How often, as one item in so many.
 */
export const lengthenCoordinator = (projectId: string, items: number, tasks: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const threadId = yield* (yield* Coordinator).thread(projectId)
    const [made] = yield* sql<{ all: number; cards: number }>`
      SELECT count(*) AS "all", sum(kind = 'task') AS cards FROM thread_items WHERE thread_id = ${threadId}`
    const cardEvery = Math.max(1, Math.round((made?.all ?? 1) / Math.max(1, made?.cards ?? 1)))
    yield* sql.withTransaction(
      Effect.gen(function* () {
        const [{ top } = { top: 0 }] = yield* sql<{
          top: number
        }>`SELECT max(sequence) AS top FROM thread_items WHERE thread_id = ${threadId}`
        const [card] = yield* sql<{ id: string }>`SELECT id FROM thread_items WHERE thread_id = ${threadId} AND kind = 'task' LIMIT 1`
        const said = yield* sql<{ id: string }>`
          SELECT id FROM thread_items WHERE thread_id = ${threadId} AND kind IN ('tool_call', 'agent_message', 'agent_thought')
          ORDER BY sequence`
        for (let index = 0; index < items; index += 1) {
          const isCard = card !== undefined && tasks.length > 0 && index % cardEvery === 0
          const from = isCard ? card : said[index % Math.max(1, said.length)]
          yield* sql.unsafe(
            `INSERT INTO thread_items (id, project_id, thread_id, sequence, kind, user_input_id, delivery_id, provider_session_id, tool_call_id, content, created_at, revision)
             SELECT 'item_' || lower(hex(randomblob(16))), project_id, thread_id, ?, kind, NULL, delivery_id, provider_session_id,
              CASE WHEN tool_call_id IS NULL THEN NULL ELSE tool_call_id || '-c' || ? END,
              CASE WHEN kind = 'task' THEN json_set(content, '$.taskId', ?) ELSE content END, created_at, revision
             FROM thread_items WHERE id = ?`,
            [top + index + 1, index, tasks[Math.floor(index / cardEvery) % Math.max(1, tasks.length)] ?? '', from?.id ?? ''],
          )
        }
      }),
    )
    return { threadId, cardEvery }
  })

/**
 * Tasks long finished, as most of the person's are: copies of one of the project's tasks and its thread, done and
 * settled, written straight into the store, as making each through `createTask` makes its worktree too.
 */
export const settled = (from: { readonly taskId: string }, count: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const columns = (table: string) =>
      Effect.map(sql<{ name: string }>`SELECT name FROM pragma_table_info(${table})`, (rows) => rows.map((row) => row.name))
    const tasks = yield* columns('tasks')
    const threads = yield* columns('threads')
    const set = (all: ReadonlyArray<string>, own: Readonly<Record<string, string>>) => all.map((name) => own[name] ?? name).join(', ')
    const made: Array<string> = []
    yield* sql.withTransaction(
      Effect.gen(function* () {
        for (let index = 0; index < count; index += 1) {
          const taskId = `task_${(index + 1).toString(16).padStart(32, '0')}`
          const threadId = `thr_${(index + 1).toString(16).padStart(32, '0')}`
          const given: Readonly<Record<string, string>> = { id: taskId, slug: `old-task-${index + 1}`, title: `Old task ${index + 1}` }
          yield* sql.unsafe(
            `INSERT INTO tasks (${tasks.join(', ')}) SELECT ${set(tasks, {
              id: '?',
              slug: '?',
              title: '?',
              state: "'done'",
              settled_at: "'2026-10-01T09:00:00.000Z'",
              parent_task_id: 'NULL',
            })} FROM tasks WHERE id = ?`,
            [...tasks.flatMap((name) => (given[name] === undefined ? [] : [given[name]])), from.taskId],
          )
          yield* sql.unsafe(
            `INSERT INTO threads (${threads.join(', ')}) SELECT ${set(threads, { id: '?', task_id: '?' })} FROM threads WHERE task_id = ? AND kind = 'task'`,
            [...threads.flatMap((name) => (name === 'id' ? [threadId] : name === 'task_id' ? [taskId] : [])), from.taskId],
          )
          made.push(taskId)
        }
      }),
    )
    return made
  })

/** Rows the change feed has carried, as many as the person's store has had. */
export const history = (rows: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql.unsafe(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
       INSERT INTO change_log (project_id, aggregate_type, aggregate_id, aggregate_revision, changed_at)
       SELECT NULL, 'thread_item', 'item_' || printf('%032x', i), 1, '2026-10-01T09:00:00.000Z' FROM n`,
      [rows],
    )
  })
