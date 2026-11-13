import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'
import type { ProjectId } from '@althar/domain'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { searchDocuments } from '../src/searchDocuments'
import { addItem } from '../src/threads'
import { repository, runtime } from './support'

describe('search documents', () => {
  it.effect('pages every public local message, excludes thoughts and archived projects, and removes dropped notes', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const sql = yield* SqlClient.SqlClient
      const projectId = (yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })).projectId
      const made = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId,
        title: 'Retry payments',
        description: 'A task about checkout',
      })
      const [thread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${made.taskId} AND kind = 'task'`
      assert.isDefined(thread)
      for (let i = 0; i < 205; i++)
        yield* addItem({ projectId: projectId as ProjectId, threadId: thread!.id }, 'agent_message', {
          text: `Decision ${i}: use retries`,
          pictures: [],
          files: [],
        })
      yield* addItem({ projectId: projectId as ProjectId, threadId: thread!.id }, 'agent_thought', {
        text: 'Private chain',
        pictures: [],
        files: [],
      })
      const first = yield* searchDocuments()
      assert.strictEqual(first.documents.length, 200)
      assert.isNotNull(first.next)
      const next = yield* searchDocuments(first.next!)
      const all = [...first.documents, ...next.documents]
      assert.strictEqual(new Set(all.map((one) => one.id)).size, all.length)
      assert.strictEqual(all.filter((one) => one.kind === 'said').length, 205)
      assert.isFalse(all.some((one) => one.title.includes('Private chain')))
      assert.isTrue(all.some((one) => one.kind === 'task' && one.title === 'Retry payments'))
      assert.isNull(next.next)
      yield* sql`UPDATE projects SET archived_at = '2026-11-13T00:00:00.000Z' WHERE id = ${projectId}`
      assert.deepStrictEqual((yield* searchDocuments()).documents, [])
    }).pipe(Effect.provide(runtime())),
  )
})
