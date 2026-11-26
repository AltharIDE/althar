import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { assert, it } from '@effect/vitest'
import { until } from '@althar/testing/effect'
import { AgentRunOutcome, type AgentWorkerHello } from '@althar/worker-protocol'
import { Effect } from 'effect'

import { testAgentWorker } from '../../worker-protocol/integration/worker-agent-client'
import { workerCertificates } from '../../worker-protocol/integration/worker-certificates'
import { workerExecution } from '../src/workerHome/execution'
import { configureWorkers, listenWorkers, workerCertificate } from '../src/workerHome/network'
import { openWorkerStore } from '../src/workerHome/store'
import { workerTestDirectory } from './workerTestFiles'

/*
 * The home's workers as Settings › Computers lists them and takes one out,
 * through the real listener, its ledger and its pool, with a worker speaking
 * the protocol: it comes online, drops mid-run holding its task's workspace,
 * can't be taken out until it has reconnected and said that run stopped, and
 * then is taken out for good.
 */

const homeId = `home_${'1'.repeat(32)}`
const projectId = `proj_${'2'.repeat(32)}`
const workspaceId = `ws_${'4'.repeat(32)}`
const journalId = `wjn_${'3'.repeat(32)}`

const hello = (workerId: string): AgentWorkerHello => ({
  $typeName: 'althar.worker.v1.AgentWorkerHello',
  anyProject: false,
  reportsSignIn: false,
  signedIn: [],
  release: '',
  reserveBeforeTransfer: false,
  version: 1,
  workerId,
  journalId,
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
      fileReads: false,
      workspaceIndex: false,
    },
  ],
})

it.live('keeps a worker that dropped mid-run until it says that run stopped, then takes it out for good', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = workerTestDirectory()
      const paths = { profile: join(root, 'profile'), worktrees: join(root, 'worktrees') }
      mkdirSync(paths.profile, { mode: 0o700 })
      const certificate = workerCertificates(root)
      yield* configureWorkers(paths, {
        version: 1,
        address: '127.0.0.1',
        port: 0,
        ca: certificate('home-ca.pem'),
        certificate: certificate('home.pem'),
        key: certificate('home.key'),
      })
      const workerId = yield* Effect.promise(async () => {
        const ledger = await openWorkerStore(paths.profile, homeId, Date.now)
        try {
          return ledger.enroll(await workerCertificate(certificate('enrolled.pem')), projectId)
        } finally {
          ledger.close()
        }
      })
      const listener = yield* listenWorkers(paths, homeId)
      if (listener === undefined) return yield* Effect.die('The worker listener was not started')
      const home = workerExecution(
        () => listener.agentWorkers,
        () => listener,
      )
      const connect = () =>
        Effect.acquireRelease(
          Effect.sync(() => testAgentWorker(listener.port, certificate)),
          (worker) => Effect.sync(() => worker.close()),
        )
      const standing = () => home.enrolled?.()?.find((one) => one.workerId === workerId)

      // Enrolled, not yet connected; then online, free.
      assert.deepStrictEqual(standing(), { workerId, connected: false, busy: false, providers: [], projectIds: [projectId] })
      const first = yield* connect()
      assert.strictEqual((yield* Effect.promise(() => first.hello(hello(workerId))))?.case, 'hello')
      assert.deepInclude(standing(), { connected: true, busy: false, providers: ['codex'] })

      // A run reserves the task's workspace; the worker drops before saying how it ended.
      const pending = listener.agentWorkers.start(workerId, { projectId, workspaceId, providerId: 'codex' })
      const started = yield* Effect.promise(() => first.read())
      if (started?.case !== 'start') return yield* Effect.die('The home did not start the run')
      const { runId } = started.value
      first.close()
      yield* Effect.promise(() => pending.then(() => undefined).catch(() => undefined))
      const dropped = yield* until(Effect.sync(standing), (worker) => worker?.connected === false)
      // Offline, it still holds the workspace, and the task with it: taking it out now would leave it held for good.
      assert.deepStrictEqual(dropped, { workerId, connected: false, busy: true, providers: [], projectIds: [projectId], workspaceId })
      assert.strictEqual(
        yield* Effect.flip(home.revoke!(workerId)),
        'It went offline during a task. Start it again so it can stop that work, then remove it.',
      )

      // Back, it's asked to settle that run first; until it has, it is at work.
      const back = yield* connect()
      assert.strictEqual((yield* Effect.promise(() => back.hello(hello(workerId))))?.case, 'hello')
      const reconcile = yield* Effect.promise(() => back.read())
      assert.strictEqual(reconcile?.case === 'reconcile' ? reconcile.value.runId : undefined, runId)
      assert.deepInclude(standing(), { connected: true, busy: true, workspaceId })
      assert.strictEqual(yield* Effect.flip(home.revoke!(workerId)), 'It runs a task. Remove it once that finishes.')
      back.send({
        case: 'exit',
        value: { $typeName: 'althar.worker.v1.AgentRunExit', workerBusy: false, runId, outcome: AgentRunOutcome.STOPPED },
      })
      // The home ends that stream once the run is settled: the workspace is free, and so is the worker.
      assert.isUndefined(yield* Effect.promise(() => back.read()))
      const settled = yield* until(Effect.sync(standing), (worker) => worker?.connected === false)
      assert.deepStrictEqual(settled, { workerId, connected: false, busy: false, providers: [], projectIds: [projectId] })

      // Now it can be taken out, and it stays out: off the list, a fresh read of the ledger included, and refused.
      yield* home.revoke!(workerId)
      assert.isUndefined(standing())
      const listed = yield* Effect.promise(async () => {
        const ledger = await openWorkerStore(paths.profile, homeId, Date.now)
        try {
          return ledger.workers()
        } finally {
          ledger.close()
        }
      })
      assert.deepStrictEqual(listed, [])
      const refused = yield* connect()
      const answer = yield* Effect.promise(() =>
        refused.hello(hello(workerId)).then(
          (frame) => frame?.case,
          (error: unknown) => (error as { code?: number }).code,
        ),
      )
      assert.notStrictEqual(answer, 'hello')
    }),
  ),
)
