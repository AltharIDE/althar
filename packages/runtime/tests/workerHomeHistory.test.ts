import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { assert, it } from '@effect/vitest'
import { AgentRunOutcome, type AgentRunExit, type AgentWorkerHello } from '@althar/worker-protocol'
import {
  MAX_WORKER_BUNDLE_BYTES,
  MAX_WORKER_HISTORY_BYTES,
  type AgentWorkerPool,
  type WorkerCheckout,
  type WorkerHistory,
} from '@althar/worker-protocol/agent-runs'
import { Effect } from 'effect'

import { testAgentWorker } from '../../worker-protocol/integration/worker-agent-client'
import { workerCertificates } from '../../worker-protocol/integration/worker-certificates'
import { workerExecution } from '../src/workerHome/execution'
import { configureWorkers, listenWorkers, workerCertificate } from '../src/workerHome/network'
import { openWorkerStore } from '../src/workerHome/store'
import { sentWords } from '../src/workerWorkspace'
import { repository } from './support'
import { workerTestDirectory } from './workerTestFiles'

/*
 * A worker that keeps each project's history says in its hello which commits its copy holds, and the home sends it only
 * what those lack: a task's second start on it carries the task's new commits and changes, not the history again.
 */

const homeId = `home_${'1'.repeat(32)}`
const projectId = `proj_${'2'.repeat(32)}`
const otherProject = `proj_${'5'.repeat(32)}`
const journalId = `wjn_${'3'.repeat(32)}`
const known = 'c'.repeat(40)

const hello = (workerId: string, history: Pick<AgentWorkerHello, 'keepsHistory' | 'histories'>): AgentWorkerHello => ({
  $typeName: 'althar.worker.v1.AgentWorkerHello',
  anyProject: false,
  reportsSignIn: false,
  signedIn: [],
  release: '',
  reserveBeforeTransfer: false,
  updatesOnRequest: false,
  version: 1,
  workerId,
  journalId,
  ...history,
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

it.live('reads what history a worker holds from its hello, and takes whole sends only from one that keeps none', () =>
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
      const pool = listener.agentWorkers
      const connect = () =>
        Effect.acquireRelease(
          Effect.sync(() => testAgentWorker(listener.port, certificate)),
          (worker) => Effect.sync(() => worker.close()),
        )
      const histories = [{ $typeName: 'althar.worker.v1.AgentWorkerHistory' as const, projectId, commits: [known] }]

      // Not connected: nothing known.
      assert.isUndefined(pool.history(workerId, projectId))

      // One that keeps history: what it holds of each project, and sends up to 4 GiB.
      const keeping = yield* connect()
      assert.strictEqual((yield* Effect.promise(() => keeping.hello(hello(workerId, { keepsHistory: true, histories }))))?.case, 'hello')
      assert.deepStrictEqual(pool.history(workerId, projectId), { keeps: true, commits: [known], maxBytes: MAX_WORKER_HISTORY_BYTES })
      assert.deepStrictEqual(pool.history(workerId, otherProject), { keeps: true, commits: [], maxBytes: MAX_WORKER_HISTORY_BYTES })
      // A send larger than an older worker takes goes to it.
      const large: WorkerCheckout = {
        size: MAX_WORKER_BUNDLE_BYTES + 1,
        sha256: new Uint8Array(32),
        head: known,
        contents: async function* () {},
      }
      const workspaceId = `ws_${'4'.repeat(32)}`
      const pending = pool.start(workerId, { projectId, workspaceId, providerId: 'codex' }, { checkout: large })
      void pending.catch(() => undefined)
      assert.strictEqual((yield* Effect.promise(() => keeping.read()))?.case, 'start')
      keeping.close()
      yield* Effect.promise(() => pending.then(() => undefined).catch(() => undefined))

      // An older worker keeps none: it is sent whole bundles, no larger than it takes.
      const older = yield* connect()
      assert.strictEqual((yield* Effect.promise(() => older.hello(hello(workerId, { keepsHistory: false, histories: [] }))))?.case, 'hello')
      const told: WorkerHistory | undefined = pool.history(workerId, projectId)
      assert.deepStrictEqual(told, { keeps: false, commits: [], maxBytes: MAX_WORKER_BUNDLE_BYTES })
      older.close()

      // A hello that names what isn't a commit is refused.
      const wrong = yield* connect()
      const refused = yield* Effect.promise(() =>
        wrong
          .hello(
            hello(workerId, {
              keepsHistory: true,
              histories: [{ $typeName: 'althar.worker.v1.AgentWorkerHistory', projectId, commits: ['not a commit'] }],
            }),
          )
          .then(
            (frame) => frame?.case,
            () => 'refused',
          ),
      )
      assert.notStrictEqual(refused, 'hello')
    }),
  ),
)

