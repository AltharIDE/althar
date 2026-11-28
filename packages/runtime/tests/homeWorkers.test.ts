import { assert, describe, it } from '@effect/vitest'
import { AgentStartFailed } from '@althar/provider-adapters'
import { Effect } from 'effect'

import { homeWorkers } from '../src/homeWorkers'
import type { WorkerAdmin, WorkerExecutionPlatform } from '../src/workerExecution'
import { runtime } from './support'

const admin: WorkerAdmin = {
  add: () => Effect.fail('Not in this test.'),
  code: () => Effect.fail('Not in this test.'),
  assign: () => Effect.void,
}
const platform = (
  enrolled: NonNullable<WorkerExecutionPlatform['enrolled']>,
  more: Pick<WorkerExecutionPlatform, 'admin' | 'adds'> = {},
): WorkerExecutionPlatform => ({
  list: () => [],
  enrolled,
  open: () => Effect.fail(new AgentStartFailed({ command: 'codex', reason: 'Not in this test.' })),
  ...more,
})

describe('the home’s workers as Settings › Computers lists them', () => {
  it.effect('says whether the home listens for workers, and whether it adds them itself', () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* homeWorkers(undefined), { enabled: false, workers: [] })
      assert.deepStrictEqual(yield* homeWorkers(platform(() => null, { admin })), { enabled: false, workers: [], adds: true })
      assert.deepStrictEqual(yield* homeWorkers(platform(() => [], { admin, adds: () => false })), { enabled: true, workers: [] })
      assert.deepStrictEqual(yield* homeWorkers(platform(() => [], { admin, adds: () => true })), {
        enabled: true,
        workers: [],
        adds: true,
      })
    }).pipe(Effect.provide(runtime(':memory:'))),
  )

  it.effect('passes on what each worker said, and leaves out what it didn’t', () =>
    Effect.gen(function* () {
      const listed = yield* homeWorkers(
        platform(() => [
          {
            workerId: 'worker-said',
            connected: true,
            // Busy, but readying: no workspace yet, and no running task placed on it.
            busy: true,
            providers: ['codex'],
            projectIds: [],
            name: 'hermes-box',
            ssh: 'ada@hermes-box',
            signedIn: ['codex'],
            release: 'worker-v0.3.0',
            updatesOnRequest: true,
            update: { state: 'done', version: 'worker-v0.3.0' },
            readiness: { sandbox: { starts: true }, tools: [], models: [] },
            anyProject: true,
          },
          { workerId: 'worker-quiet', connected: false, busy: false, providers: [], projectIds: [], updatesOnRequest: false },
        ]),
      )
      assert.deepStrictEqual(listed, {
        enabled: true,
        workers: [
          {
            workerId: 'worker-said',
            name: 'hermes-box',
            ssh: 'ada@hermes-box',
            signedIn: ['codex'],
            release: 'worker-v0.3.0',
            updatesOnRequest: true,
            update: { state: 'done', version: 'worker-v0.3.0' },
            readiness: { sandbox: { starts: true }, tools: [], models: [] },
            anyProject: true,
            connected: true,
            busy: true,
            providers: ['codex'],
            projects: [],
            task: null,
          },
          { workerId: 'worker-quiet', connected: false, busy: false, providers: [], projects: [], task: null },
        ],
      })
    }).pipe(Effect.provide(runtime(':memory:'))),
  )
})
