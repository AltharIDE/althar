import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'
import { TestClock } from 'effect/testing'
import { Ids, newId, type ProjectId } from '@althar/domain'

import { findDocuments, updateFinder } from '../src/finderIndex'
import { Projects } from '../src/Projects'
import { timestamp } from '../src/records'
import * as Runtime from '../src/Runtime'
import { addItem } from '../src/threads'
import { repository, runtime } from './support'

const drain = Effect.gen(function* () {
  while (yield* updateFinder()) yield* Effect.yieldNow
})

describe('the search index', () => {
  it.effect('finds bounded, project-scoped public text and follows edits, undo, and archive', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const sql = yield* SqlClient.SqlClient
      const projectId = (yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })).projectId
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId,
        title: 'Café payment',
        description: 'Payment recovery',
      })
      const [thread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${task.taskId}`
      const address = { projectId: projectId as ProjectId, threadId: thread!.id }
      yield* addItem(address, 'agent_thought', { text: 'extremelyprivate', pictures: [], files: [] })
      yield* addItem(address, 'agent_message', { text: 'reconciliation candidate', pictures: [], files: [] })
      for (let index = 0; index < 56; index += 1)
        yield* addItem(address, 'agent_message', { text: `reconciliation sample ${index}`, pictures: [], files: [] })
      const first = yield* findDocuments({ text: '' }, new Set())
      assert.deepEqual(first.documents, [])
      assert.isTrue(first.indexing)
      yield* drain
      const find = (text: string) => findDocuments({ text, projectId }, new Set())
      assert.isTrue((yield* find('cafe')).documents.some((one) => one.taskId === task.taskId && one.kind === 'task'))
      assert.strictEqual((yield* find('payments cafe')).documents[0]?.taskId, task.taskId)
      assert.strictEqual((yield* find('cp')).documents[0]?.taskId, task.taskId)
      assert.deepEqual((yield* find('???')).documents, [])
      assert.deepEqual((yield* findDocuments({ text: 'cafe', kinds: [] }, new Set())).documents, [])
      const recent = yield* findDocuments({ text: '' }, new Set([task.taskId]))
      assert.isFalse(recent.indexing)
      assert.deepEqual(
        recent.documents.map(({ kind, taskId, state }) => ({ kind, taskId, state })),
        [{ kind: 'task', taskId: task.taskId, state: 'running' }],
      )
      const many = yield* find('reconcili')
      assert.lengthOf(many.documents, 48)
      assert.isTrue(many.indexed)
      assert.isNull(many.next)
      assert.deepEqual((yield* find('extremelyprivate')).documents, [])
      const [old] = (yield* find('candidate')).documents
      assert.isNotNull(old?.itemId)
      yield* sql`UPDATE thread_items SET content = json_set(content, '$.text', 'reconciled verdict') WHERE id = ${old?.itemId ?? ''}`
      assert.deepEqual((yield* find('candidate')).documents, [])
      yield* drain
      const edited = yield* find('verdict')
      assert.strictEqual(edited.documents[0]?.itemId, old?.itemId)
      yield* sql`UPDATE thread_items SET undone_at = '2026-09-01T00:00:00.000Z' WHERE id = ${old?.itemId ?? ''}`
      yield* drain
      assert.deepEqual((yield* find('verdict')).documents, [])
      yield* sql`UPDATE projects SET archived_at = '2026-09-01T00:00:00.000Z' WHERE id = ${projectId}`
      assert.deepEqual((yield* find('cafe')).documents, [])
    }).pipe(Effect.provide(runtime())),
  )

  it.effect('retries a failed batch and keeps the linked result distinct from its task', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const sql = yield* SqlClient.SqlClient
      const projectId = (yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })).projectId
      const { taskId } = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId,
        title: 'Retry receipt',
      })
      const linkId = yield* newId(Ids.externalLink)
      const at = yield* timestamp
      const url = 'https://github.test/meridian/api/pull/51'
      yield* sql`INSERT INTO external_links ${sql.insert({
        id: linkId,
        projectId,
        taskId,
        product: 'github',
        kind: 'change',
        externalId: '51',
        ref: '51',
        key: '51',
        url,
        snapshot: JSON.stringify({ title: 'Retry with an idempotency key', state: 'open', draft: true }),
        createdAt: at,
        updatedAt: at,
      })}`
      yield* sql`CREATE TRIGGER fail_finder_batch BEFORE INSERT ON finder_rows BEGIN SELECT raise(ABORT, 'test write failure'); END`
      yield* TestClock.adjust('350 millis')
      assert.isTrue((yield* sql`SELECT source FROM finder_dirty WHERE source_id = ${linkId}`).length > 0)
      const find = findDocuments({ text: 'retry', kinds: ['pull'] }, new Set())
      assert.deepEqual((yield* find).documents, [])
      yield* sql`DROP TRIGGER fail_finder_batch`
      yield* TestClock.adjust('500 millis')
      const found = yield* find
      assert.deepEqual(
        found.documents.map(({ kind, taskId, url, state }) => ({ kind, taskId, url, state })),
        [{ kind: 'pull', taskId, url, state: 'draft' }],
      )
      assert.deepEqual(yield* sql`SELECT source FROM finder_dirty WHERE source_id = ${linkId}`, [])
    }).pipe(Effect.provide(runtime())),
  )
})