const stopped: AgentRunExit = {
  $typeName: 'althar.worker.v1.AgentRunExit',
  workerBusy: false,
  runId: 'war_' + '5'.repeat(32),
  outcome: AgentRunOutcome.STOPPED,
}

/** A pool of one worker that says what history it holds and records the checkout it is sent. */
const onePool = (history: WorkerHistory | undefined, sent: Array<WorkerCheckout>, freeDiskMib?: number): AgentWorkerPool => ({
  connect: () => assert.fail('No transport fixture needed'),
  connectPreview: () => assert.fail('No transport fixture needed'),
  connected: () => [],
  openTools: () => undefined,
  history: () => history,
  remove: () => false,
  update: () => false,
  cancelUpdate: () => false,
  updateOf: () => undefined,
  retryUpdate: () => undefined,
  stopRun: () => false,
  list: () => [
    {
      workerId: 'wrk_' + '1'.repeat(32),
      busy: false,
      capabilities: [{ projectId, providerId: 'codex' }],
      ...(freeDiskMib === undefined
        ? {}
        : { capacity: { platform: 'linux', architecture: 'x64', cpuCores: 4, freeMemoryMib: 4096, freeDiskMib } as const }),
    },
  ],
  start: async (_id, _placement, options) => {
    if (options?.checkout !== undefined) sent.push(options.checkout)
    return {
      workspacePath: '/worker/task',
      toolPort: 4517,
      output: new PassThrough(),
      exit: Promise.resolve(stopped),
      write: async () => undefined,
      stop: async () => stopped,
      ownsRun: () => true,
      readPatch: async () => assert.fail('No checkpoint in this test'),
      startCommand: async () => assert.fail('No commands in this test'),
    }
  },
})

it.live('sends a worker that keeps the history only the task’s new commits and changes, and says how much', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const home = repository()
      // History worth leaving out: 2 MB nothing packs smaller.
      writeFileSync(join(home, 'assets.bin'), randomBytes(2 * 1024 * 1024))
      execFileSync('git', ['add', '-A'], { cwd: home })
      execFileSync('git', ['-c', 'user.name=Home', '-c', 'user.email=home@althar.test', 'commit', '-qm', 'History'], { cwd: home })
      const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: home }).toString().trim()
      const input = {
        workerId: 'wrk_' + '1'.repeat(32),
        projectId,
        workspaceId: 'ws_' + '3'.repeat(32),
        providerId: 'codex',
        worktree: home,
        toolPort: 3200,
      }

      // The first start on it: the history goes, and it keeps it.
      const sent: Array<WorkerCheckout> = []
      const first = yield* Effect.scoped(
        workerExecution(() => onePool({ keeps: true, commits: [], maxBytes: MAX_WORKER_HISTORY_BYTES }, sent)).open(input),
      )
      assert.deepInclude(first.sent, { thin: false, keeps: true })
      assert.isAbove(first.sent?.bytes ?? 0, 1024 * 1024)

      // The task moves on; the worker said it holds the commit it started from.
      writeFileSync(join(home, 'README.md'), '# Meridian, again\n')
      execFileSync('git', ['-c', 'user.name=Home', '-c', 'user.email=home@althar.test', 'commit', '-qam', 'Next'], { cwd: home })
      writeFileSync(join(home, 'draft.txt'), 'Not committed\n')
      const second = yield* Effect.scoped(
        workerExecution(() => onePool({ keeps: true, commits: [base], maxBytes: MAX_WORKER_HISTORY_BYTES }, sent)).open(input),
      )
      assert.deepInclude(second.sent, { thin: true, keeps: true })
      assert.isBelow(second.sent?.bytes ?? Infinity, 16 * 1024)
      assert.strictEqual(sent[1]?.size, second.sent?.bytes)
      assert.match(
        sentWords(second.sent!, 'Niko’s box'),
        /^Sent [\d.]+ (KB|bytes) to Niko’s box: only what’s new to the history it keeps\.$/,
      )

      // An older worker, which keeps none, gets the whole history each time.
      const whole = yield* Effect.scoped(workerExecution(() => onePool(undefined, sent)).open(input))
      assert.deepInclude(whole.sent, { thin: false, keeps: false })

      // A worker without room for the send says so before anything goes.
      const full = yield* Effect.flip(
        Effect.scoped(
          workerExecution(() => onePool({ keeps: true, commits: [], maxBytes: MAX_WORKER_HISTORY_BYTES }, sent, 1)).open(input),
        ),
      )
      assert.include(full.reason, 'The worker has 1 MB free')
      assert.include(full.reason, 'Free space on the worker, or run this task on the home.')
    }),
  ),
)
