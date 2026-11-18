import { equal, match, rejects } from 'node:assert/strict'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import { Client, credentials } from '@grpc/grpc-js'
import { bindWorkerHandshake, workerCertificateFingerprint } from '../src/grpc.ts'
import {
  DiagnosticClaimSchema,
  DiagnosticOutcome,
  HomeFrameSchema,
  WorkerControlService,
  WorkerFrameSchema,
  WorkerHelloSchema,
  type HomeFrame,
  type WorkerFrame,
} from '../src/index.ts'
import { workerCertificates } from './worker-certificates.ts'

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

void test('the built home and worker persist enrollment, outcome, and a lost start grant across restart', { timeout: 45000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'althar-worker-process-'))
  const children: ChildProcess[] = []
  t.after(async () => {
    await Promise.all(children.map((child) => stop(child, 'SIGKILL')))
    rmSync(root, { recursive: true, force: true })
  })
  const path = workerCertificates(root)
  const common = ['--profile', path('profile'), '--key-file', path('keys/master'), '--json']
  const env = { HOME: root, PATH: pathEnv }
  const host = async (command: string, args: string[] = []) => {
    const result = await exec(process.execPath, [bundle, command, ...common, ...args], { env, timeout: 15000, maxBuffer: 128 * 1024 })
    return JSON.parse(result.stdout) as Record<string, string>
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

  const initialized = await host('init')
  await host('configure-workers', [
    '--listen-port',
    '0',
    '--worker-ca',
    path('home-ca.pem'),
    '--tls-certificate',
    path('home.pem'),
    '--tls-key',
    path('home.key'),
  ])
  const enrolled = await host('enroll-worker', ['--worker-certificate', path('enrolled.pem')])
  const worker = enrolled.workerId ?? ''
  match(worker, /^wrk_[a-f0-9]{32}$/)
  const queue = async () => (await host('worker-run', ['--worker-id', worker])).attemptId ?? ''
  const query = (attempt: string) => host('worker-result', ['--attempt-id', attempt])
  const run = (home: { workerPort: number; homeId: string }, journal = path('journal')) =>
    exec(
      binary,
      [
        `https://localhost:${home.workerPort}`,
        home.homeId,
        worker,
        path('home-ca.pem'),
        path('enrolled.pem'),
        path('enrolled.key'),
        journal,
      ],
      {
        timeout: 10000,
        maxBuffer: 4096,
      },
    )
  const first = await start()
  equal(first.homeId, initialized.homeId)
  const completed = await queue()
  match((await run(first)).stdout, /DIAGNOSTIC_OUTCOME_SUCCEEDED/)
  equal((await query(completed)).output, 'Linux\n')

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
          value: create(WorkerHelloSchema, { workerId: worker, minVersion: 1, maxVersion: 1, acceptsDiagnostics: true }),
        },
      }),
    )
    equal((await frames.next()).value?.payload.case, 'hello')
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
    equal((await query(lost)).state, 'claimed')
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
  equal(existsSync(resolve(path('journal'), `${lost}.started`)), false)
  await host('revoke-worker', ['--worker-id', worker])
  await rejects(run(second), { stderr: /Unauthenticated/ })
  await stop(second.child, 'SIGTERM')
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
