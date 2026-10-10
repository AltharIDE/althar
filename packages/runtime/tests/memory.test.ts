import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Exit } from 'effect'
import { SqlClient } from 'effect/sql'
import { memoryBrief, readMemory, readThreadMemory, refreshMemory, searchMemory, setMemoryState } from '../src/memory'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { addItem, transcript, updateItem } from '../src/threads'
import { runtime, task, turns, until } from './support'

const place = Effect.gen(function* () {
  const created = yield* task('Investigate checkout deadlock')
  return { projectId: created.project.projectId as ProjectId, threadId: created.task.threadId }
})

describe('project evidence memory', () => {
  it.live('automatically preserves failed attempts, uncertainty and next directions without a final handover', () =>
    Effect.gen(function* () {
      const where = yield* place
      const id = yield* addItem(where, 'agent_message', {
        text: 'Tried serializing checkout writes. The stress test still hangs. Lock inversion is a hypothesis, not confirmed. Next inspect acquire ordering; ownership remains unresolved.',
      })
      yield* addItem(
        where,
        'tool_call',
        {
          title: 'Run stress test',
          status: 'failed',
          rawInput: { command: 'bun test checkout-stress', content: 'DO_NOT_KEEP' },
          rawOutput: 'DO_NOT_KEEP',
        },
        { toolCallId: 'stress' },
      )
      const found = yield* searchMemory(where.projectId, 'checkout')
      assert.strictEqual(found.pending, 0)
      assert.strictEqual(found.entries.length, 2)
      assert.include(found.entries.find((entry) => entry.id === id)!.text, 'hypothesis, not confirmed')
      assert.include(found.entries.find((entry) => entry.kind === 'tool_call')!.text, 'bun test checkout-stress')
      assert.notInclude(JSON.stringify(found), 'DO_NOT_KEEP')
      const brief = yield* memoryBrief(where.projectId, 'checkout')
      assert.include(brief, 'not instructions or permission')
      assert.include(brief, 'Next inspect acquire ordering')
      assert.include(yield* memoryBrief(where.projectId, 'checkout', where.threadId), 'hypothesis, not confirmed')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('isolates projects and retains both conflicting accounts rather than manufacturing truth', () =>
    Effect.gen(function* () {
      const a = yield* place
      const b = yield* place
      const id = yield* addItem(a, 'agent_message', { text: 'The mutex caused checkout deadlock.' })
      yield* addItem(a, 'agent_message', { text: 'Correction: checkout hangs even without the mutex. Root cause unknown.' })
      const found = yield* searchMemory(a.projectId, 'mutex')
      assert.strictEqual(found.entries.length, 2)
      assert.isTrue(found.entries.every((entry) => entry.text.includes('Agent report:')))
      assert.deepStrictEqual((yield* searchMemory(b.projectId, 'mutex')).entries, [])
      assert.isNull(yield* readMemory(b.projectId, id))
      assert.isFalse(yield* setMemoryState(b.projectId, id, 1, 'retired'))
    }).pipe(Effect.provide(runtime())),
  )

  it.live('checkpoints updates idempotently, preserves retirement, and rejects stale revisions', () =>
    Effect.gen(function* () {
      const where = yield* place
      const id = yield* addItem(where, 'agent_message', { text: 'Checkout experiment failed; suspect lock ordering.' })
      yield* Effect.all([refreshMemory(where.projectId), refreshMemory(where.projectId)], { concurrency: 'unbounded' })
      const original = (yield* readMemory(where.projectId, id))!
      assert.strictEqual(original.history.length, 1)
      assert.isTrue(yield* setMemoryState(where.projectId, id, original.revision, 'retired'))
      assert.isFalse(yield* setMemoryState(where.projectId, id, original.revision, 'active'))
      yield* updateItem(where.projectId, id, {
        text: 'Checkout experiment passed after fixing a test fixture; lock ordering was not established as the cause.',
      })
      assert.deepStrictEqual((yield* searchMemory(where.projectId, 'checkout')).entries, [])
      const changed = (yield* readMemory(where.projectId, id))!
      assert.strictEqual(changed.state, 'retired')
      assert.strictEqual(changed.sourceRevision, 2)
      assert.strictEqual(changed.history.length, 2)
      assert.include(changed.history[1]!.text, 'suspect lock ordering')
      assert.strictEqual((yield* searchMemory(where.projectId, 'checkout', { includeRetired: true })).entries.length, 1)
      assert.isTrue(yield* setMemoryState(where.projectId, id, changed.revision, 'active'))
      assert.include((yield* searchMemory(where.projectId, 'checkout')).entries[0]!.text, 'test fixture')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('indexes the whole backlog, finds old evidence, handles query syntax safely and bounds results', () =>
    Effect.gen(function* () {
      const where = yield* place
      const old = yield* addItem(where, 'agent_message', {
        text: 'Unique quasar experiment failed. ' + 'padding '.repeat(5000) + 'A late conclusion: use a timeout.',
      })
      for (let index = 0; index < 1020; index++) yield* addItem(where, 'notice', { title: `Routine work ${index}` })
      const recent = yield* addItem(where, 'agent_message', { text: 'Recent nebula failure, still unresolved.' })
      assert.strictEqual((yield* searchMemory(where.projectId, 'quasar')).entries[0]!.id, old)
      assert.strictEqual((yield* searchMemory(where.projectId, 'nebula')).entries[0]!.id, recent)
      const late = (yield* searchMemory(where.projectId, 'conclusion')).entries[0]!
      assert.include(late.text, 'A late conclusion')
      assert.isAtMost(late.text.length, 1200)
      assert.isAtMost((yield* memoryBrief(where.projectId, 'work')).length, 8000)
      assert.strictEqual((yield* searchMemory(where.projectId, 'quasar', { offset: 1 })).entries.length, 0)
      assert.isAtMost((yield* searchMemory(where.projectId, '" OR ( * :', { limit: 999 })).entries.length, 50)
      const detail = (yield* readMemory(where.projectId, old))!
      assert.isTrue(detail.source.truncated)
      assert.isAtMost(detail.source.text.length, 16000)
      assert.strictEqual((yield* searchMemory(where.projectId, '', { offset: 50, limit: 50 })).entries.length, 50)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('retries failed projection without losing durable evidence and tolerates malformed optional metadata', () =>
    Effect.gen(function* () {
      const where = yield* place
      const sql = yield* SqlClient.SqlClient
      const id = yield* addItem(where, 'plan', { entries: [null, { content: 'Investigate checkout', status: 'pending' }] })
      yield* sql.unsafe(
        "CREATE TRIGGER memory_test_failure BEFORE INSERT ON project_memory BEGIN SELECT RAISE(ABORT,'temporary unavailable'); END",
      )
      assert.isTrue(Exit.isFailure(yield* Effect.exit(refreshMemory(where.projectId))))
      assert.strictEqual((yield* sql`SELECT id FROM thread_items WHERE id=${id}`).length, 1)
      yield* sql.unsafe('DROP TRIGGER memory_test_failure')
      assert.include((yield* searchMemory(where.projectId, 'checkout')).entries[0]!.text, 'Investigate checkout')
      yield* addItem(
        where,
        'tool_call',
        { title: 'Read checkout', locations: [null, {}], status: 'completed' },
        { toolCallId: 'malformed' },
      )
      yield* addItem(where, 'notice', null)
      assert.strictEqual(yield* refreshMemory(where.projectId), 0)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('keeps projection and intentional retirement across database restart', () => {
    const filename = join(mkdtempSync(join(tmpdir(), 'althar-memory-')), 'profile.sqlite')
    return Effect.gen(function* () {
      const saved = yield* Effect.gen(function* () {
        const where = yield* place
        const id = yield* addItem(where, 'agent_message', { text: 'Checkout deadlock still fails under load.' })
        yield* refreshMemory(where.projectId)
        yield* setMemoryState(where.projectId, id, 1, 'retired')
        return { ...where, id }
      }).pipe(Effect.provide(runtime(filename)))
      yield* Effect.gen(function* () {
        const detail = (yield* readMemory(saved.projectId, saved.id))!
        assert.strictEqual(detail.state, 'retired')
        assert.include(detail.source.text, 'still fails under load')
        assert.strictEqual(detail.history.length, 1)
      }).pipe(Effect.provide(runtime(filename)))
    })
  })
  it.live('bundles neighboring attempted approach and qualified next steps with a lexical failure hit', () =>
    Effect.gen(function* () {
      const where = yield* place
      yield* addItem(where, 'agent_message', { text: 'I replaced the pool with a single connection to rule out concurrent acquisition.' })
      const id = yield* addItem(where, 'tool_call', { title: 'Run zephyr regression', status: 'failed' }, { toolCallId: 'zephyr' })
      yield* addItem(where, 'agent_message', {
        text: 'It still stalls. My earlier concurrency hypothesis is unconfirmed; next instrument the socket reader.',
      })
      const brief = yield* memoryBrief(where.projectId, 'zephyr')
      assert.include(brief, id)
      assert.include(brief, 'single connection')
      assert.include(brief, 'instrument the socket reader')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('snapshots repository bases when evidence is recorded, before deferred indexing', () =>
    Effect.gen(function* () {
      const where = yield* place
      const sessions = yield* Sessions
      yield* sessions.start({ threadId: where.threadId, agentId: 'codex' })
      yield* until(turns(where.threadId), (rows) => rows[0]?.state === 'completed')
      const sql = yield* SqlClient.SqlClient
      const [workspace] = yield* sql<{
        baseCommit: string
        bindingId: string
      }>`SELECT base_commit,binding_id FROM workspaces WHERE project_id=${where.projectId}`
      assert.isDefined(workspace)
      const id = yield* addItem(where, 'agent_message', { text: 'Zephyr failed on the original base.' })
      yield* sql`UPDATE workspaces SET base_commit=${'a'.repeat(40)} WHERE project_id=${where.projectId}`
      const detail = (yield* readMemory(where.projectId, id))!
      assert.strictEqual(detail.bases[0]?.commit, workspace!.baseCommit)
      assert.strictEqual(detail.bases[0]?.repository, workspace!.bindingId)
      // Simulate an item predating the migration: unknown is safer than a fabricated historical base.
      const legacy = yield* addItem(where, 'notice', { title: 'Legacy evidence' })
      yield* sql`DELETE FROM memory_source_bases WHERE id=${legacy}`
      assert.deepStrictEqual((yield* readMemory(where.projectId, legacy))!.bases, [])
    }).pipe(Effect.provide(runtime())),
  )

  it.live('pages full sources and bounds sampled history without losing the current revision', () =>
    Effect.gen(function* () {
      const where = yield* place
      const id = yield* addItem(where, 'agent_message', { text: 'x'.repeat(18000) + ' useful ending' })
      const first = (yield* readMemory(where.projectId, id))!
      assert.strictEqual(first.source.nextOffset, 16000)
      const last = (yield* readMemory(where.projectId, id, first.source.nextOffset!))!
      assert.include(last.source.text, 'useful ending')
      assert.isNull(last.source.nextOffset)
      for (let index = 0; index < 22; index++) {
        yield* updateItem(where.projectId, id, { text: `revised observation ${index}` })
        yield* refreshMemory(where.projectId)
      }
      const detail = (yield* readMemory(where.projectId, id))!
      assert.isTrue(detail.historyTruncated)
      assert.strictEqual(detail.history.length, 20)
      assert.strictEqual(detail.sourceRevision, 23)
    }).pipe(Effect.provide(runtime())),
  )
  it.live('retrieves person corrections and immediately excludes withdrawn statements even after indexing', () =>
    Effect.gen(function* () {
      const where = yield* place
      const sessions = yield* Sessions
      const body = 'Correction: the heliostat failure was a fixture issue.'
      const sent = yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', { threadId: where.threadId, body }),
        threadId: where.threadId,
        body,
        disposition: 'after_current',
      })
      const found = yield* searchMemory(where.projectId, 'heliostat')
      assert.include(found.entries[0]!.text, 'Person statement: Correction')
      const id = found.entries[0]!.id
      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE user_inputs SET state='withdrawn' WHERE id=${sent.inputId}`
      assert.deepStrictEqual((yield* searchMemory(where.projectId, 'heliostat')).entries, [])
      assert.isNull(yield* readMemory(where.projectId, id))
      assert.strictEqual(yield* memoryBrief(where.projectId, 'heliostat'), '')
      assert.deepStrictEqual((yield* searchMemory(where.projectId, 'no_such_lexical_evidence')).entries, [])
    }).pipe(Effect.provide(runtime())),
  )
  it.live('bounds initial indexing and exposes pending work while targeted reads remain available', () =>
    Effect.gen(function* () {
      const where = yield* place
      const old = yield* addItem(where, 'agent_message', { text: 'Ancient pulsar experiment failed.' })
      for (let index = 0; index < 2100; index++) yield* addItem(where, 'notice', { title: `Recent activity ${index}` })
      const first = yield* searchMemory(where.projectId, 'activity')
      assert.isAbove(first.pending, 0)
      assert.isAtMost(first.entries.length, 12)
      const targeted = (yield* readMemory(where.projectId, old))!
      assert.include(targeted.source.text, 'Ancient pulsar')
      assert.isTrue(yield* setMemoryState(where.projectId, old, targeted.revision, 'retired'))
      assert.strictEqual((yield* searchMemory(where.projectId, 'activity')).pending, 0)
      // More corrections than one catch-up budget: stale index text must never survive as evidence.
      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE thread_items SET content=${JSON.stringify({ title: 'Corrected current evidence' })},revision=revision+1
        WHERE project_id=${where.projectId} AND kind='notice'`
      const corrected = yield* searchMemory(where.projectId, 'activity')
      assert.isAbove(corrected.pending, 0)
      assert.deepStrictEqual(corrected.entries, [])
    }).pipe(Effect.provide(runtime())),
  )
  it.live('restores same-thread failure evidence evicted by one oversized recent transcript item', () =>
    Effect.gen(function* () {
      const where = yield* place
      const old = yield* addItem(where, 'agent_message', {
        text: 'Zephyr retry experiment failed. Cause remains unknown; next inspect socket cleanup.',
      })
      yield* addItem(where, 'agent_message', { text: 'Unrelated progress '.repeat(4000) })
      const recent = yield* transcript(where.threadId, 60000)
      assert.notInclude(recent.text, 'Zephyr retry experiment')
      assert.isAbove(recent.omitted, 0)
      const brief = yield* memoryBrief(where.projectId, 'zephyr retry', where.threadId)
      assert.include(brief, old)
      assert.include(brief, 'next inspect socket cleanup')
      assert.isAtMost(brief.length, 8000)
    }).pipe(Effect.provide(runtime())),
  )
  it.live('does not echo the current queued input through own-thread anchors or neighbors', () =>
    Effect.gen(function* () {
      const where = yield* place
      const sessions = yield* Sessions
      const send = (body: string) =>
        Effect.gen(function* () {
          return yield* sessions.send({
            envelope: yield* Runtime.envelope('thread.send', { threadId: where.threadId, body }),
            threadId: where.threadId,
            body,
            disposition: 'after_current',
          })
        })
      const older = yield* send('hello previously delivered correction')
      assert.strictEqual(yield* memoryBrief(where.projectId, 'hello', where.threadId), '')
      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE user_inputs SET state='delivered' WHERE id=${older.inputId}`
      yield* send('hello currently queued request')
      const brief = yield* memoryBrief(where.projectId, 'hello', where.threadId)
      assert.include(brief, 'previously delivered correction')
      assert.notInclude(brief, 'currently queued request')
    }).pipe(Effect.provide(runtime())),
  )
  it.live('carries later nonlexical corrections past intervening notices and repeated claims', () =>
    Effect.gen(function* () {
      const where = yield* place
      for (let i = 0; i < 5; i++) yield* addItem(where, 'agent_message', { text: 'Heliostat deadlock: mutex is the proven cause.' })
      for (let i = 0; i < 8; i++) yield* addItem(where, 'notice', { title: `Background activity ${i}` })
      const correction = yield* addItem(where, 'agent_message', {
        text: 'Correction to the previous diagnosis: the reproduction fixture reused an account. Earlier causal attribution was wrong. Do not change production locking.',
      })
      for (let i = 0; i < 15; i++)
        yield* addItem(where, 'tool_call', { title: 'Read source', status: 'completed' }, { toolCallId: `read-${i}` })
      const brief = yield* memoryBrief(where.projectId, 'heliostat mutex')
      assert.include(brief, correction)
      assert.include(brief, 'fixture reused an account')
      assert.strictEqual(brief.split('mutex is the proven cause').length - 1, 1)
      assert.include(brief, 'omitted events may contain further corrections')
    }).pipe(Effect.provide(runtime())),
  )
  it.live('retains trailing task terms after long pasted request context', () =>
    Effect.gen(function* () {
      const where = yield* place
      const id = yield* addItem(where, 'agent_message', { text: 'Heliostat acquisition failed; inspect the fixture.' })
      const request = Array.from({ length: 80 }, (_, i) => `unrelatedword${i}`).join(' ') + ' heliostat acquisition'
      assert.include(yield* memoryBrief(where.projectId, request), id)
    }).pipe(Effect.provide(runtime())),
  )
  it.live('merges semantic selections with project isolation', () =>
    Effect.gen(function* () {
      const where = yield* place
      const other = yield* place
      const old = yield* addItem(where, 'agent_message', { text: 'Serializing writes still hangs. The cause is unconfirmed.' })
      yield* addItem(where, 'agent_message', { text: 'The reproduction fixture is invalid; earlier causal claims are withdrawn.' })
      yield* addItem(other, 'agent_message', { text: 'FOREIGN_PRIVATE_EVIDENCE' })
      const brief = yield* memoryBrief(where.projectId, 'purchase freeze', undefined, { threadIds: [where.threadId, other.threadId] })
      assert.include(brief, 'reproduction fixture is invalid')
      assert.notInclude(brief, 'FOREIGN_PRIVATE_EVIDENCE')
      const found = yield* searchMemory(where.projectId, 'purchase freeze', {
        selectedThreadIds: [where.threadId, other.threadId],
        limit: 1,
      })
      assert.strictEqual(found.entries.length, 1)
      assert.include(found.entries[0]!.text, 'reproduction fixture is invalid')
      const next = yield* searchMemory(where.projectId, 'purchase freeze', { selectedThreadIds: [where.threadId], limit: 1, offset: 1 })
      assert.strictEqual(next.entries[0]!.id, old)
    }).pipe(Effect.provide(runtime())),
  )
  it.live('reserves a buried observed failure alongside the newest account in semantic task context', () =>
    Effect.gen(function* () {
      const where = yield* place
      yield* addItem(where, 'agent_message', { text: 'Tried serializing acquisition.' })
      const failure = yield* addItem(
        where,
        'tool_call',
        {
          title: 'Run reproduction',
          status: 'failed',
          diagnostic: { text: 'expected account B, received account A', source: 'tool-output', truncated: false, redacted: false },
        },
        { toolCallId: 'buried-failure' },
      )
      for (let i = 0; i < 15; i++) yield* addItem(where, 'agent_message', { text: `Investigating auxiliary progress ${i}` })
      yield* addItem(where, 'agent_message', { text: 'The fixture reused an account; production locking is not established as the cause.' })
      const brief = yield* memoryBrief(where.projectId, 'purchase freeze', undefined, { threadIds: [where.threadId] })
      assert.include(brief, failure)
      assert.include(brief, 'expected account B, received account A')
      assert.include(brief, 'fixture reused an account')
    }).pipe(Effect.provide(runtime())),
  )
  it.live('preserves explicit retractions after many unrelated reports and links old source to updates', () =>
    Effect.gen(function* () {
      const where = yield* place
      const old = yield* addItem(where, 'agent_message', { text: 'Heliostat deadlock: mutex is the proven cause.' })
      const correction = yield* addItem(where, 'agent_message', {
        text: 'I retract the previous diagnosis. The reproduction fixture reused an account; production locking is not established as the cause.',
      })
      for (let i = 0; i < 15; i++) yield* addItem(where, 'agent_message', { text: `Unrelated documentation progress ${i}` })
      const brief = yield* memoryBrief(where.projectId, 'heliostat mutex')
      assert.include(brief, correction)
      assert.include(brief, 'fixture reused an account')
      assert.include(brief, 'Potential update candidate')
      const detail = (yield* readMemory(where.projectId, old))!
      assert.strictEqual(detail.relatedUpdates[0]!.id, correction)
      assert.include(detail.contextNotice, 'read_memory_thread')
      const page = yield* readThreadMemory(where.projectId, where.threadId)
      assert.strictEqual(page.entries[0]!.id, old)
      assert.strictEqual(page.entries[1]!.id, correction)
      assert.strictEqual(page.nextOffset, 12)
      const last = yield* readThreadMemory(where.projectId, where.threadId, page.nextOffset!)
      assert.strictEqual(last.entries.length, 5)
      assert.isNull(last.nextOffset)
      const foreign = yield* place
      assert.strictEqual((yield* readThreadMemory(foreign.projectId, where.threadId)).total, 0)
      assert.isTrue(yield* setMemoryState(where.projectId, correction, detail.relatedUpdates[0]!.revision, 'retired'))
      assert.deepStrictEqual((yield* readMemory(where.projectId, old))!.relatedUpdates, [])
    }).pipe(Effect.provide(runtime())),
  )
  it.live('includes semantic source anchors from the middle of a thread with its update candidates', () =>
    Effect.gen(function* () {
      const where = yield* place
      yield* addItem(where, 'agent_message', { text: 'Initial unrelated work' })
      const id = yield* addItem(where, 'agent_message', { text: 'Serializing checkout writes still hangs.' })
      yield* addItem(where, 'agent_message', { text: 'Correction: earlier attribution was wrong; inspect the fixture.' })
      for (let i = 0; i < 20; i++) yield* addItem(where, 'agent_message', { text: `Unrelated later progress ${i}` })
      const foreign = yield* place
      const secret = yield* addItem(foreign, 'agent_message', { text: 'PRIVATE_SOURCE' })
      const brief = yield* memoryBrief(where.projectId, 'purchase freeze', undefined, {
        threadIds: [where.threadId],
        sourceIds: [id, secret],
      })
      assert.include(brief, id)
      assert.include(brief, 'Serializing checkout writes still hangs')
      assert.include(brief, 'earlier attribution was wrong')
      assert.notInclude(brief, 'PRIVATE_SOURCE')
    }).pipe(Effect.provide(runtime())),
  )
  it.live('ranks exact semantic source hits before generic thread rows and preserves paging and isolation', () =>
    Effect.gen(function* () {
      const where = yield* place
      const middle = yield* addItem(where, 'agent_message', { text: 'Serializing checkout writes still hangs.' })
      const latest = yield* addItem(where, 'agent_message', { text: 'Unrelated later progress' })
      const foreign = yield* place
      const secret = yield* addItem(foreign, 'agent_message', { text: 'PRIVATE_SOURCE' })
      const options = { selectedThreadIds: [where.threadId], selectedSourceIds: [secret, middle], limit: 1 }
      assert.strictEqual((yield* searchMemory(where.projectId, 'purchase freeze', options)).entries[0]!.id, middle)
      assert.strictEqual((yield* searchMemory(where.projectId, 'purchase freeze', { ...options, offset: 1 })).entries[0]!.id, latest)
      assert.isTrue(yield* setMemoryState(where.projectId, middle, 1, 'retired'))
      assert.strictEqual((yield* searchMemory(where.projectId, 'purchase freeze', options)).entries[0]!.id, latest)
    }).pipe(Effect.provide(runtime())),
  )
  it.live('delivers the matching semantic passage of a long source while preserving observed failure status', () =>
    Effect.gen(function* () {
      const where = yield* place
      const id = yield* addItem(
        where,
        'tool_call',
        {
          title: 'Run reproduction',
          status: 'failed',
          rawInput: { command: 'bun test' },
          diagnostic: {
            text: 'setup '.repeat(800) + 'expected account B, received account A',
            source: 'tool-output',
            truncated: false,
            redacted: false,
          },
        },
        { toolCallId: 'offset-source' },
      )
      const detail = (yield* readMemory(where.projectId, id))!
      const offset = detail.source.text.indexOf('expected account B')
      const sourceOffsets = { [id]: offset }
      const result = yield* searchMemory(where.projectId, 'purchase freeze', { selectedSourceIds: [id], sourceOffsets })
      assert.include(result.entries[0]!.text, 'expected account B, received account A')
      assert.include(result.entries[0]!.text, 'Observed tool status: failed')
      const brief = yield* memoryBrief(where.projectId, 'purchase freeze', undefined, {
        threadIds: [where.threadId],
        sourceIds: [id],
        sourceOffsets,
      })
      assert.include(brief, 'expected account B, received account A')
      assert.include(brief, 'Observed tool status: failed')
      const invalid = yield* searchMemory(where.projectId, 'purchase freeze', { selectedSourceIds: [id], sourceOffsets: { [id]: -100 } })
      assert.include(invalid.entries[0]!.text, 'Observed tool status: failed')
    }).pipe(Effect.provide(runtime())),
  )
  it.live('does not apply a semantic offset computed for an obsolete source revision', () =>
    Effect.gen(function* () {
      const where = yield* place
      const id = yield* addItem(where, 'agent_message', { text: 'padding '.repeat(500) + 'old relevant passage' })
      const original = (yield* readMemory(where.projectId, id))!
      const sourceOffsets = { [id]: original.source.text.indexOf('old relevant passage') }
      const sourceRevisions = { [id]: original.sourceRevision }
      yield* updateItem(where.projectId, id, { text: 'Corrected current account. ' + 'unrelated '.repeat(600) })
      const search = yield* searchMemory(where.projectId, 'unknownword', { selectedSourceIds: [id], sourceOffsets, sourceRevisions })
      assert.include(search.entries[0]!.text, 'Corrected current account')
      const brief = yield* memoryBrief(where.projectId, 'unknownword', undefined, {
        threadIds: [where.threadId],
        sourceIds: [id],
        sourceOffsets,
        sourceRevisions,
      })
      assert.include(brief, 'Corrected current account')
      assert.notInclude(brief, 'old relevant passage')
    }).pipe(Effect.provide(runtime())),
  )
})
