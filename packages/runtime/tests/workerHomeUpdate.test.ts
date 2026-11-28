import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { assert, it } from '@effect/vitest'
import { until } from '@althar/testing/effect'
import { AgentRunOutcome, AgentWorkerUpdateOutcome, type AgentWorkerHello } from '@althar/worker-protocol'
import { isWorkerBusy, WORKER_UPDATE_LOST, WORKER_UPDATE_UNSUPPORTED, withWorkerUpdateTiming } from '@althar/worker-protocol/agent-runs'
import { Effect } from 'effect'

import { testAgentWorker } from '../../worker-protocol/integration/worker-agent-client'
import { workerCertificates } from '../../worker-protocol/integration/worker-certificates'
import { workerExecution } from '../src/workerHome/execution'
import { configureWorkers, listenWorkers, workerCertificate } from '../src/workerHome/network'
import { openWorkerStore } from '../src/workerHome/store'
import { workerTestDirectory } from './workerTestFiles'

/*
 * A worker asked to update now, through the real listener, its ledger and its
 * pool, with a worker speaking the protocol: asked between runs, it hears it
 * at once and is busy until it says how that went; asked at work, it hears it
 * on its next stream, after its run; back on a new release, its update is
 * done. One that can't be asked (an older worker, or one set up by hand) is
 * refused, or, asked while it was away, failed once it connects.
 */

const homeId = `home_${'1'.repeat(32)}`
const projectId = `proj_${'2'.repeat(32)}`
const workspaceId = `ws_${'4'.repeat(32)}`
const journalId = `wjn_${'3'.repeat(32)}`

const hello = (workerId: string, release: string, updatesOnRequest = true): AgentWorkerHello => ({
  $typeName: 'althar.worker.v1.AgentWorkerHello',
  anyProject: false,
  reportsSignIn: false,
  signedIn: [],
  release,
  updatesOnRequest,
  reserveBeforeTransfer: false,
  keepsHistory: false,
  histories: [],
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

const said = (outcome: AgentWorkerUpdateOutcome, more: { version?: string; message?: string } = {}) => ({
  case: 'updateState' as const,
  value: {
    $typeName: 'althar.worker.v1.AgentWorkerUpdateState' as const,
    outcome,
    version: more.version ?? '',
    message: more.message ?? '',
  },
})

/** A home listening for workers, with one enrolled, and a way to connect it. */
const aHome = Effect.gen(function* () {
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
  return { workerId, listener, home, connect, standing }
})

it.live('asks an idle worker at once, keeps work off it while it updates, and is done when it comes back on a new release', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { workerId, listener, home, connect, standing } = yield* aHome
      const worker = yield* connect()
      assert.strictEqual((yield* Effect.promise(() => worker.hello(hello(workerId, '0.3.0'))))?.case, 'hello')
      assert.deepInclude(standing(), { connected: true, busy: false, release: '0.3.0', updatesOnRequest: true })

      yield* home.update!(workerId)
      assert.strictEqual((yield* Effect.promise(() => worker.read()))?.case, 'update')
      // Told, it takes no task until it says how its update went: not offered, and a start there is refused as busy.
      assert.deepInclude(standing(), { busy: true, update: { state: 'started' } })
      assert.isTrue(listener.agentWorkers.list(projectId)[0]?.busy)
      const refused = yield* Effect.promise(() =>
        listener.agentWorkers.start(workerId, { projectId, workspaceId, providerId: 'codex' }).then(
          () => undefined,
          (error: unknown) => error,
        ),
      )
      assert.isTrue(isWorkerBusy(refused))
      // Asked again meanwhile, it isn't told twice; and told, it can't be taken back.
      yield* home.update!(workerId)
      assert.strictEqual(yield* Effect.flip(home.cancelUpdate!(workerId)), 'Its update has started already, or wasn’t asked for.')

      worker.send(said(AgentWorkerUpdateOutcome.STARTED))
      yield* until(Effect.sync(standing), (one) => one?.update?.state === 'started')
      // Its updater restarts it: the stream drops, and it comes back on its new release.
      worker.close()
      yield* until(Effect.sync(standing), (one) => one?.connected === false)
      assert.deepInclude(standing(), { update: { state: 'started' } })
      const back = yield* connect()
      assert.strictEqual((yield* Effect.promise(() => back.hello(hello(workerId, '0.3.1'))))?.case, 'hello')
      assert.deepInclude(standing(), { connected: true, busy: false, release: '0.3.1', update: { state: 'done', version: '0.3.1' } })
    }),
  ),
)

