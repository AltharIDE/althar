import { equal, match, ok, rejects } from 'node:assert/strict'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes, X509Certificate } from 'node:crypto'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import { Client, credentials } from '@grpc/grpc-js'
import { bindWorkerHandshake, workerCertificateFingerprint } from '../src/grpc.ts'
import {
  DiagnosticClaimSchema,
  DiagnosticLogSchema,
  DiagnosticRenewSchema,
  DiagnosticOutcome,
  HomeFrameSchema,
  WorkerControlService,
  WorkerFrameSchema,
  WorkerHelloSchema,
  type HomeFrame,
  type WorkerFrame,
} from '../src/index.ts'
import { workerCertificates } from './worker-certificates.ts'
import { bindWorkerRelay } from '../src/relayServer.ts'

const exec = promisify(execFile)
const bundle = fileURLToPath(new URL('../../../apps/host/dist/althar-host.js', import.meta.url))
const binary = fileURLToPath(new URL('../../../target/debug/althar-worker', import.meta.url))
const pathEnv = '/usr/local/bin:/usr/bin:/bin'
const stop = async (child: ChildProcess, signal: NodeJS.Signals) => {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit', { signal: AbortSignal.timeout(8000) })
    child.kill(signal)
    await exited
  }
}

const waitFor = async (condition: () => boolean | Promise<boolean>, message: string) => {
  const deadline = performance.now() + 8000
  while (!(await condition())) {
    if (performance.now() >= deadline) throw new Error(message)
    await delay(50)
  }
}

