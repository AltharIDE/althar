import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { OutwardUncertain } from '../src/errors'
import { outward } from '../src/outward'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { repository, runtime } from './support'

/*
 * What an outward action keeps of how it went: the receipt and the work item
 * the next launch reads, with the service's own words where it refused, and
 * an answer read back only as the record kept it.
 */

/** The receipt and work item of the action with this key, as the record has them. */
const recordOf = (key: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ receipt: string; response: string | null; item: string; lastError: string | null }>`
      SELECT m.state AS receipt, m.response, w.state AS item, w.last_error FROM mutation_receipts m JOIN work_items w ON w.id = m.work_item_id
      WHERE m.idempotency_key = ${key} ORDER BY m.created_at DESC LIMIT 1`
    return row
  })

const opened = Effect.gen(function* () {
  const projects = yield* Projects
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  return project.projectId as ProjectId
})

const act = <A, E>(
  projectId: ProjectId,
  key: string,
  perform: Effect.Effect<A, E>,
  decode: (kept: unknown) => A | undefined = (kept) => kept as A,
  encode: (answer: A) => unknown = (answer) => answer,
) =>
  outward({
    projectId,
    subject: { type: 'task', id: 'task_1' },
    target: 'linear:MER-1',
    operation: 'comment',
    key,
    request: { body: 'hi' },
    retryable: false,
    perform,
    encode,
    decode,
  })

describe('an outward action’s record', () => {
  it.live('keeps what a service that refused said, as the work item’s error, cut to a few hundred characters', () =>
    Effect.gen(function* () {
      const projectId = yield* opened
      yield* Effect.flip(act(projectId, 'words', Effect.fail('The issue is locked')))
      assert.deepStrictEqual(yield* recordOf('words'), {
        receipt: 'failed',
        response: null,
        item: 'failed',
        lastError: 'The issue is locked',
      })
      yield* Effect.flip(act(projectId, 'long', Effect.fail(new Error('x'.repeat(800)))))
      assert.strictEqual((yield* recordOf('long'))?.lastError, 'x'.repeat(500))
      // Done, it keeps no error, and its answer as the action encodes it.
      assert.strictEqual(
        yield* act(
          projectId,
          'done',
          Effect.succeed(7),
          (kept) => (typeof kept === 'object' && kept !== null && 'n' in kept ? Number(kept.n) : undefined),
          (n) => ({ n }),
        ),
        7,
      )
      assert.deepStrictEqual(yield* recordOf('done'), { receipt: 'confirmed', response: '{"n":7}', item: 'done', lastError: null })
    }).pipe(Effect.provide(runtime())),
  )

  it.live('reads back a confirmed answer the record kept nothing of as nothing, and is uncertain where that isn’t an answer', () =>
    Effect.gen(function* () {
      const projectId = yield* opened
      const sql = yield* SqlClient.SqlClient
      yield* act(projectId, 'empty', Effect.succeed('first'))
      yield* sql`UPDATE mutation_receipts SET response = NULL WHERE idempotency_key = 'empty'`
      // An action whose answer may be nothing reads it so, without calling again.
      let calls = 0
      const again = Effect.sync(() => `call ${(calls += 1)}`)
      assert.strictEqual(yield* act(projectId, 'empty', again, (kept) => (kept === null ? 'nothing' : undefined)), 'nothing')
      // One whose answer can't be nothing is uncertain, not invented.
      assert.instanceOf(
        yield* Effect.flip(act(projectId, 'empty', again, (kept) => (typeof kept === 'string' ? kept : undefined))),
        OutwardUncertain,
      )
      assert.strictEqual(calls, 0)
    }).pipe(Effect.provide(runtime())),
  )
})