it.live('asks a worker at work once its run ends, on its next stream, and says what its updater found', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { workerId, listener, home, connect, standing } = yield* aHome
      const worker = yield* connect()
      assert.strictEqual((yield* Effect.promise(() => worker.hello(hello(workerId, '0.3.0'))))?.case, 'hello')
      const pending = listener.agentWorkers.start(workerId, { projectId, workspaceId, providerId: 'codex' })
      const started = yield* Effect.promise(() => worker.read())
      if (started?.case !== 'start') return yield* Effect.die('The home did not start the run')

      // At work: asked, but nothing reaches it on this stream; the run ends it.
      yield* home.update!(workerId)
      assert.deepInclude(standing(), { busy: true, update: { state: 'asked' } })
      // Not told yet, it can still be taken back; asked again, it is.
      yield* home.cancelUpdate!(workerId)
      assert.notProperty(standing(), 'update')
      yield* home.update!(workerId)
      worker.send({
        case: 'exit',
        value: {
          $typeName: 'althar.worker.v1.AgentRunExit',
          problem: '',
          workerBusy: false,
          runId: started.value.runId,
          outcome: AgentRunOutcome.STOPPED,
        },
      })
      yield* Effect.promise(() => pending.then(() => undefined).catch(() => undefined))
      assert.isUndefined(yield* Effect.promise(() => worker.read()))

      // Its next stream is between runs: asked there, it finds nothing newer, and is free again.
      const next = yield* connect()
      assert.strictEqual((yield* Effect.promise(() => next.hello(hello(workerId, '0.3.0'))))?.case, 'hello')
      assert.strictEqual((yield* Effect.promise(() => next.read()))?.case, 'update')
      next.send(said(AgentWorkerUpdateOutcome.CURRENT, { version: '0.3.0' }))
      const current = yield* until(Effect.sync(standing), (one) => one?.update?.state === 'current')
      assert.deepInclude(current, { busy: false, update: { state: 'current', version: '0.3.0' } })

      // Asked again, its updater fails, in its own words.
      yield* home.update!(workerId)
      assert.strictEqual((yield* Effect.promise(() => next.read()))?.case, 'update')
      next.send(said(AgentWorkerUpdateOutcome.FAILED, { message: '  No space left on device  ' }))
      const failed = yield* until(Effect.sync(standing), (one) => one?.update?.state === 'failed')
      assert.deepInclude(failed, { busy: false, update: { state: 'failed', message: 'No space left on device' } })
    }),
  ),
)

it.live('asks one waiting on its own work again on the same healthy stream, sooner the first times', () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.sync(() => withWorkerUpdateTiming({ retryMs: 40, retryMaxMs: 60 })),
        (restore) => Effect.sync(restore),
      )
      const { workerId, home, connect, standing } = yield* aHome
      const worker = yield* connect()
      assert.strictEqual((yield* Effect.promise(() => worker.hello(hello(workerId, '0.3.0'))))?.case, 'hello')
      yield* home.update!(workerId)
      assert.strictEqual((yield* Effect.promise(() => worker.read()))?.case, 'update')
      // Something of its own runs: waiting, free for the home's tasks meanwhile, and said so for the window.
      worker.send(said(AgentWorkerUpdateOutcome.WAITING, { version: '0.3.1' }))
      const waiting = yield* until(Effect.sync(standing), (one) => one?.update?.state === 'waiting')
      assert.deepInclude(waiting, { connected: true, busy: false })
      // Nothing else happens on its stream, and still it's told again.
      assert.strictEqual((yield* Effect.promise(() => worker.read()))?.case, 'update')
      worker.send(said(AgentWorkerUpdateOutcome.WAITING))
      assert.strictEqual((yield* Effect.promise(() => worker.read()))?.case, 'update')
      worker.send(said(AgentWorkerUpdateOutcome.CURRENT, { version: '0.3.0' }))
      yield* until(Effect.sync(standing), (one) => one?.update?.state === 'current')
    }),
  ),
)