const recoverWorker = async (t: TestContext, routed: boolean, projectPilot = false): Promise<void> => {
  const root = mkdtempSync(join(tmpdir(), 'althar-worker-process-'))
  const children: ChildProcess[] = []
  t.after(async () => {
    await Promise.all(children.map((child) => stop(child, 'SIGKILL')))
    rmSync(root, { recursive: true, force: true })
  })
  const path = workerCertificates(root, routed)
  const route = `wrl_${'a'.repeat(32)}`
  const homeToken = randomBytes(32).toString('base64url')
  const workerToken = randomBytes(32).toString('base64url')
  const digest = (value: string) => createHash('sha256').update(value).digest('hex')
  const gateway = routed
    ? await bindWorkerRelay({
        host: '127.0.0.1',
        port: 0,
        certificate: readFileSync(path('relay.pem')),
        key: readFileSync(path('relay.key')),
        routes: [{ id: route, homeDigest: digest(homeToken), workerDigest: digest(workerToken), expiresAt: Date.now() + 60000 }],
      })
    : undefined
  const gatewayUrl = gateway === undefined ? undefined : `wss://localhost:${gateway.port}/v1/worker-relay/${route}`
  if (gateway && gatewayUrl) {
    t.after(gateway.close)
    writeFileSync(path('home-token'), homeToken, { mode: 0o600 })
    writeFileSync(path('worker-token'), workerToken, { mode: 0o600 })
    writeFileSync(
      path('home-link.json'),
      JSON.stringify({ url: `${gatewayUrl}/home`, tokenFile: path('home-token'), caFile: path('other-ca.pem') }),
      { mode: 0o600 },
    )
  }
  const common = ['--profile', path('profile'), '--key-file', path('keys/master'), '--json']
  const env = { HOME: root, PATH: pathEnv }
  const host = async <T = Record<string, string>>(command: string, args: string[] = []) => {
    const result = await exec(process.execPath, [bundle, command, ...common, ...args], { env, timeout: 15000, maxBuffer: 128 * 1024 })
    return JSON.parse(result.stdout) as T
  }
  const start = async () => {
    const child = spawn(process.execPath, [bundle, 'serve', ...common], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    children.push(child)
    let stderr = ''
    child.stderr.on('data', (bytes: Buffer) => {
      stderr = (stderr + bytes.toString()).slice(-8192)
    })
    const lines = createInterface({ input: child.stdout })
    const signal = AbortSignal.timeout(12000)
    try {
      const [line] = await Promise.race([
        once(lines, 'line', { signal }),
        once(child, 'exit', { signal }).then(([code]) => {
          throw new Error(`Home exited ${String(code)}: ${stderr}`)
        }),
      ])
      const ready = JSON.parse(line as string) as { homeId: string; workerPort: number }
      match(ready.homeId, /^home_[a-f0-9]{32}$/)
      equal(typeof ready.workerPort, 'number')
      return { child, ...ready }
    } finally {
      lines.close()
      child.stdout.resume()
    }
  }

  const checkout = path('checkout')
  if (projectPilot) {
    mkdirSync(checkout)
    await exec('/usr/bin/git', ['init', '--quiet', checkout])
  }
  const initialized = await host<{ homeId: string; projects: string[] }>('init', projectPilot ? ['--project', checkout] : [])
  await host('configure-workers', [
    '--listen-port',
    '0',
    '--worker-ca',
    path('home-ca.pem'),
    '--tls-certificate',
    path('home.pem'),
    '--tls-key',
    path('home.key'),
    ...(gateway === undefined ? [] : ['--worker-relay', path('home-link.json')]),
  ])
  const enrolled = await host('enroll-worker', ['--worker-certificate', path('enrolled.pem')])
  const worker = enrolled.workerId ?? ''
  match(worker, /^wrk_[a-f0-9]{32}$/)
  const queue = async () => (await host('worker-run', ['--worker-id', worker])).attemptId ?? ''
  const query = (attempt: string) => host('worker-result', ['--attempt-id', attempt])
  const logs = (attempt: string, offset = 0) => host('worker-log', ['--attempt-id', attempt, '--offset', String(offset)])
  const workerArgs = (home: { workerPort: number; homeId: string }, ca = path('home-ca.pem')) => [
    `https://localhost:${gateway?.port ?? home.workerPort}`,
    home.homeId,
    worker,
    ca,
    path('enrolled.pem'),
    path('enrolled.key'),
    path('journal'),
    ...(gatewayUrl === undefined ? [] : ['--relay', `${gatewayUrl}/worker`, path('worker-token'), path('other-ca.pem')]),
  ]
  const run = (home: { workerPort: number; homeId: string }, ca = path('home-ca.pem'), flags: string[] = []) =>
    exec(binary, [...workerArgs(home, ca), ...flags], { timeout: 15000, maxBuffer: 4096 })
  const first = await start()
  equal(first.homeId, initialized.homeId)
  if (projectPilot) {
    const [projectId] = initialized.projects
    ok(projectId)
    match(projectId, /^proj_[a-f0-9]{32}$/)
    const fixture = path('check.sh')
    writeFileSync(
      fixture,
      [
        'set -eu',
        '/usr/bin/git rev-parse --is-inside-work-tree',
        `test "$1" = 'a spec with $literal values'`,
        '/usr/bin/git diff --check',
        'printf "check stdout\n"',
        'printf "check stderr\n" >&2',
        'if test -f hold; then',
        `  /usr/bin/setsid /bin/sh -c 'trap "" TERM; echo $$ > detached.pid; exec /usr/bin/sleep 600' &`,
        '  wait',
        'fi',
      ].join('\n'),
    )
    const config = path('project-command')
    writeFileSync(config, [projectId, 'check', checkout, '/usr/bin/sh', fixture, 'a spec with $literal values', ''].join('\n'), {
      mode: 0o600,
    })
    const projectFlags = ['--project-config', config]
    const enqueue = async (id = projectId, command = 'check') => {
      const result = await host('worker-project-run', ['--worker-id', worker, '--project-id', id, '--command-name', command])
      ok(result.attemptId)
      return result.attemptId
    }
    await rejects(enqueue(`proj_${'0'.repeat(32)}`), { stderr: /registered on this home/ })

    const completed = await enqueue()
    match(completed, /^wpr_[a-f0-9]{32}$/)
    equal((await run(first)).stdout.trim(), 'No queued diagnostic')
    equal((await query(completed)).state, 'queued')
    match((await run(first, undefined, projectFlags)).stdout, /DIAGNOSTIC_OUTCOME_SUCCEEDED/)
    equal((await query(completed)).state, 'succeeded')
    equal(Buffer.from((await logs(completed)).bytesBase64 ?? '', 'base64').toString(), 'true\ncheck stdout\ncheck stderr\n')
    const unmatched = await enqueue(projectId, 'unregistered')
    match((await run(first, undefined, projectFlags)).stdout, /DIAGNOSTIC_OUTCOME_FAILED/)
    equal((await query(unmatched)).output, 'No matching command is configured on this worker')

    const detached = join(checkout, 'detached.pid')
    writeFileSync(join(checkout, 'hold'), '')
    const running = async (attempt: string) => {
      rmSync(detached, { force: true })
      const child = spawn(binary, [...workerArgs(first), ...projectFlags], { stdio: ['ignore', 'pipe', 'pipe'] })
      children.push(child)
      child.stdout.resume()
      child.stderr.pipe(process.stderr, { end: false })
      const exit = once(child, 'exit', { signal: AbortSignal.timeout(15000) })
      void exit.catch(() => undefined)
      await waitFor(() => existsSync(detached), 'The registered command did not start its detached child')
      const pid = Number(readFileSync(detached, 'utf8'))
      ok(Number.isSafeInteger(pid) && pid > 1)
      const proc = `/proc/${pid}/stat`
      const alive = () => {
        try {
          return !(readFileSync(proc, 'utf8').split(') ')[1] ?? '').startsWith('Z ')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
          throw error
        }
      }
      equal(alive(), true)
      await waitFor(async () => {
        const output = await logs(attempt)
        return (
          output.state === 'claimed' &&
          Buffer.from(output.bytesBase64 ?? '', 'base64')
            .toString()
            .includes('check stderr')
        )
      }, 'Live output was not available while the command was running')
      return { child, exit, alive }
    }

    const cancelled = await enqueue()
    const cancelling = await running(cancelled)
    await host('worker-cancel', ['--attempt-id', cancelled])
    equal((await cancelling.exit)[0], 0)
    equal((await query(cancelled)).state, 'cancelled')
    equal(cancelling.alive(), false)

    const interrupted = await enqueue()
    const crashing = await running(interrupted)
    await stop(crashing.child, 'SIGKILL')
    await waitFor(() => !crashing.alive(), 'The detached process survived the worker crash')
    match((await run(first, undefined, projectFlags)).stdout, /DIAGNOSTIC_OUTCOME_UNKNOWN/)
    equal((await query(interrupted)).state, 'unknown')
    const restarted = await enqueue()
    const previous = await running(restarted)
    await stop(previous.child, 'SIGKILL')
    match((await run(first, undefined, projectFlags)).stdout, /DIAGNOSTIC_OUTCOME_UNKNOWN/)
    equal(previous.alive(), false)
    equal((await query(restarted)).state, 'unknown')
    return
  }
  const completed = await queue()
  if (gateway !== undefined) {
    await rejects(run(first, path('other-ca.pem')))
    equal((await query(completed)).state, 'queued')
  }
  match((await run(first)).stdout, /DIAGNOSTIC_OUTCOME_SUCCEEDED/)
  equal((await query(completed)).output, 'Linux\n')
  equal((await logs(completed)).bytesBase64, Buffer.from('Linux\n').toString('base64'))
  equal((await logs(completed, 2)).bytesBase64, Buffer.from('nux\n').toString('base64'))

  const lost = await queue()
  const tls = credentials.createSsl(
    readFileSync(path('home-ca.pem')),
    readFileSync(path('enrolled.key')),
    readFileSync(path('enrolled.pem')),
  )
  const client = new Client(`127.0.0.1:${first.workerPort}`, tls, { 'grpc.ssl_target_name_override': 'localhost' })
  const method = WorkerControlService.method.connect
  const stream = client.makeBidiStreamRequest<WorkerFrame, HomeFrame>(
    `/${WorkerControlService.typeName}/${method.name}`,
    (frame) => Buffer.from(toBinary(WorkerFrameSchema, frame)),
    (bytes) => fromBinary(HomeFrameSchema, bytes),
    { deadline: Date.now() + 8000 },
  )
  try {
    const frames = stream[Symbol.asyncIterator]()
    stream.write(
      create(WorkerFrameSchema, {
        payload: {
          case: 'hello',
          value: create(WorkerHelloSchema, {
            workerId: worker,
            minVersion: 1,
            maxVersion: 1,
            acceptsDiagnostics: true,
            renewsDiagnosticLease: routed,
            streamsDiagnosticLogs: routed,
          }),
        },
      }),
    )
    const hello = (await frames.next()).value?.payload
    if (hello?.case !== 'hello') throw new Error('Expected authenticated home hello')
    equal(hello.value.supportsDiagnosticLeaseRenewal, routed)
    equal(hello.value.supportsDiagnosticLogs, routed)
    const offered = (await frames.next()).value?.payload
    if (offered?.case !== 'diagnosticOffer') throw new Error('Expected a diagnostic offer')
    equal(offered.value.attemptId, lost)
    stream.write(
      create(WorkerFrameSchema, {
        payload: {
          case: 'diagnosticClaim',
          value: create(DiagnosticClaimSchema, { attemptId: offered.value.attemptId, fence: offered.value.fence }),
        },
      }),
    )
    const started = (await frames.next()).value?.payload
    if (started?.case !== 'diagnosticStart') throw new Error('Expected the durable start grant')
    if (routed) {
      equal(started.value.runForMs <= 2000, true)
      stream.write(
        create(WorkerFrameSchema, {
          payload: {
            case: 'diagnosticLog',
            value: create(DiagnosticLogSchema, {
              attemptId: lost,
              fence: started.value.fence,
              offset: 0,
              output: Buffer.from('partial'),
            }),
          },
        }),
      )
      const renewal = create(WorkerFrameSchema, {
        payload: {
          case: 'diagnosticRenew',
          value: create(DiagnosticRenewSchema, { attemptId: lost, fence: started.value.fence, sequence: 1 }),
        },
      })
      stream.write(renewal)
      const extended = (await frames.next()).value?.payload
      if (extended?.case !== 'diagnosticLease') throw new Error('Expected a renewal on the claiming stream')
      equal(extended.value.sequence, 1)
      equal(extended.value.attemptId, lost)
      equal(extended.value.runForMs > 0 && extended.value.runForMs <= 2000, true)
      stream.write(renewal)
      await rejects(frames.next(), /There is no current execution lease/)
    }
    equal((await query(lost)).state, 'claimed')
    if (routed) {
      const received = await logs(lost)
      equal(received.state, 'claimed')
      equal(received.bytesBase64, Buffer.from('partial').toString('base64'))
    }
    // The grant has left the home, but this fixture deliberately never starts the command.
    await stop(first.child, 'SIGKILL')
  } finally {
    client.close()
  }

  const second = await start()
  equal(second.homeId, first.homeId)
  equal((await query(completed)).output, 'Linux\n')
  match((await run(second)).stdout, /DIAGNOSTIC_OUTCOME_UNKNOWN/)
  equal((await query(lost)).state, 'unknown')
  equal((await logs(lost)).bytesBase64, routed ? Buffer.from('partial').toString('base64') : '')
  equal(existsSync(resolve(path('journal'), `${lost}.started`)), false)
  await host('revoke-worker', ['--worker-id', worker])
  await rejects(run(second), { stderr: /Unauthenticated/ })
  await stop(second.child, 'SIGTERM')
}

void test('the direct worker persists enrollment, outcome, and a lost grant across restart', { timeout: 50000 }, (t) =>
  recoverWorker(t, false),
)
void test('the relayed worker persists enrollment, outcome, and a lost grant across restart', { timeout: 50000 }, (t) =>
  recoverWorker(t, true),
)

void test(
  'a Linux worker runs a registered checkout and stops detached processes on cancel and crash',
  {
    timeout: 60000,
    skip: process.env.ALTHAR_TEST_SYSTEMD !== '1',
  },
  (t) => recoverWorker(t, false, true),
)

void test('the home accepts bounded log chunks only on the stream holding the live grant', { timeout: 20000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'althar-worker-live-log-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const path = workerCertificates(root)
  const workerId = `wrk_${'2'.repeat(32)}`
  const attemptId = `watt_${'3'.repeat(32)}`
  const fence = `wfn_${'4'.repeat(32)}`
  const certificate = readFileSync(path('enrolled.pem'))
  const registered = workerCertificateFingerprint(new X509Certificate(certificate).raw)
  let chunks = 0
  const listener = await bindWorkerHandshake('127.0.0.1:0', {
    homeId: `home_${'1'.repeat(32)}`,
    certificateAuthorityPem: readFileSync(path('home-ca.pem')),
    certificatePem: readFileSync(path('home.pem')),
    privateKeyPem: readFileSync(path('home.key')),
    workerForCertificate: (fingerprint) => (fingerprint === registered ? workerId : undefined),
    diagnostics: {
      next: () => ({ attemptId, fence, claimableForMs: 15_000 }),
      claim: () => 2000,
      renew: () => 2000,
      appendLog: () => {
        chunks += 1
        return true
      },
      complete: () => true,
    },
  })
  t.after(listener.close)
  const tls = credentials.createSsl(readFileSync(path('home-ca.pem')), readFileSync(path('enrolled.key')), certificate)
  const client = new Client(`127.0.0.1:${listener.port}`, tls, { 'grpc.ssl_target_name_override': 'localhost' })
  t.after(() => client.close())
  const method = WorkerControlService.method.connect
  const log = (offset: number, bytes: number) =>
    create(WorkerFrameSchema, {
      payload: { case: 'diagnosticLog', value: create(DiagnosticLogSchema, { attemptId, fence, offset, output: Buffer.alloc(bytes) }) },
    })
  const exchange = async (claim: boolean) => {
    const stream = client.makeBidiStreamRequest<WorkerFrame, HomeFrame>(
      `/${WorkerControlService.typeName}/${method.name}`,
      (frame) => Buffer.from(toBinary(WorkerFrameSchema, frame)),
      (bytes) => fromBinary(HomeFrameSchema, bytes),
      { deadline: Date.now() + 4000 },
    )
    const frames = stream[Symbol.asyncIterator]()
    stream.write(
      create(WorkerFrameSchema, {
        payload: {
          case: 'hello',
          value: create(WorkerHelloSchema, {
            workerId,
            minVersion: 1,
            maxVersion: 1,
            acceptsDiagnostics: true,
            renewsDiagnosticLease: true,
            streamsDiagnosticLogs: true,
          }),
        },
      }),
    )
    equal((await frames.next()).value?.payload.case, 'hello')
    equal((await frames.next()).value?.payload.case, 'diagnosticOffer')
    if (claim) {
      stream.write(
        create(WorkerFrameSchema, {
          payload: { case: 'diagnosticClaim', value: create(DiagnosticClaimSchema, { attemptId, fence }) },
        }),
      )
      equal((await frames.next()).value?.payload.case, 'diagnosticStart')
    }
    return { stream, frames }
  }
  const unclaimed = await exchange(false)
  unclaimed.stream.write(log(0, 1))
  await rejects(unclaimed.frames.next(), /no live grant for diagnostic logs/)
  equal(chunks, 0)

  const oversized = await exchange(true)
  oversized.stream.write(log(0, 257))
  await rejects(oversized.frames.next(), /exceeds its size limit/)
  equal(chunks, 0)

  const bounded = await exchange(true)
  for (let offset = 0; offset < 17; offset += 1) bounded.stream.write(log(offset, 1))
  await rejects(bounded.frames.next(), /exceeds its size limit/)
  equal(chunks, 16)
})

void test('a restarted worker replays its journal after its result could not be committed', { timeout: 30000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'althar-worker-replay-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const path = workerCertificates(root)
  const homeId = `home_${'1'.repeat(32)}`
  const workerId = `wrk_${'2'.repeat(32)}`
  const attemptId = `watt_${'3'.repeat(32)}`
  const fence = `wfn_${'4'.repeat(32)}`
  const certificate = readFileSync(path('enrolled.pem'))
  const registered = workerCertificateFingerprint(new X509Certificate(certificate).raw)
  const journal = path('journal')
  let claims = 0
  let output = ''
  const start = (loseResult: boolean) =>
    bindWorkerHandshake('127.0.0.1:0', {
      homeId,
      certificateAuthorityPem: readFileSync(path('home-ca.pem')),
      certificatePem: readFileSync(path('home.pem')),
      privateKeyPem: readFileSync(path('home.key')),
      workerForCertificate: (value) => (value === registered ? workerId : undefined),
      diagnostics: {
        next: () => ({ attemptId, fence, claimableForMs: claims === 0 ? 15000 : 0 }),
        claim: () => {
          claims++
          return 5000
        },
        complete: (_, result) => {
          equal(result.outcome, DiagnosticOutcome.SUCCEEDED)
          output = Buffer.from(result.output).toString()
          if (loseResult) throw new Error('The home stopped before committing the result')
          return true
        },
      },
    })
  const run = (port: number) =>
    exec(
      binary,
      [`https://localhost:${port}`, homeId, workerId, path('home-ca.pem'), path('enrolled.pem'), path('enrolled.key'), journal],
      { timeout: 10000 },
    )
  const first = await start(true)
  try {
    await rejects(run(first.port), { stderr: /Internal/ })
    equal(output, 'Linux\n')
  } finally {
    first.close()
  }
  const restarted = await start(false)
  try {
    match((await run(restarted.port)).stdout, /DIAGNOSTIC_OUTCOME_SUCCEEDED/)
    equal(output, 'Linux\n')
    equal(claims, 1)
  } finally {
    restarted.close()
  }
})
