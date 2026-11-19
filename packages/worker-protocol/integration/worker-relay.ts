import { deepEqual, equal, rejects } from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { WebSocket } from 'ws'

import { RELAY_CHUNK_LIMIT, RELAY_READY } from '../src/relayProtocol.ts'
import { bindWorkerRelay } from '../src/relayServer.ts'
import { workerCertificates } from './worker-certificates.ts'

const route = (digit: string, expiresAt = Date.now() + 60000) => {
  const home = randomBytes(32).toString('base64url')
  const worker = randomBytes(32).toString('base64url')
  const digest = (value: string) => createHash('sha256').update(value).digest('hex')
  return { home, worker, settings: { id: `wrl_${digit.repeat(32)}`, homeDigest: digest(home), workerDigest: digest(worker), expiresAt } }
}

const fixture = async (routes: ReturnType<typeof route>[]) => {
  const root = mkdtempSync(join(tmpdir(), 'althar-worker-gateway-'))
  try {
    const path = workerCertificates(root, true)
    const ca = readFileSync(path('other-ca.pem'))
    const relay = await bindWorkerRelay({
      host: '127.0.0.1',
      port: 0,
      certificate: readFileSync(path('relay.pem')),
      key: readFileSync(path('relay.key')),
      routes: routes.map((route) => route.settings),
    })
    const socket = (entry: ReturnType<typeof route>, role: 'home' | 'worker', token?: string) =>
      new WebSocket(`wss://localhost:${relay.port}/v1/worker-relay/${entry.settings.id}/${role}`, {
        ca,
        handshakeTimeout: 6000,
        ...(token === undefined ? {} : { headers: { Authorization: `Bearer ${token}` } }),
      })
    return { socket, close: relay.close }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const open = async (ws: WebSocket) => {
  const ready = once(ws, 'message', { signal: AbortSignal.timeout(8000) })
  // A connect failure also ends this pending event wait.
  void ready.catch(() => undefined)
  await once(ws, 'open', { signal: AbortSignal.timeout(8000) })
  return { ws, ready }
}
const checkReady = async (peer: Awaited<ReturnType<typeof open>>) => {
  const [message, binary] = await peer.ready
  deepEqual(message, Buffer.of(RELAY_READY))
  equal(binary, true)
}

void test('pairs only the two authorized roles, isolates routes, and allows reconnect after closure', { timeout: 12000 }, async (t) => {
  const a = route('a')
  const b = route('b')
  const relay = await fixture([a, b])
  t.after(relay.close)
  await rejects(once(relay.socket(a, 'home'), 'open'), /401/)
  await rejects(once(relay.socket(a, 'home', a.worker), 'open'), /401/)
  await rejects(once(relay.socket(a, 'worker', b.worker), 'open'), /401/)
  const aHome = await open(relay.socket(a, 'home', a.home))
  const bWorker = await open(relay.socket(b, 'worker', b.worker))
  await rejects(once(relay.socket(a, 'home', a.home), 'open'), /409/)
  const aWorker = await open(relay.socket(a, 'worker', a.worker))
  await Promise.all([checkReady(aHome), checkReady(aWorker)])
  const input = Buffer.from([22, 3, 3, 9, 0, 117])
  const relayed = once(aHome.ws, 'message', { signal: AbortSignal.timeout(5000) })
  aWorker.ws.send(input)
  deepEqual((await relayed)[0], input)

  // B's first message is its ready signal. A's bytes must stay on A's route.
  const bHome = await open(relay.socket(b, 'home', b.home))
  await Promise.all([checkReady(bHome), checkReady(bWorker)])

  const disconnected = once(aHome.ws, 'close', { signal: AbortSignal.timeout(5000) })
  aWorker.ws.close()
  await disconnected
  const nextHome = await open(relay.socket(a, 'home', a.home))
  const nextWorker = await open(relay.socket(a, 'worker', a.worker))
  await Promise.all([checkReady(nextHome), checkReady(nextWorker)])
  const dropped = once(nextHome.ws, 'close', { signal: AbortSignal.timeout(5000) })
  nextWorker.ws.send(Buffer.alloc(RELAY_CHUNK_LIMIT + 1))
  await dropped
})

void test('expires an attached route and denies the spent credentials', { timeout: 12000 }, async (t) => {
  const a = route('a')
  a.settings.expiresAt = Date.now() + 2000
  const relay = await fixture([a])
  t.after(relay.close)
  const ws = relay.socket(a, 'home', a.home)
  await once(ws, 'open', { signal: AbortSignal.timeout(5000) })
  await once(ws, 'close', { signal: AbortSignal.timeout(5000) })
  await rejects(once(relay.socket(a, 'worker', a.worker), 'open'), /401/)
})

void test('the operator command starts from a private route file and stops on SIGTERM', { timeout: 12000 }, async (t) => {
  const shared = route('a')
  const conflicting = route('b')
  conflicting.settings.workerDigest = shared.settings.homeDigest
  await rejects(fixture([shared, conflicting]), /Invalid worker relay route/)
  const root = mkdtempSync(join(tmpdir(), 'althar-relay-command-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const path = workerCertificates(root, true)
  writeFileSync(path('routes.json'), JSON.stringify([shared.settings]), { mode: 0o600 })
  const script = fileURLToPath(new URL('../relay/main.ts', import.meta.url))
  const child = spawn(process.execPath, [script, '127.0.0.1', '0', path('relay.pem'), path('relay.key'), path('routes.json')], {
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  })
  const lines = createInterface({ input: child.stdout })
  const signal = AbortSignal.timeout(5000)
  const exited = once(child, 'exit', { signal })
  try {
    const [line] = await Promise.race([
      once(lines, 'line', { signal }),
      exited.then(() => {
        throw new Error('The relay exited during startup')
      }),
    ])
    const ready = JSON.parse(line as string) as { state: string; port: number }
    equal(ready.state, 'ready')
    const home = new WebSocket(`wss://localhost:${ready.port}/v1/worker-relay/${shared.settings.id}/home`, {
      ca: readFileSync(path('other-ca.pem')),
      headers: { Authorization: `Bearer ${shared.home}` },
      handshakeTimeout: 5000,
    })
    await once(home, 'open', { signal })
    child.kill('SIGTERM')
    equal((await exited)[0], 0)
  } finally {
    lines.close()
  }
})