it.live('tells no worker the home holds for a task, until it lets go of it', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { workerId, home, connect, standing } = yield* aHome
      const worker = yield* connect()
      assert.strictEqual((yield* Effect.promise(() => worker.hello(hello(workerId, '0.3.0'))))?.case, 'hello')
      // Reserved for a start, its workspace on its way: asked, not told.
      const release = home.reserve!(workerId, workspaceId)
      if (release === undefined) return yield* Effect.die('The worker could not be reserved')
      yield* home.update!(workerId)
      assert.deepInclude(standing(), { update: { state: 'asked' } })
      // Let go without a run: told now.
      release()
      assert.strictEqual((yield* Effect.promise(() => worker.read()))?.case, 'update')
      assert.deepInclude(standing(), { busy: true, update: { state: 'started' } })
    }),
  ),
)

it.live('fails one told to update that never comes back, once its time is up', () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.sync(() => withWorkerUpdateTiming({ returnMs: 30 })),
        (restore) => Effect.sync(restore),
      )
      const { workerId, home, connect, standing } = yield* aHome
      const worker = yield* connect()
      assert.strictEqual((yield* Effect.promise(() => worker.hello(hello(workerId, '0.3.0'))))?.case, 'hello')
      yield* home.update!(workerId)
      assert.strictEqual((yield* Effect.promise(() => worker.read()))?.case, 'update')
      worker.send(said(AgentWorkerUpdateOutcome.STARTED))
      worker.close()
      yield* until(Effect.sync(standing), (one) => one?.connected === false)
      const lost = yield* until(Effect.sync(standing), (one) => one?.update?.state === 'failed')
      assert.deepInclude(lost, { update: { state: 'failed', message: WORKER_UPDATE_LOST } })
    }),
  ),
)

it.live('refuses a worker that can’t be asked, fails one asked while away that can’t, and takes back one not started', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { workerId, home, connect, standing } = yield* aHome

      // Away: asked, then taken back before it connects.
      yield* home.update!(workerId)
      assert.deepInclude(standing(), { connected: false, update: { state: 'asked' } })
      yield* home.cancelUpdate!(workerId)
      assert.notProperty(standing(), 'update')
      assert.strictEqual(yield* Effect.flip(home.cancelUpdate!(workerId)), 'Its update has started already, or wasn’t asked for.')

      // Asked while away, it connects as an older worker that can't be asked: failed, and said why; never sent a frame it
      // doesn't know.
      yield* home.update!(workerId)
      const older = yield* connect()
      assert.strictEqual((yield* Effect.promise(() => older.hello(hello(workerId, '0.2.2', false))))?.case, 'hello')
      assert.deepInclude(standing(), { connected: true, busy: false, update: { state: 'failed', message: WORKER_UPDATE_UNSUPPORTED } })
      assert.notProperty(standing(), 'updatesOnRequest')
      // Connected, it's refused at once.
      assert.strictEqual(yield* Effect.flip(home.update!(workerId)), WORKER_UPDATE_UNSUPPORTED)
      assert.strictEqual(yield* Effect.flip(home.update!(`wrk_${'9'.repeat(32)}`)), 'This home has no such worker.')
    }),
  ),
)
