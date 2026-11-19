import { equal, rejects } from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, X509Certificate } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { Client, credentials, status } from '@grpc/grpc-js'
import { workerCertificates } from './worker-certificates.ts'
import { bindWorkerHandshake } from '../src/grpc.ts'
import { MAX_HELLO_BYTES, WorkerControlService } from '../src/index.ts'

const run = promisify(execFile)
const binary = process.platform === 'win32' ? 'worker_grpc.exe' : 'worker_grpc'
const probe = fileURLToPath(new URL(`../../../target/debug/examples/${binary}`, import.meta.url))
const homeId = `home_${'1'.repeat(32)}`
const workerId = `wrk_${'2'.repeat(32)}`
const differentWorker = `wrk_${'3'.repeat(32)}`

void test('the Rust worker negotiates over mTLS only with a matching enrollment', { timeout: 30_000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'althar-worker-grpc-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const path = workerCertificates(root, true)
  const certificate = new X509Certificate(readFileSync(path('enrolled.pem')))
  const fingerprint = createHash('sha256').update(certificate.raw).digest('hex')
  const enrolled = new Map([[fingerprint, workerId]])
  const home = await bindWorkerHandshake('127.0.0.1:0', {
    homeId,
    certificateAuthorityPem: readFileSync(path('home-ca.pem')),
    certificatePem: readFileSync(path('home.pem')),
    privateKeyPem: readFileSync(path('home.key')),
    workerForCertificate: (key) => enrolled.get(key),
  })
  t.after(home.close)
  const connect = (client: string, id = workerId, expectedHome = homeId, ca = 'home-ca') =>
    run(probe, [`https://localhost:${home.port}`, expectedHome, id, path(`${ca}.pem`), path(`${client}.pem`), path(`${client}.key`)], {
      timeout: 10_000,
      maxBuffer: 4096,
    })

  equal((await connect('enrolled')).stdout.trim(), 'Authenticated')
  await rejects(connect('unenrolled'), { stderr: /Unauthenticated/ })
  await rejects(connect('enrolled', differentWorker), { stderr: /PermissionDenied/ })
  await rejects(connect('enrolled', workerId, `home_${'4'.repeat(32)}`), { stderr: /WrongPeer/ })
  await rejects(connect('enrolled', workerId, homeId, 'other-ca'), { stderr: /UnknownIssuer/ })

  const authorityPem = readFileSync(path('home-ca.pem'))
  const enrolledCredentials = credentials.createSsl(authorityPem, readFileSync(path('enrolled.key')), readFileSync(path('enrolled.pem')))
  const transportStatus = async (channel: typeof enrolledCredentials, frame?: Buffer): Promise<status> => {
    const client = new Client(`localhost:${home.port}`, channel)
    try {
      const method = WorkerControlService.method.connect
      const raw = (bytes: Buffer): Buffer => bytes
      const call = client.makeBidiStreamRequest(`/${WorkerControlService.typeName}/${method.name}`, raw, raw, {
        deadline: Date.now() + 5000,
      })
      const result = new Promise<status>((resolve) => {
        call.on('error', () => {})
        call.once('status', (response) => resolve(response.code))
      })
      call.resume()
      if (frame) call.write(frame)
      call.end()
      return await result
    } finally {
      client.close()
    }
  }
  equal(await transportStatus(credentials.createSsl(authorityPem)), status.UNAVAILABLE)
  equal(await transportStatus(enrolledCredentials), status.INVALID_ARGUMENT)
  equal(await transportStatus(enrolledCredentials, Buffer.alloc(MAX_HELLO_BYTES + 1)), status.RESOURCE_EXHAUSTED)

  enrolled.delete(fingerprint)
  await rejects(connect('enrolled'), { stderr: /Unauthenticated/ })
})
