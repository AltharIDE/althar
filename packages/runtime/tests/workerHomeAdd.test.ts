import { X509Certificate } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { request } from 'node:https'
import { createServer } from 'node:net'
import { join } from 'node:path'

import { assert, it } from '@effect/vitest'
import { newKey } from '@althar/transport-node'
import type { AgentWorkerHello } from '@althar/worker-protocol'
import { ANY_PROJECT } from '@althar/worker-protocol/agent-runs'
import { Effect, Scope } from 'effect'

import { testAgentWorker } from '../../worker-protocol/integration/worker-agent-client'
import { SERVER_NAME } from '../src/workerHome/authority'
import { workerCodeOf, type WorkerGrant } from '../src/workerHome/codes'
import { workerExecution } from '../src/workerHome/execution'
import { listenWorkers, openWorkers, WORKER_PORT, type WorkerListener } from '../src/workerHome/network'
import { workerTestDirectory } from './workerTestFiles'

/*
 * Adding a worker as the window does it (ADR-103): the home, with no worker configuration, opens its worker port when
 * asked, as its own authority; it signs the worker's own key and names it; the worker reaches it by the name its
 * certificate carries, with only the home's authority trusted, offering its agents for any project; the projects it
 * works on are the ones picked; and a machine without SSH enrolls itself with a one-time code, once.
 */

const homeId = `home_${'1'.repeat(32)}`
const projectId = `proj_${'2'.repeat(32)}`
const journalId = `wjn_${'3'.repeat(32)}`

const hello = (workerId: string): AgentWorkerHello => ({
  $typeName: 'althar.worker.v1.AgentWorkerHello',
  anyProject: true,
  reportsSignIn: true,
  signedIn: ['codex'],
  release: '0.11.0',
  reserveBeforeTransfer: false,
  version: 1,
  workerId,
  journalId,
  capabilities: ['codex', 'claude'].map((providerId) => ({
    $typeName: 'althar.worker.v1.AgentWorkerCapability' as const,
    projectId: ANY_PROJECT,
    providerId,
    workspaceSetup: true,
    managedCommands: true,
    managedPreview: true,
    workspaceSets: true,
    helperAgents: true,
    skillFiles: true,
    helperSkillFiles: true,
    helperCheckouts: true,
    fileReads: true,
    workspaceIndex: true,
  })),
})

/** A worker with the grant the home gave it, reaching the home by the name the home's certificate carries. */
const workerWith = (root: string, grant: WorkerGrant, key: string) => {
  const folder = join(root, grant.workerId)
  mkdirSync(folder, { mode: 0o700 })
  writeFileSync(join(folder, 'home-ca.pem'), grant.authority)
  writeFileSync(join(folder, 'worker.pem'), grant.certificate)
  writeFileSync(join(folder, 'worker.key'), key, { mode: 0o600 })
  return testAgentWorker(grant.port, (file) => join(folder, file), 'worker', 10_000, grant.serverName)
}

/** What the home's enrollment port answers a worker asking with a code, trusting only the authority the code carries. */
const enrollWith = (code: string, publicKey: Buffer) => {
  const read = workerCodeOf(code)
  if (read === undefined) throw new Error('not a code')
  const authority = new X509Certificate(Buffer.from(read.authority, 'base64url')).toString()
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const asked = request(
      {
        host: '127.0.0.1',
        port: read.port,
        method: 'POST',
        path: '/v1/workers/enroll',
        ca: authority,
        servername: SERVER_NAME,
        headers: { 'content-type': 'application/json' },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
          }),
        )
      },
    )
    asked.on('error', reject)
    asked.end(JSON.stringify({ token: read.token, publicKey: publicKey.toString('base64url'), name: 'laptop' }))
  })
}

