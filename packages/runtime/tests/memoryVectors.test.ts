import { assert, describe, it } from '@effect/vitest'
import { Effect, Fiber } from 'effect'
import { SqlClient } from 'effect/sql'
import type { ProjectId } from '@althar/domain'
import { semanticMemory, memoryVectorModel } from '../src/memoryVectors'
import { readMemory, refreshMemory, setMemoryState, memoryBrief } from '../src/memory'
import { addItem, updateItem } from '../src/threads'
import { runtime, task } from './support'

// Deliberately synthetic vectors: these tests prove index lifecycle, not language understanding.
const embed = async (texts: readonly string[]) => texts.map((text) => (text.includes('relevant') ? [1, 0] : [0, 1]))
const place = Effect.gen(function* () {
  const made = yield* task('Vector lifecycle')
  return { projectId: made.project.projectId as ProjectId, threadId: made.task.threadId }
})
describe('durable memory vectors', () => {
  it.live('does not invoke the encoder for an empty project', () =>
    Effect.gen(function* () {
      const a = yield* place
      const result = yield* semanticMemory(a.projectId, 'question', async () => {
        throw new Error('must not download model')
      })
      assert.deepStrictEqual(result, {
        threadIds: [],
        sourceIds: [],
        sourceOffsets: {},
        sourceRevisions: {},
        pending: 0,
        truncatedSources: 0,
      })
    }).pipe(Effect.provide(runtime())),
  )
  it.live('catches up bounded batches across the whole project and samples the end of a long query', () =>
    Effect.gen(function* () {
      const a = yield* place
      for (let i = 0; i < 129; i++)
        yield* addItem(a, 'agent_message', { text: i === 128 ? 'relevant oldest-needed evidence' : `other item ${i}` })
      const first = yield* semanticMemory(a.projectId, 'relevant', embed)
      assert.strictEqual(first.pending, 1)
      assert.deepStrictEqual(first.threadIds, [])
      const caughtUp = yield* semanticMemory(a.projectId, 'other '.repeat(2000) + 'relevant request', embed)
      assert.strictEqual(caughtUp.pending, 0)
      assert.deepStrictEqual(caughtUp.threadIds, [a.threadId])
    }).pipe(Effect.provide(runtime())),
  )
  it.live('delivers the actual middle semantic passage and preserves offsets after vector reuse', () =>
    Effect.gen(function* () {
      const a = yield* place
      const id = yield* addItem(a, 'agent_message', {
        text:
          'background '.repeat(400) + 'relevant experiment: serializing writes still hangs; cause unverified.' + ' trailing '.repeat(400),
      })
      const selected = yield* semanticMemory(a.projectId, 'relevant', embed)
      assert.isAbove(selected.sourceOffsets[id]!, 0)
      const cached = yield* semanticMemory(a.projectId, 'relevant', embed)
      assert.deepStrictEqual(cached.sourceOffsets, selected.sourceOffsets)
      // No shared query word in the actual delivery query; offset comes exclusively from the vector match.
      const delivered = yield* memoryBrief(a.projectId, 'purchase freeze', undefined, selected)
      assert.include(delivered, 'serializing writes still hangs; cause unverified')
    }).pipe(Effect.provide(runtime())),
  )
  it.live('persists vectors, reuses them, isolates projects, and withholds retired or outdated evidence', () =>
    Effect.gen(function* () {
      const a = yield* place,
        b = yield* place
      const id = yield* addItem(a, 'agent_message', { text: 'relevant evidence' })
      const foreign = yield* addItem(b, 'agent_message', { text: 'relevant foreign evidence' })
      let batches = 0
      const tracked = async (texts: readonly string[]) => {
        batches++
        return embed(texts)
      }
      const first = yield* semanticMemory(a.projectId, 'relevant question', tracked)
      assert.deepStrictEqual(first.sourceIds, [id])
      assert.notInclude(first.sourceIds, foreign)
      assert.strictEqual(first.pending, 0)
      assert.strictEqual(batches, 2)
      yield* semanticMemory(a.projectId, 'relevant question', tracked)
      assert.strictEqual(batches, 3) // Only the query is re-embedded.
      yield* updateItem(a.projectId, id, { text: 'other conclusion' })
      assert.deepStrictEqual((yield* semanticMemory(a.projectId, 'relevant question', embed)).threadIds, [])
      const current = (yield* readMemory(a.projectId, id))!
      yield* setMemoryState(a.projectId, id, current.revision, 'retired')
      assert.deepStrictEqual((yield* semanticMemory(a.projectId, 'other', embed)).threadIds, [])
    }).pipe(Effect.provide(runtime())),
  )
  it.live('rejects an embedding computed for an obsolete source and retries after failure', () =>
    Effect.gen(function* () {
      const a = yield* place
      const id = yield* addItem(a, 'agent_message', { text: 'relevant evidence' })
      // Simulate an update while model work is in flight, without holding a DB transaction.
      const sql = yield* SqlClient.SqlClient
      yield* refreshMemory(a.projectId)
      // The source item advances before its projection does: neither stale projection nor vector can be read.
      yield* updateItem(a.projectId, id, { text: 'other newer evidence' })
      const result = yield* semanticMemory(a.projectId, 'relevant', embed)
      assert.deepStrictEqual(result.sourceIds, [])
      yield* sql`UPDATE project_memory_vectors SET model='obsolete' WHERE id=${id}`
      const failed = yield* Effect.exit(
        semanticMemory(a.projectId, 'other', async () => {
          throw new Error('encoder unavailable')
        }),
      )
      assert.strictEqual(failed._tag, 'Failure')
      assert.deepStrictEqual((yield* semanticMemory(a.projectId, 'other', embed)).sourceIds, [id])
      const [row] = yield* sql<{ model: string }>`SELECT model FROM project_memory_vectors WHERE id=${id}`
      assert.strictEqual(row?.model, memoryVectorModel)
    }).pipe(Effect.provide(runtime())),
  )
  it.live('withholds sources changed or retired while the query is embedding', () =>
    Effect.gen(function* () {
      for (const change of ['update', 'retire'] as const) {
        const a = yield* place
        const id = yield* addItem(a, 'agent_message', { text: 'padding '.repeat(400) + 'relevant old diagnosis' })
        let entered!: () => void, release!: () => void
        const started = new Promise<void>((resolve) => {
          entered = resolve
        })
        const barrier = new Promise<void>((resolve) => {
          release = resolve
        })
        let calls = 0
        const delayed = async (texts: readonly string[]) => {
          if (calls++ === 1) {
            entered()
            await barrier
          }
          return embed(texts)
        }
        const work = yield* Effect.forkChild(semanticMemory(a.projectId, 'relevant', delayed))
        yield* Effect.promise(() => started)
        if (change === 'update') yield* updateItem(a.projectId, id, { text: 'other correction' })
        else {
          const source = (yield* readMemory(a.projectId, id))!
          yield* setMemoryState(a.projectId, id, source.revision, 'retired')
        }
        release()
        const result = yield* Fiber.join(work)
        assert.deepStrictEqual(result.sourceIds, [])
        assert.deepStrictEqual(result.sourceOffsets, {})
      }
    }).pipe(Effect.provide(runtime())),
  )

  it.live('cancellation during embedding prevents a late vector commit and a later request retries', () =>
    Effect.gen(function* () {
      const a = yield* place
      const id = yield* addItem(a, 'agent_message', { text: 'relevant durable evidence' })
      let entered!: () => void
      const started = new Promise<void>((resolve) => {
        entered = resolve
      })
      let release!: () => void
      const barrier = new Promise<void>((resolve) => {
        release = resolve
      })
      let finished!: () => void
      const completed = new Promise<void>((resolve) => {
        finished = resolve
      })
      const delayed = async (texts: readonly string[]) => {
        entered()
        await barrier
        const values = await embed(texts)
        finished()
        return values
      }
      const work = yield* Effect.forkChild(semanticMemory(a.projectId, 'relevant', delayed))
      yield* Effect.promise(() => started)
      yield* Fiber.interrupt(work)
      release()
      yield* Effect.promise(() => completed)
      const sql = yield* SqlClient.SqlClient
      const [row] = yield* sql<{ count: number }>`SELECT count(*) AS count FROM project_memory_vectors WHERE id=${id}`
      assert.strictEqual(row?.count, 0)
      assert.deepStrictEqual((yield* semanticMemory(a.projectId, 'relevant', embed)).sourceIds, [id])
    }).pipe(Effect.provide(runtime())),
  )

  it.live('does not commit vectors when the source changes during embedding', () =>
    Effect.gen(function* () {
      const a = yield* place
      const id = yield* addItem(a, 'agent_message', { text: 'relevant stale evidence' })
      let entered!: () => void
      const started = new Promise<void>((resolve) => {
        entered = resolve
      })
      let release!: () => void
      const barrier = new Promise<void>((resolve) => {
        release = resolve
      })
      let calls = 0
      const delayed = async (texts: readonly string[]) => {
        if (calls++ === 0) {
          entered()
          await barrier
        }
        return embed(texts)
      }
      const work = yield* Effect.forkChild(semanticMemory(a.projectId, 'relevant', delayed))
      yield* Effect.promise(() => started)
      yield* updateItem(a.projectId, id, { text: 'other corrected evidence' })
      release()
      const result = yield* Fiber.join(work)
      assert.deepStrictEqual(result.sourceIds, [])
      const sql = yield* SqlClient.SqlClient
      const [count] = yield* sql<{ count: number }>`SELECT count(*) AS count FROM project_memory_vectors WHERE id=${id}`
      assert.strictEqual(count?.count, 0)
      assert.deepStrictEqual((yield* semanticMemory(a.projectId, 'other', embed)).sourceIds, [id])
    }).pipe(Effect.provide(runtime())),
  )

  it.live('indexes concurrent requests idempotently and reports omitted long-source chunks separately', () =>
    Effect.gen(function* () {
      const a = yield* place
      const id = yield* addItem(a, 'agent_message', { text: 'padding '.repeat(2200) + 'relevant ending' })
      const results = yield* Effect.all([semanticMemory(a.projectId, 'relevant', embed), semanticMemory(a.projectId, 'relevant', embed)], {
        concurrency: 'unbounded',
      })
      for (const result of results) {
        assert.include(result.sourceIds, id)
        assert.strictEqual(result.pending, 0)
        assert.strictEqual(result.truncatedSources, 1)
        assert.isAbove(result.sourceOffsets[id]!, 13000)
      }
      const sql = yield* SqlClient.SqlClient
      const [count] = yield* sql<{ count: number }>`SELECT count(*) AS count FROM project_memory_vectors`
      assert.strictEqual(count?.count, 1)
    }).pipe(Effect.provide(runtime())),
  )
})
