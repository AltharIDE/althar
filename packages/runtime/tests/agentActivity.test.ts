import type { ActorId, ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../src/Coordinator'
import { itemOf } from '../src/Queries'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { INTERRUPTED, Sessions } from '../src/Sessions'
import { recorder, SUMMARY_KEPT } from '../src/threads'
import { items, notices, repository, runtime, task, turns, until } from './support'

/*
 * What an agent does beyond the repository, as the thread keeps it and the
 * window reads it: a web search and a page it read, a sub-agent it started,
 * with the calls it made under it and what it reported back, its context
 * compacting, and the person stopping its turn.
 */

const place = Effect.gen(function* () {
  const sessions = yield* Sessions
  const { project, task: created } = yield* task()
  const sessionId = yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
  yield* until(turns(created.threadId), (rows) => rows[0]?.state === 'completed')
  return { projectId: project.projectId as ProjectId, threadId: created.threadId, sessionId, folders: [] }
})

const row = (threadId: string, toolCallId: string) =>
  Effect.map(items(threadId), (rows) => rows.findLast((one) => one.toolCallId === toolCallId))

/** A stored item as the window gets it. */
const read = (kind: string, content: Record<string, unknown> | undefined) =>
  itemOf({
    id: 'i1',
    sequence: 1,
    kind,
    content: JSON.stringify(content),
    agentId: 'codex',
    inputState: null,
    disposition: null,
    decision: null,
    createdAt: '2026-11-08T10:00:00.000Z',
  })?.content as Record<string, unknown> | undefined

describe('what an agent does beyond the repository, in the thread', () => {
  it.live('keeps a web search by its query, and a page by its address', () =>
    Effect.gen(function* () {
      const where = yield* place
      const record = recorder(where)
      // Claude Code says its query only once it has all of its input.
      yield* record.record({
        _tag: 'ToolCall',
        toolCallId: 'search',
        title: 'Web search',
        kind: 'fetch',
        status: 'pending',
        web: { action: 'search', query: '' },
      })
      yield* record.record({
        _tag: 'ToolCallUpdate',
        toolCallId: 'search',
        status: 'completed',
        rawInput: { query: 'acp compaction' },
        web: { action: 'search', query: 'acp compaction' },
      })
      const search = yield* row(where.threadId, 'search')
      assert.deepStrictEqual(read('tool_call', search?.content)?.['web'], { action: 'search', query: 'acp compaction' })
      // What it searched for isn't kept as its input: only as what the thread shows.
      assert.deepStrictEqual(search?.content['rawInput'], {})
      yield* record.record({
        _tag: 'ToolCall',
        toolCallId: 'fetch',
        title: 'Fetch https://effect.website/docs',
        kind: 'fetch',
        status: 'completed',
        web: { action: 'fetch', url: 'https://effect.website/docs' },
      })
      assert.deepStrictEqual(read('tool_call', (yield* row(where.threadId, 'fetch'))?.content)?.['web'], {
        action: 'fetch',
        url: 'https://effect.website/docs',
      })
    }).pipe(Effect.provide(runtime())),
  )

  it.live('lets what a sub-agent was asked replace the label that stood in for it, and a search keep its query', () =>
    Effect.gen(function* () {
      const where = yield* place
      const record = recorder(where)
      const subAgent = (toolCallId: string) =>
        Effect.map(
          row(where.threadId, toolCallId),
          (one) => read('tool_call', one?.content)?.['subAgent'] as Record<string, unknown> | undefined,
        )
      // Claude Code's first call, before its input streamed in, then the update with it.
      yield* record.record({
        _tag: 'ToolCall',
        toolCallId: 'task',
        title: 'Task',
        kind: 'think',
        status: 'pending',
        subAgent: { label: 'Task', guessed: true },
      })
      assert.strictEqual((yield* subAgent('task'))?.['label'], 'Task')
      yield* record.record({
        _tag: 'ToolCallUpdate',
        toolCallId: 'task',
        status: 'in_progress',
        subAgent: { label: 'Find the readers', type: 'Explore' },
      })
      assert.deepStrictEqual(yield* subAgent('task'), { label: 'Find the readers', type: 'Explore' })
      // A web search said with its query, then by an update with none.
      yield* record.record({
        _tag: 'ToolCall',
        toolCallId: 'search',
        title: 'Search',
        kind: 'fetch',
        status: 'pending',
        web: { action: 'search', query: 'effect schema' },
      })
      yield* record.record({ _tag: 'ToolCallUpdate', toolCallId: 'search', status: 'completed', web: { action: 'search', query: '' } })
      assert.deepStrictEqual(read('tool_call', (yield* row(where.threadId, 'search'))?.content)?.['web'], {
        action: 'search',
        query: 'effect schema',
      })
    }).pipe(Effect.provide(runtime())),
  )

  it.live('keeps a fetch’s title without the query or fragment of the address it reads, refused or failed too', () =>
    Effect.gen(function* () {
      const where = yield* place
      const record = recorder(where)
      // Claude Code's WebFetch is titled by the address it reads.
      yield* record.record({
        _tag: 'ToolCall',
        toolCallId: 'secret',
        title: 'Fetch https://example.com/doc?token=secret#private',
        kind: 'fetch',
        status: 'pending',
        web: { action: 'fetch', url: 'https://example.com/doc' },
      })
      // Its updates after say no web call of their own, and fail: the title stays without the token.
      yield* record.record({
        _tag: 'ToolCallUpdate',
        toolCallId: 'secret',
        status: 'failed',
        title: 'Fetch https://example.com/doc?token=secret#private',
      })
      const stored = yield* row(where.threadId, 'secret')
      assert.strictEqual(stored?.content['title'], 'Fetch https://example.com/doc')
      assert.notInclude(JSON.stringify(stored?.content), 'secret#')
      assert.notInclude(JSON.stringify(stored?.content), 'token=')
      // A call that isn't a web call keeps its title as it said it.
      yield* record.record({
        _tag: 'ToolCall',
        toolCallId: 'curl',
        title: 'curl https://example.com/?q=1',
        kind: 'execute',
        status: 'completed',
      })
      assert.strictEqual((yield* row(where.threadId, 'curl'))?.content['title'], 'curl https://example.com/?q=1')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('puts a call that came before its sub-agent under it once the sub-agent comes, across a restart too', () =>
    Effect.gen(function* () {
      const where = yield* place
      const first = recorder(where)
      const parentOf = (toolCallId: string) =>
        Effect.map(row(where.threadId, toolCallId), (one) => read('tool_call', one?.content)?.['parent'])
      // The child is heard of first, then updated without saying its sub-agent again.
      yield* first.record({
        _tag: 'ToolCall',
        toolCallId: 'early',
        title: 'Read a.ts',
        kind: 'read',
        status: 'in_progress',
        parent: 'late',
      })
      yield* first.record({ _tag: 'ToolCallUpdate', toolCallId: 'early', status: 'completed' })
      assert.isUndefined(yield* parentOf('early'))
      assert.strictEqual((yield* row(where.threadId, 'early'))?.content['parentCall'], 'late')
      // Althar restarted between them: the recorder that hears the sub-agent is a new one.
      const second = recorder(where)
      yield* second.record({
        _tag: 'ToolCall',
        toolCallId: 'late',
        title: 'Find the readers',
        kind: 'think',
        status: 'in_progress',
        subAgent: { label: 'Find the readers' },
      })
      const parent = yield* row(where.threadId, 'late')
      const ids = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{
          id: string
        }>`SELECT id FROM thread_items WHERE provider_session_id = ${where.sessionId} AND tool_call_id = 'late'`
      })
      assert.isDefined(parent)
      assert.strictEqual(yield* parentOf('early'), ids[0]?.id)
      assert.isUndefined((yield* row(where.threadId, 'early'))?.content['parentCall'])
      // A later update of the child keeps it there.
      yield* second.record({ _tag: 'ToolCallUpdate', toolCallId: 'early', status: 'completed', parent: 'late' })
      assert.strictEqual(yield* parentOf('early'), ids[0]?.id)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('keeps a sub-agent by what it was asked, its calls under it, and the start of what it reported back', () =>
    Effect.gen(function* () {
      const where = yield* place
      const record = recorder(where)
      yield* record.record({
        _tag: 'ToolCall',
        toolCallId: 'task',
        title: 'Find the readers',
        kind: 'think',
        status: 'in_progress',
        subAgent: { label: 'Find the readers', type: 'Explore' },
      })
      yield* record.record({
        _tag: 'ToolCall',
        toolCallId: 'child',
        title: 'Read src/a.ts',
        kind: 'read',
        status: 'completed',
        parent: 'task',
      })
      // A call whose sub-agent isn't in the thread stands on its own.
      yield* record.record({ _tag: 'ToolCall', toolCallId: 'orphan', title: 'Read b', kind: 'read', status: 'completed', parent: 'gone' })
      yield* record.record({
        _tag: 'ToolCallUpdate',
        toolCallId: 'task',
        status: 'completed',
        content: [{ _tag: 'Text', text: `Two readers: Queries and threads. ${'More. '.repeat(200)}` }],
      })
      const started = yield* row(where.threadId, 'task')
      const kept = read('tool_call', started?.content)?.['subAgent'] as Record<string, unknown> | undefined
      assert.strictEqual(kept?.['label'], 'Find the readers')
      assert.strictEqual(kept?.['type'], 'Explore')
      assert.isTrue(String(kept?.['said']).startsWith('Two readers: Queries and threads.'))
      assert.strictEqual(String(kept?.['said']).length, 600)
      // An update that says less of what it was asked, as Claude Code's after the first, leaves what it was asked as it was.
      yield* record.record({
        _tag: 'ToolCallUpdate',
        toolCallId: 'task',
        status: 'completed',
        subAgent: { label: 'Sub-agent', guessed: true },
      })
      const after = read('tool_call', (yield* row(where.threadId, 'task'))?.content)?.['subAgent'] as Record<string, unknown> | undefined
      assert.strictEqual(after?.['label'], 'Find the readers')
      assert.notProperty(after, 'guessed')
      const all = yield* items(where.threadId)
      const parentItem = all.findIndex((one) => one.toolCallId === 'task')
      const ids = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ id: string; toolCallId: string | null }>`
          SELECT id, tool_call_id FROM thread_items WHERE thread_id = ${where.threadId} ORDER BY sequence`
      })
      const childContent = read('tool_call', (yield* row(where.threadId, 'child'))?.content)
      assert.strictEqual(childContent?.['parent'], ids[parentItem]?.id)
      assert.isUndefined(read('tool_call', (yield* row(where.threadId, 'orphan'))?.content)?.['parent'])
    }).pipe(Effect.provide(runtime())),
  )

  it.live('keeps a compaction as one line as it goes, with its summary, whole or in pieces, and why it failed', () =>
    Effect.gen(function* () {
      const where = yield* place
      const record = recorder(where)
      const compacted = () => Effect.map(notices(where.threadId), (said) => said.filter((one) => one['role'] === 'compacted'))
      yield* record.record({ _tag: 'CompactionSummary', compactionId: 'c1', text: 'We were ' })
      yield* record.record({ _tag: 'CompactionSummary', compactionId: 'c1', text: 'fixing it.' })
      assert.strictEqual(record.compaction(), 'in_progress')
      yield* record.record({ _tag: 'Compaction', compactionId: 'c1', status: 'completed' })
      yield* record.describeCompaction('412k → 38k tokens')
      const [first] = yield* compacted()
      assert.deepStrictEqual(read('notice', first)?.['compaction'], { status: 'completed', summary: 'We were fixing it.' })
      assert.strictEqual(read('notice', first)?.['description'], '412k → 38k tokens')
      assert.strictEqual(read('notice', first)?.['role'], 'compacted')

      // A whole summary replaces what came in pieces, and is kept to its budget.
      yield* record.record({ _tag: 'Compaction', compactionId: 'c2', status: 'in_progress' })
      yield* record.record({ _tag: 'Compaction', compactionId: 'c2', status: 'completed', summary: 'x'.repeat(SUMMARY_KEPT + 10) })
      const second = (yield* compacted())[1]
      assert.strictEqual(
        String((read('notice', second)?.['compaction'] as Record<string, unknown> | undefined)?.['summary']).length,
        SUMMARY_KEPT,
      )

      yield* record.record({ _tag: 'Compaction', compactionId: 'c3', status: 'failed', error: 'Prompt too long' })
      const third = (yield* compacted())[2]
      assert.deepStrictEqual(read('notice', third)?.['compaction'], { status: 'failed', error: 'Prompt too long' })
      assert.strictEqual(read('notice', third)?.['severity'], 'warning')
      assert.strictEqual(record.compaction(), 'failed')
      assert.lengthOf(yield* compacted(), 3)

      // One its turn ended on without saying how it went is settled with the turn, with what of its summary came.
      yield* record.record({ _tag: 'Compaction', compactionId: 'c4', status: 'in_progress' })
      yield* record.record({ _tag: 'CompactionSummary', compactionId: 'c4', text: 'Half of it.' })
      yield* record.settleCompaction('cancelled')
      const fourth = (yield* compacted())[3]
      assert.deepStrictEqual(read('notice', fourth)?.['compaction'], { status: 'cancelled', summary: 'Half of it.' })
      assert.strictEqual(record.compaction(), 'cancelled')
      // One that said how it went stays as it said.
      yield* record.settleCompaction('completed')
      assert.strictEqual(record.compaction(), 'cancelled')
    }).pipe(Effect.provide(runtime())),
  )

  it('reads a kept compaction with a status it doesn’t know as none, and a page that isn’t on the web as no page', () => {
    assert.isUndefined(
      read('notice', { source: 'runtime', title: 'x', role: 'compacted', compaction: { status: 'paused' } })?.['compaction'],
    )
    assert.isUndefined(read('tool_call', { title: 'x', web: { action: 'fetch', url: 'javascript:alert(1)' } })?.['web'])
    assert.isUndefined(read('tool_call', { title: 'x', subAgent: { label: '' } })?.['subAgent'])
  })
})

const opened = Effect.gen(function* () {
  const projects = yield* Projects
  const coordinator = yield* Coordinator
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  yield* coordinator.thread(project.projectId)
  return project.projectId as ProjectId
})

/** A task whose lead, Codex, works until it is stopped. */
const waiting = Effect.gen(function* () {
  const projects = yield* Projects
  const plans = yield* Plans
  const projectId = yield* opened
  const created = yield* projects.createTask({
    envelope: yield* Runtime.envelope('task.create', { title: 'Cut short' }),
    projectId,
    title: 'Cut short',
    description: 'Work on it. [lead:wait]',
    draft: true,
  })
  const sql = yield* SqlClient.SqlClient
  const [person] = yield* sql<{ id: string }>`SELECT id FROM actors WHERE kind = 'person'`
  const actor = (person?.id ?? '') as ActorId
  const planId = yield* plans.propose({
    projectId,
    taskId: created.taskId,
    steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
    reason: null,
    actorId: actor,
    end: null,
    held: true,
  })
  yield* plans.start(planId, actor)
  return created
})

const runningTurn = (threadId: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    yield* until(
      Effect.map(sessions.running(threadId), (running) => (Option.isSome(running) && running.value.turnRunning ? [running] : [])),
      (rows) => rows.length === 1,
    )
  })

describe('a turn the person stops', () => {
  it.live('says so where it stopped; one Althar stops says nothing of the person', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const created = yield* waiting
      yield* runningTurn(created.threadId)
      yield* sessions.interrupt(created.threadId, 'person')
      const said = yield* until(notices(created.threadId), (rows) => rows.some((one) => one['role'] === 'interrupted'))
      const line = said.find((one) => one['role'] === 'interrupted')
      assert.strictEqual(line?.['title'], INTERRUPTED)
      assert.strictEqual(line?.['source'], 'runtime')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('says nothing of the person where Althar stopped it', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const created = yield* waiting
      yield* runningTurn(created.threadId)
      yield* sessions.interrupt(created.threadId)
      yield* until(turns(created.threadId), (rows) => rows.some((one) => one.state === 'interrupted'))
      assert.isFalse((yield* notices(created.threadId)).some((one) => one['role'] === 'interrupted'))
    }).pipe(Effect.provide(runtime())),
  )
})