it.live('opens its worker port when asked, signs a worker’s own key, and takes it for the projects picked', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = workerTestDirectory()
      const paths = { profile: join(root, 'profile'), worktrees: join(root, 'worktrees') }
      mkdirSync(paths.profile, { mode: 0o700 })
      let listener: WorkerListener | undefined
      const scope = yield* Effect.scope
      const home = workerExecution(
        () => listener?.agentWorkers,
        () => listener,
        () =>
          openWorkers(paths, homeId).pipe(
            Effect.tap((opened) => Effect.sync(() => (listener = opened))),
            Scope.provide(scope),
            Effect.mapError((error) => error.message),
          ),
      )
      // Not listening: none, and it says so.
      assert.isNull(home.enrolled?.() ?? null)

      // Asked to add one, it opens its port and signs the worker's key, naming it as the person did.
      const worker = newKey()
      const grant = yield* home.admin!.add({ publicKey: worker.publicKey, name: 'build-box', ssh: 'root@build-box' })
      assert.strictEqual(grant.homeId, homeId)
      assert.strictEqual(grant.serverName, SERVER_NAME)
      assert.match(grant.workerId, /^wrk_[a-f0-9]{32}$/u)
      assert.isTrue(grant.addresses.length > 0)
      assert.deepStrictEqual(JSON.parse(readFileSync(join(paths.profile, 'workers.json'), 'utf8')), { version: 2, port: grant.port })
      const signed = new X509Certificate(grant.certificate)
      assert.isTrue(signed.checkIssued(new X509Certificate(grant.authority)))
      assert.strictEqual(signed.subject, `CN=${grant.workerId}`)
      // The same key again, as a setup picked up again: the same worker.
      assert.strictEqual((yield* home.admin!.add({ publicKey: worker.publicKey, name: 'build-box', ssh: null })).workerId, grant.workerId)

      // It reaches the home by the home's name, trusting only its authority, offering its agents for any project.
      const connected = workerWith(root, grant, worker.key)
      yield* Effect.addFinalizer(() => Effect.sync(() => connected.close()))
      assert.strictEqual((yield* Effect.promise(() => connected.hello(hello(grant.workerId))))?.case, 'hello')
      assert.deepInclude(home.enrolled?.()?.[0], {
        workerId: grant.workerId,
        name: 'build-box',
        ssh: 'root@build-box',
        connected: true,
        signedIn: ['codex'],
        release: '0.11.0',
        anyProject: true,
        projectIds: [],
      })
      // No project picked: it takes no work. Picked, it takes that project's, by its name.
      assert.deepStrictEqual(home.list(projectId), [])
      yield* home.admin!.assign(grant.workerId, [projectId])
      assert.deepInclude(home.list(projectId)[0], { workerId: grant.workerId, name: 'build-box', providers: ['codex', 'claude'] })
      assert.deepStrictEqual(home.list(`proj_${'5'.repeat(32)}`), [])
      yield* home.admin!.assign(grant.workerId, [])
      assert.deepStrictEqual(home.list(projectId), [])
      assert.strictEqual(yield* Effect.flip(home.admin!.assign(grant.workerId, ['not-a-project'])), 'Choose projects of this home')

      // Removed, then added again by the person, with the key it kept: a new worker; the removed one stays out.
      yield* home.revoke!(grant.workerId)
      const again = yield* home.admin!.add({ publicKey: worker.publicKey, name: 'build-box', ssh: 'root@build-box' })
      assert.notStrictEqual(again.workerId, grant.workerId)
      assert.deepStrictEqual(
        home.enrolled?.()?.map((one) => one.workerId),
        [again.workerId],
      )
    }),
  ),
)

