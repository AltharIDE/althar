import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Agents, listenLocalApi, Projects, Runtime, Secrets, services } from '@althar/runtime'
import { openWorkerStore } from '@althar/runtime/workerHome'
import { removeTreeSync } from '@althar/testing'
import { assert, it } from '@effect/vitest'
import { Context, Effect, Layer } from 'effect'

import { workerCertificates } from '../../../packages/worker-protocol/integration/worker-certificates'
import { runWorkers, saveFetchedFile } from '../src/workers'

it.live('configures a local worker listener and grants a certificate access to a project on its running home', () =>
  Effect.gen(function* () {
    const root = mkdtempSync(join(tmpdir(), 'althar-cli-worker-'))
    yield* Effect.addFinalizer(() => Effect.sync(() => removeTreeSync(root)))
    const defaults = { profile: join(root, 'profile'), worktrees: join(root, 'worktrees') }
    mkdirSync(defaults.profile, { mode: 0o700 })
    const certificates = workerCertificates(root)
    const run = (...args: string[]) => runWorkers(args, defaults)
    assert.throws(() => run('unknown'))
    assert.throws(() => run('disable', '--worker', 'unused'), /unavailable/)
    assert.throws(() => run('enroll'), /Give --certificate a value/)
    const fetch = [
      'fetch-file',
      '--project',
      'proj_' + '1'.repeat(32),
      '--task',
      'task_' + '2'.repeat(32),
      '--path',
      'out.log',
      '--out',
      join(root, 'out.log'),
    ]
    assert.throws(() => run(...fetch, '--ssh', 'my-vps'), /requires --home/)
    assert.throws(() => run(...fetch, '--profile', defaults.profile, '--ssh', 'my-vps'), /exactly one/)
    assert.throws(() => run(...fetch, '--remote-profile', '/tmp/profile'), /require --ssh/)
    assert.throws(() => run(...fetch, '--thread', 'thr_' + '2'.repeat(32)), /thread ID on its own/)
    assert.throws(() => run('test-copy', '--thread', 'thr_' + '2'.repeat(32), '--into', root), /local test program after --/)
    assert.throws(() => run('configure', '--port', '0'), /Choose a port/)
    assert.include(
      yield* run(
        'configure',
        '--ca',
        certificates('home-ca.pem'),
        '--certificate',
        certificates('home.pem'),
        '--key',
        certificates('home.key'),
      ),
      'Worker listener configured',
    )
    const settings = JSON.parse(readFileSync(join(defaults.profile, 'workers.json'), 'utf8')) as { address: string; port: number }
    assert.strictEqual(settings.address, '127.0.0.1')
    assert.strictEqual(settings.port, 6770)

    const repository = join(root, 'repository')
    execFileSync('git', ['init', '--quiet', '-b', 'main', repository])
    const context = yield* Layer.build(
      services({
        database: join(defaults.profile, 'althar.sqlite'),
        worktreeRoot: defaults.worktrees,
        accountsRoot: join(root, 'accounts'),
        agents: Layer.succeed(Agents, Agents.from([])),
        secrets: Secrets.memory(),
        appVersion: 'test',
        deviceName: 'fixture',
      }),
    )
    const project = yield* Effect.gen(function* () {
      const envelope = yield* Runtime.envelope('project.open', { path: repository })
      return yield* Context.get(context, Projects).open({ path: repository, envelope })
    }).pipe(Effect.provideContext(context))
    const endpoint = yield* listenLocalApi(defaults.profile).pipe(Effect.provideContext(context))
    const enroll = (projectId: string) => run('enroll', '--certificate', certificates('enrolled.pem'), '--project', projectId)
    assert.include((yield* Effect.flip(enroll('proj_' + '9'.repeat(32)))).message, 'project is unavailable')
    const enrollment = JSON.parse(yield* enroll(project.projectId)) as { homeId: string; workerId: string; projectId: string }
    assert.strictEqual(enrollment.homeId, endpoint.homeId)
    assert.strictEqual(enrollment.projectId, project.projectId)
    assert.strictEqual(yield* enroll(project.projectId), JSON.stringify(enrollment))
    const ledger = yield* Effect.acquireRelease(
      Effect.promise(() => openWorkerStore(defaults.profile, endpoint.homeId, Date.now)),
      (ledger) => Effect.sync(() => ledger.close()),
    )
    assert.isTrue(ledger.agents.permits(enrollment.workerId, project.projectId))
    assert.deepStrictEqual(JSON.parse(yield* run('revoke', '--worker', enrollment.workerId, '--project', project.projectId)), {
      workerId: enrollment.workerId,
      projectId: project.projectId,
      revoked: true,
    })
    assert.isFalse(ledger.agents.permits(enrollment.workerId, project.projectId))
    assert.strictEqual(yield* enroll(project.projectId), JSON.stringify(enrollment))
    assert.deepStrictEqual(JSON.parse(yield* run('revoke', '--worker', enrollment.workerId)), {
      workerId: enrollment.workerId,
      revoked: true,
    })
    assert.isFalse(ledger.agents.permits(enrollment.workerId, project.projectId))
    assert.include(yield* run('disable'), 'Worker listener disabled')
    assert.strictEqual(JSON.parse(readFileSync(join(defaults.profile, 'workers.json'), 'utf8')), null)
  }),
)

it.live('saves only verified worker files and leaves an existing local file alone', () =>
  Effect.gen(function* () {
    const root = mkdtempSync(join(tmpdir(), 'althar-cli-worker-file-'))
    yield* Effect.addFinalizer(() => Effect.sync(() => removeTreeSync(root)))
    const path = join(root, 'result.bin')
    const payload = Buffer.from([0, 82, 255, 7])
    const sha256 = createHash('sha256').update(payload).digest('hex')
    const file = { sha256, size: payload.length, bodyBase64: payload.toString('base64') }
    const invalid = yield* Effect.flip(Effect.tryPromise(() => saveFetchedFile(path, { ...file, sha256: '0'.repeat(64) })))
    assert.include(String(invalid.cause), 'verified size and checksum')
    assert.isFalse(existsSync(path))
    const saved = yield* Effect.promise(() => saveFetchedFile(path, file))
    assert.deepStrictEqual(JSON.parse(saved), { path, bytes: file.size, sha256 })
    const exists = yield* Effect.flip(Effect.tryPromise(() => saveFetchedFile(path, file)))
    assert.include(String(exists.cause), 'already exists')
    assert.deepStrictEqual(readFileSync(path), payload)
    assert.deepStrictEqual(readdirSync(root), ['result.bin'])
  }),
)
