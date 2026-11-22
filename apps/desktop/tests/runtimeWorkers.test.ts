import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, it } from '@effect/vitest'
import { configureWorkers, openWorkerStore, workerCertificate } from '@althar/runtime/workerHome'
import { removeTreeSync } from '@althar/testing'
import { Effect } from 'effect'

import { testAgentWorker } from '../../../packages/worker-protocol/integration/worker-agent-client'
import { workerCertificates } from '../../../packages/worker-protocol/integration/worker-certificates'
import { workersForProfile } from '../src/runtime/workers'

it.live('opens the Desktop profile’s worker listener and exposes only workers granted to the project', () =>
  Effect.gen(function* () {
    const root = mkdtempSync(join(tmpdir(), 'althar-desktop-worker-'))
    yield* Effect.addFinalizer(() => Effect.sync(() => removeTreeSync(root)))
    const paths = { profile: join(root, 'profile'), worktrees: join(root, 'worktrees') }
    mkdirSync(paths.profile)
    mkdirSync(paths.worktrees)
    assert.isUndefined(yield* workersForProfile(paths))
    const certificates = workerCertificates(root)
    yield* configureWorkers(paths, {
      version: 1,
      address: '127.0.0.1',
      port: 0,
      ca: certificates('home-ca.pem'),
      certificate: certificates('home.pem'),
      key: certificates('home.key'),
    })
    const homeId = 'home_' + '1'.repeat(32)
    const projectId = 'proj_' + '2'.repeat(32)
    const workerId = yield* Effect.promise(async () => {
      const ledger = await openWorkerStore(paths.profile, homeId, Date.now)
      try {
        return ledger.enroll(await workerCertificate(certificates('enrolled.pem')), projectId)
      } finally {
        ledger.close()
      }
    })
    const home = yield* workersForProfile(paths)
    if (home === undefined) throw new Error('The profile should have its worker transport')
    assert.deepStrictEqual(home.execution.list(projectId), [])
    yield* Effect.scoped(
      Effect.gen(function* () {
        const port = yield* home.listen(homeId)
        if (port === undefined) throw new Error('The configured listener should open a port')
        const worker = yield* Effect.acquireRelease(
          Effect.sync(() => testAgentWorker(port, certificates)),
          (worker) => Effect.sync(() => worker.close()),
        )
        const hello = yield* Effect.promise(() =>
          worker.hello({
            $typeName: 'althar.worker.v1.AgentWorkerHello',
            version: 1,
            workerId,
            journalId: 'wjn_' + '3'.repeat(32),
            capabilities: [
              {
                $typeName: 'althar.worker.v1.AgentWorkerCapability',
                projectId,
                providerId: 'codex',
                workspaceSetup: false,
                managedCommands: false,
                managedPreview: false,
                workspaceSets: false,
                helperAgents: false,
                skillFiles: false,
                helperSkillFiles: false,
                helperCheckouts: false,
              },
            ],
          }),
        )
        assert.strictEqual(hello?.case, 'hello')
        assert.deepStrictEqual(home.execution.list(projectId), [{ workerId, providers: ['codex'], busy: false }])
        assert.deepStrictEqual(home.execution.list('proj_' + '9'.repeat(32)), [])
      }),
    )
    assert.deepStrictEqual(home.execution.list(projectId), [])
  }),
)