it.live('enrolls a machine without SSH with a one-time code, once, and again for a lost reply', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = workerTestDirectory()
      const paths = { profile: join(root, 'profile'), worktrees: join(root, 'worktrees') }
      mkdirSync(paths.profile, { mode: 0o700 })
      const listener = yield* openWorkers(paths, homeId)
      const managed = listener.managed!
      const { code, expiresAt } = yield* Effect.promise(() => managed.code('laptop'))
      assert.isTrue(code.startsWith('althar-worker1.'))
      assert.isTrue(expiresAt > Date.now())
      const read = workerCodeOf(code)!
      assert.strictEqual(read.homeId, homeId)

      const worker = newKey()
      const first = yield* Effect.promise(() => enrollWith(code, worker.publicKey))
      assert.strictEqual(first.status, 200)
      assert.strictEqual(first.body.homeId, homeId)
      assert.strictEqual(first.body.port, listener.port)
      const workerId = first.body.workerId as string
      assert.deepInclude(listener.workers()[0], { workerId, name: 'laptop' })
      // The same worker asking again gets the same; another can't use it.
      const again = yield* Effect.promise(() => enrollWith(code, worker.publicKey))
      assert.strictEqual(again.body.workerId, workerId)
      const other = yield* Effect.promise(() => enrollWith(code, newKey().publicKey))
      assert.strictEqual(other.status, 403)
      assert.strictEqual(other.body.message, 'This code was used by another worker.')
      assert.isUndefined(workerCodeOf('althar-pairing1.abc'))
    }),
  ),
)

it.live('says it adds workers itself only where it is their authority, or takes none yet', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = workerTestDirectory()
      const paths = { profile: join(root, 'profile'), worktrees: join(root, 'worktrees') }
      mkdirSync(paths.profile, { mode: 0o700 })
      let listener: WorkerListener | undefined
      const scope = yield* Effect.scope
      const home = workerExecution(
        () => listener?.agentWorkers,
        () => listener,
        () =>
          openWorkers(paths, homeId).pipe(
            Effect.tap((opened) => Effect.sync(() => (listener = opened))),
            Scope.provide(scope),
            Effect.mapError((error) => error.message),
          ),
      )
      assert.isTrue(home.adds?.())
      yield* home.admin!.code('laptop')
      assert.isTrue(home.adds?.())
      // An operator's own listener: it enrolls by command, and says so.
      const { managed: _managed, ...operators } = listener!
      listener = operators
      assert.isFalse(home.adds?.())
      assert.strictEqual(yield* Effect.flip(home.admin!.code('laptop')), 'This home takes workers by its operator’s certificates.')
    }),
  ),
)

it.live('takes another port where its own is taken, and keeps it for next time', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = workerTestDirectory()
      const paths = { profile: join(root, 'profile'), worktrees: join(root, 'worktrees') }
      mkdirSync(paths.profile, { mode: 0o700 })
      // Its own port held by something else, where nothing holds it already.
      const holder = createServer()
      yield* Effect.promise(
        () => new Promise<void>((resolve) => holder.once('error', () => resolve()).listen(WORKER_PORT, '::', () => resolve())),
      )
      yield* Effect.addFinalizer(() => Effect.sync(() => holder.close()))
      const listener = yield* openWorkers(paths, homeId)
      assert.notStrictEqual(listener.port, WORKER_PORT)
      assert.deepStrictEqual(JSON.parse(readFileSync(join(paths.profile, 'workers.json'), 'utf8')), { version: 2, port: listener.port })
    }),
  ),
)

it.live('listens on another port, for this run, where its kept port is taken at a later start', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = workerTestDirectory()
      const paths = { profile: join(root, 'profile'), worktrees: join(root, 'worktrees') }
      mkdirSync(paths.profile, { mode: 0o700 })
      const first = yield* Effect.scoped(Effect.map(openWorkers(paths, homeId), (listener) => listener.port))
      const holder = createServer()
      yield* Effect.promise(
        () => new Promise<void>((resolve) => holder.once('error', () => resolve()).listen(first, '::', () => resolve())),
      )
      yield* Effect.addFinalizer(() => Effect.sync(() => holder.close()))
      const later = yield* listenWorkers(paths, homeId)
      assert.isDefined(later)
      assert.notStrictEqual(later?.port, first)
      assert.deepStrictEqual(JSON.parse(readFileSync(join(paths.profile, 'workers.json'), 'utf8')), { version: 2, port: first })
    }),
  ),
)
