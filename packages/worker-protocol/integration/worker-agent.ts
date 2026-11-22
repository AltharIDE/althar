import { deepEqual, equal, ok, rejects } from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { setInterval } from 'node:timers/promises'
import { createHash, X509Certificate } from 'node:crypto'
import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import { Client, credentials, status } from '@grpc/grpc-js'
import { makeAgentWorkerPool, runAgentMethod, type AgentRunAssignment } from '../src/agentRuns.ts'
import { agentToolsMethod } from '../src/agentTools.ts'
import { agentPreviewMethod } from '../src/agentPreviews.ts'
import { bindWorkerHandshake, workerCertificateFingerprint } from '../src/grpc.ts'
import {
  AgentHomeFrameSchema,
  AgentPreviewRequestSchema,
  AgentPreviewResponseSchema,
  AgentRunOutcome,
  AgentWorkerFrameSchema,
  AgentWorkspaceSetupResultSchema,
  type AgentPreviewRequest,
  type AgentWorkerFrame,
} from '../src/index.ts'
import { AgentToolsRequestSchema, AgentToolsResponseSchema, type AgentToolsRequest } from '../src/gen/althar/worker/v1/control_pb.ts'
import { workerCertificates } from './worker-certificates.ts'

const homeId = 'home_' + '1'.repeat(32)
const workerId = 'wrk_' + '2'.repeat(32)
const projectId = 'proj_' + '3'.repeat(32)
const workspaceId = 'ws_' + '4'.repeat(32)
const journalId = 'wjn_' + '5'.repeat(32)
const providerId = 'codex'
const placement = { projectId, workspaceId, providerId }

const fixture = async (t: TestContext) => {
  const root = mkdtempSync(join(tmpdir(), 'althar-agent-worker-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const path = workerCertificates(root, true)
  const read = (name: string) => readFileSync(path(name))
  const fingerprint = workerCertificateFingerprint(new X509Certificate(read('enrolled.pem')).raw)
  const enrolled = new Map([[fingerprint, workerId]])
  const outstanding = new Map<string, AgentRunAssignment>()
  const withdrawn = new Set<string>()
  const journals = new Map<string, string>()
  let granted = true
  const pool = makeAgentWorkerPool({
    permits: (id, project) => granted && id === workerId && project === projectId,
    permitsRun: (id, runId) => granted && outstanding.get(id)?.runId === runId && !withdrawn.has(runId),
    bind: (id, bound) => {
      if (!journals.has(id)) journals.set(id, bound)
      return journals.get(id) === bound
    },
    outstanding: (id) => outstanding.get(id),
    begin: (id, run) => {
      if (outstanding.has(id) || [...outstanding.values()].some((current) => current.workspaceId === run.workspaceId)) return false
      outstanding.set(id, run)
      return true
    },
    finish: (id, result) => outstanding.get(id)?.runId === result.runId && outstanding.delete(id),
  })
  const home = await bindWorkerHandshake('127.0.0.1:0', {
    homeId,
    certificateAuthorityPem: read('home-ca.pem'),
    certificatePem: read('home.pem'),
    privateKeyPem: read('home.key'),
    workerForCertificate: (value) => enrolled.get(value),
    agentWorkers: pool,
  })
  t.after(home.close)

  const connect = (name = 'enrolled') => {
    const tls = credentials.createSsl(read('home-ca.pem'), read(name + '.key'), read(name + '.pem'))
    const client = new Client('localhost:' + home.port, tls)
    t.after(() => client.close())
    const { path, requestSerialize, responseDeserialize } = runAgentMethod
    const call = client.makeBidiStreamRequest(path, requestSerialize, responseDeserialize, { deadline: Date.now() + 12_000 })
    const received = call[Symbol.asyncIterator]()
    return {
      call,
      send: (payload: AgentWorkerFrame['payload']) =>
        call.write(Buffer.from(toBinary(AgentWorkerFrameSchema, create(AgentWorkerFrameSchema, { payload })))),
      read: async () => {
        const next = await received.next()
        return next.done === true ? undefined : fromBinary(AgentHomeFrameSchema, next.value).payload
      },
      tools: () => {
        const { path, requestSerialize, responseDeserialize } = agentToolsMethod
        const tools = client.makeBidiStreamRequest(path, requestSerialize, responseDeserialize, { deadline: Date.now() + 12_000 })
        const frames = tools[Symbol.asyncIterator]()
        return {
          send: (payload: AgentToolsRequest['payload']) =>
            tools.write(Buffer.from(toBinary(AgentToolsRequestSchema, create(AgentToolsRequestSchema, { payload })))),
          read: async () => {
            const next = await frames.next()
            return next.done === true ? undefined : fromBinary(AgentToolsResponseSchema, next.value).data
          },
        }
      },
      preview: () => {
        const { path, requestSerialize, responseDeserialize } = agentPreviewMethod
        const call = client.makeBidiStreamRequest(path, requestSerialize, responseDeserialize, { deadline: Date.now() + 12_000 })
        const frames = call[Symbol.asyncIterator]()
        return {
          call,
          send: (payload: AgentPreviewRequest['payload']) =>
            call.write(Buffer.from(toBinary(AgentPreviewRequestSchema, create(AgentPreviewRequestSchema, { payload })))),
          read: async () => {
            const next = await frames.next()
            return next.done === true ? undefined : fromBinary(AgentPreviewResponseSchema, next.value).data
          },
        }
      },
    }
  }
  return {
    pool,
    connect,
    home,
    root,
    path,
    revoke: () => enrolled.delete(fingerprint),
    unassign: () => {
      const run = outstanding.get(workerId)
      if (run !== undefined) withdrawn.add(run.runId)
      granted = false
    },
    reassign: () => {
      granted = true
    },
  }
}

const hello = (id = workerId, journal = journalId, managedCommands = false): AgentWorkerFrame['payload'] => ({
  case: 'hello',
  value: {
    $typeName: 'althar.worker.v1.AgentWorkerHello',
    workerId: id,
    version: 1,
    journalId: journal,
    capabilities: [
      {
        $typeName: 'althar.worker.v1.AgentWorkerCapability',
        projectId,
        providerId,
        workspaceSetup: false,
        managedCommands,
        managedPreview: managedCommands,
      },
    ],
  },
})

void test('the enrolled stream owns one project-scoped agent run and confirms stop', { timeout: 15_000 }, async (t) => {
  const { pool, connect } = await fixture(t)
  const worker = connect()
  worker.send(hello())
  const greeting = await worker.read()
  equal(greeting?.case, 'hello')
  await rejects(pool.start(workerId, placement, { setup: { directory: '', commands: ['true'] } }), /update this worker/i)
  deepEqual(
    pool.list(projectId).map(({ workerId, busy }) => ({ workerId, busy })),
    [{ workerId, busy: false }],
  )
  deepEqual(pool.list('proj_' + '9'.repeat(32)), [])
  await rejects(pool.start(workerId, { ...placement, providerId: 'other' }), /unavailable/)

  const pending = pool.start(workerId, placement)
  await rejects(pool.start(workerId, placement), /already running/)
  const start = await worker.read()
  ok(start?.case === 'start')
  const { runId } = start.value
  equal(start.value.workspaceId, workspaceId)
  worker.send({
    case: 'ready',
    value: { $typeName: 'althar.worker.v1.AgentRunReady', runId, workspacePath: '/private/worker/workspace', toolsPort: 0 },
  })
  const agent = await pending
  equal(agent.workspacePath, '/private/worker/workspace')
  await rejects(
    agent.startCommand({ id: 'proc_' + '6'.repeat(32), directory: '', command: 'true', output: () => undefined }),
    /update this worker/i,
  )
  const input = Buffer.alloc(6000, 65)
  await agent.write(input)
  const chunks = []
  for (const _ of [1, 2, 3]) {
    const frame = await worker.read()
    ok(frame?.case === 'input')
    equal(frame.value.runId, runId)
    chunks.push(frame.value.data)
  }
  deepEqual(Buffer.concat(chunks), input)
  const output = once(agent.output, 'data')
  worker.send({ case: 'output', value: { $typeName: 'althar.worker.v1.AgentRunBytes', runId, data: Buffer.from('agent output') } })
  deepEqual(await output, [Buffer.from('agent output')])

  const stopping = agent.stop()
  const stop = await worker.read()
  ok(stop?.case === 'stop')
  equal(stop.value.runId, runId)
  worker.send({ case: 'exit', value: { $typeName: 'althar.worker.v1.AgentRunExit', runId, outcome: AgentRunOutcome.STOPPED } })
  equal((await stopping).outcome, AgentRunOutcome.STOPPED)
  equal(await worker.read(), undefined)
  deepEqual(pool.list(projectId), [])
})

void test('managed output and stop stay attached to the selected task lease', { timeout: 15_000 }, async (t) => {
  const { pool, connect, unassign } = await fixture(t)
  const worker = connect()
  worker.send(hello(workerId, journalId, true))
  equal((await worker.read())?.case, 'hello')
  const opening = pool.start(workerId, placement)
  const start = await worker.read()
  ok(start?.case === 'start')
  const { runId } = start.value
  worker.send({
    case: 'ready',
    value: { $typeName: 'althar.worker.v1.AgentRunReady', runId, workspacePath: '/private/worker/workspace', toolsPort: 0 },
  })
  const agent = await opening
  const received: string[] = []
  const pending = agent.startCommand({
    id: 'proc_' + '6'.repeat(32),
    directory: 'web app',
    command: 'bun run dev',
    output: (bytes) => {
      received.push(Buffer.from(bytes).toString())
    },
  })
  const command = await worker.read()
  ok(command?.case === 'managedStart' && command.value.managed !== undefined)
  const managed = command.value.managed
  equal(managed.runId, runId)
  equal(command.value.directory, 'web app')
  equal(command.value.command, 'bun run dev')
  worker.send({ case: 'managedReady', value: managed })
  const process = await pending
  worker.send({
    case: 'managedOutput',
    value: { $typeName: 'althar.worker.v1.AgentManagedOutput', managed, data: Buffer.from('Listening') },
  })
  ok(process.preview !== undefined)
  const openingPreview = process.preview(5173)
  const offer = await worker.read()
  ok(offer?.case === 'previewOpen')
  deepEqual(offer.value.managed, managed)
  equal(offer.value.port, 5173)
  const tunnel = worker.preview()
  tunnel.send({ case: 'tunnelId', value: offer.value.tunnelId })
  const duplex = await openingPreview
  duplex.write(Buffer.from('GET / HTTP/1.0\r\n\r\n'))
  equal(Buffer.from((await tunnel.read()) ?? []).toString(), 'GET / HTTP/1.0\r\n\r\n')
  const response = once(duplex, 'data')
  tunnel.send({ case: 'data', value: Buffer.from('HTTP preview') })
  deepEqual(await response, [Buffer.from('HTTP preview')])
  const replay = worker.preview()
  replay.send({ case: 'tunnelId', value: offer.value.tunnelId })
  await rejects(replay.read(), /no active preview/i)
  const tunnelClosed = once(duplex, 'close').catch(() => [])
  const stopping = process.stop()
  const stop = await worker.read()
  ok(stop?.case === 'managedStop')
  deepEqual(stop.value, managed)
  worker.send({ case: 'managedExit', value: { $typeName: 'althar.worker.v1.AgentManagedExit', managed, outcome: AgentRunOutcome.STOPPED } })
  await stopping
  await tunnelClosed
  deepEqual(received, ['Listening'])
  unassign()
  await rejects(
    agent.startCommand({ id: 'proc_' + '7'.repeat(32), directory: '', command: 'true', output: () => undefined }),
    /no longer owns/i,
  )
  worker.send({ case: 'heartbeat', value: { $typeName: 'althar.worker.v1.AgentWorkerHeartbeat', sequence: 1 } })
  equal((await worker.read())?.case, 'stop')
  worker.send({ case: 'exit', value: { $typeName: 'althar.worker.v1.AgentRunExit', runId, outcome: AgentRunOutcome.STOPPED } })
  equal((await agent.exit).outcome, AgentRunOutcome.STOPPED)
})

void test('a claimed identity and a verified but unenrolled certificate cannot open an agent slot', { timeout: 15_000 }, async (t) => {
  const { pool, connect } = await fixture(t)
  const wrong = connect()
  wrong.send(hello('wrk_' + '9'.repeat(32)))
  await rejects(wrong.read(), { code: status.PERMISSION_DENIED })
  const unenrolled = connect('unenrolled')
  unenrolled.send(hello())
  await rejects(unenrolled.read(), { code: status.UNAUTHENTICATED })
  deepEqual(pool.list(projectId), [])
})

void test('revocation withdraws the lease and leaves the in-flight stop unconfirmed', { timeout: 15_000 }, async (t) => {
  const { pool, connect, revoke } = await fixture(t)
  const worker = connect()
  worker.send(hello())
  await worker.read()
  const pending = pool.start(workerId, placement)
  const start = await worker.read()
  ok(start?.case === 'start')
  worker.send({
    case: 'ready',
    value: { $typeName: 'althar.worker.v1.AgentRunReady', runId: start.value.runId, workspacePath: '/private/checkout', toolsPort: 0 },
  })
  const agent = await pending
  equal(agent.ownsRun(), true)
  revoke()
  equal(agent.ownsRun(), false)
  await rejects(agent.write(Buffer.from('new input')), /no longer owns/)
  await rejects(agent.readPatch('a'.repeat(40), 'b'.repeat(40)), /cannot check/)
  const unconfirmed = rejects(agent.exit, /not enrolled/)
  worker.send({ case: 'heartbeat', value: { $typeName: 'althar.worker.v1.AgentWorkerHeartbeat', sequence: 1 } })
  await rejects(worker.read(), { code: status.UNAUTHENTICATED })
  await unconfirmed
  deepEqual(pool.list(projectId), [])
})

void test('withdrawing one project grant rejects new work and lets the enrolled worker confirm stop', { timeout: 15_000 }, async (t) => {
  const { pool, connect, unassign, reassign } = await fixture(t)
  const received: string[] = []
  const toolServer = createTcpServer((socket) => {
    socket.on('data', (data) => {
      received.push(data.toString())
      socket.write(data)
    })
    socket.on('error', () => undefined)
  }).listen(0, '127.0.0.1')
  t.after(() => toolServer.close())
  await once(toolServer, 'listening')
  const worker = connect()
  worker.send(hello())
  await worker.read()
  const pending = pool.start(workerId, placement, { toolPort: (toolServer.address() as AddressInfo).port })
  const start = await worker.read()
  ok(start?.case === 'start')
  const runId = start.value.runId
  worker.send({
    case: 'ready',
    value: { $typeName: 'althar.worker.v1.AgentRunReady', runId, workspacePath: '/private/checkout', toolsPort: 5001 },
  })
  const agent = await pending
  const tunnel = worker.tools()
  tunnel.send({ case: 'runId', value: runId })
  tunnel.send({ case: 'data', value: Buffer.from('granted') })
  equal(Buffer.from((await tunnel.read()) ?? []).toString(), 'granted')
  unassign()
  equal(agent.ownsRun(), false)
  equal(
    pool.openTools(workerId, runId, () => undefined),
    undefined,
  )
  await rejects(pool.start(workerId, placement), /unavailable/)
  reassign()
  equal(agent.ownsRun(), false)
  tunnel.send({ case: 'data', value: Buffer.from('withdrawn') })
  await rejects(tunnel.read(), { code: status.PERMISSION_DENIED })
  deepEqual(received, ['granted'])
  worker.send({ case: 'heartbeat', value: { $typeName: 'althar.worker.v1.AgentWorkerHeartbeat', sequence: 1 } })
  equal((await worker.read())?.case, 'stop')
  worker.send({ case: 'exit', value: { $typeName: 'althar.worker.v1.AgentRunExit', runId, outcome: AgentRunOutcome.STOPPED } })
  equal((await agent.exit).outcome, AgentRunOutcome.STOPPED)
})

const native = fileURLToPath(new URL('../../../target/debug/althar-worker', import.meta.url))

void test(
  'the native guardian completes setup under its lease before it passes ACP bytes',
  { timeout: 15_000, skip: process.platform !== 'linux' },
  async (t) => {
    const { root } = await fixture(t)
    const folder = join(root, 'project folder')
    mkdirSync(folder)
    const child = spawn(
      '/bin/sh',
      [
        '-c',
        'cat | "$@"',
        'setup-test',
        native,
        '--agent-unit-with-setup',
        folder,
        '1',
        'printf staged > setup.log; printf setup-finished',
        '/usr/bin/cat',
      ],
      { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    t.after(() => child.kill())
    const stopped = once(child, 'exit')
    const output = child.stdout[Symbol.asyncIterator]()
    equal((await output.next()).value?.[0], 1)
    const lease = Buffer.alloc(8)
    lease.writeBigUInt64LE(process.hrtime.bigint() / 1_000_000n + 6000n)
    child.stdin.write(lease)
    let setup = Buffer.alloc(0)
    while (setup.length < 2 || setup.length < setup.readUInt16LE(0) + 2) {
      const chunk = await output.next()
      ok(!chunk.done)
      setup = Buffer.concat([setup, chunk.value])
    }
    equal(setup.length, setup.readUInt16LE(0) + 2)
    const result = fromBinary(AgentWorkspaceSetupResultSchema, setup.subarray(2))
    equal(result.exitCode, 0)
    equal(Buffer.from(result.outputTail).toString(), 'setup-finished')
    equal(readFileSync(join(folder, 'setup.log'), 'utf8'), 'staged')
    child.stdin.write(Buffer.from([1, 5, 0, 104, 101, 108, 108, 111]))
    deepEqual((await output.next()).value, Buffer.from('hello'))
    child.stdin.end()
    deepEqual(await stopped, [243, null])
  },
)

void test(
  'the native guardian gives the provider only its ACP data and exits without a lease',
  { timeout: 15_000, skip: process.platform !== 'linux' },
  async (t) => {
    const { root } = await fixture(t)
    // Node uses a socketpair for spawned stdio. The systemd launcher hands the guardian a Linux pipe.
    const child = spawn('/bin/sh', ['-c', 'cat | "$@"', 'agent-test', native, '--agent-unit', '/usr/bin/cat'], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    t.after(() => child.kill())
    const stopped = once(child, 'exit')
    const output = child.stdout[Symbol.asyncIterator]()
    equal((await output.next()).value?.[0], 1)
    // The Linux CLOCK_MONOTONIC and Node's hrtime have the same timebase.
    const lease = Buffer.alloc(8)
    lease.writeBigUInt64LE(process.hrtime.bigint() / 1_000_000n + 6000n)
    child.stdin.write(lease)
    const frame = Buffer.from([1, 5, 0, 104, 101, 108, 108, 111])
    child.stdin.write(frame)
    deepEqual((await output.next()).value, Buffer.from('hello'))
    child.stdin.end()
    deepEqual(await stopped, [243, null])
  },
)

void test(
  'the native worker owns a systemd agent, moves ACP bytes, and accepts a new connection after stop',
  { timeout: 25_000, skip: process.platform !== 'linux' || process.env.ALTHAR_TEST_SYSTEMD !== '1' },
  async (t) => {
    const { root, pool, home, path } = await fixture(t)
    const workspaces = join(root, 'workspaces')
    mkdirSync(workspaces, { mode: 0o700 })
    const repo = join(root, 'repo')
    mkdirSync(repo)
    const git = (...args: string[]) =>
      execFileSync('/usr/bin/git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd: repo })
        .toString()
        .trim()
    git('init', '--quiet', '-b', 'main')
    writeFileSync(join(repo, 'README.md'), 'Home source\n')
    git('add', 'README.md')
    git('commit', '--quiet', '-m', 'Base')
    const head = git('rev-parse', 'HEAD')
    const tree = git('rev-parse', 'HEAD^{tree}')
    const snapshot = git('commit-tree', tree, '-p', head, '-m', 'Snapshot')
    git('update-ref', 'refs/althar/worker-snapshot', snapshot)
    const archive = join(root, 'checkout.bundle')
    git('bundle', 'create', archive, 'refs/althar/worker-snapshot')
    const bundle = readFileSync(archive)
    const checkout = {
      size: bundle.length,
      head,
      sha256: createHash('sha256').update(bundle).digest(),
      contents: async function* () {
        yield bundle
      },
    }
    const provider = join(root, 'agent.sh')
    writeFileSync(provider, '#!/bin/sh\nwhile IFS= read -r line; do printf \'%s\\n\' "$line" >> README.md; cat README.md; done\n', {
      mode: 0o700,
    })
    const previewServer = join(root, 'preview.cjs')
    writeFileSync(
      previewServer,
      `
      const server = require('node:http').createServer((_request, response) => response.end('native preview'));
      server.listen(0, '127.0.0.1', () => require('node:fs').writeFileSync('preview.port', String(server.address().port)));
    `,
    )
    const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`
    const tools = createServer((request, response) => {
      equal(request.headers.authorization, 'Bearer tool-token')
      response.end('home tools')
    })
    tools.listen(0, '127.0.0.1')
    await once(tools, 'listening')
    const toolPort = (tools.address() as AddressInfo).port
    t.after(() => {
      tools.close()
      tools.closeAllConnections()
    })
    const config = join(root, 'agent-config')
    writeFileSync(config, workspaces + '\n' + [projectId, providerId, provider].join('\t') + '\n', { mode: 0o600 })
    const child = spawn(
      native,
      [
        'https://localhost:' + home.port,
        homeId,
        workerId,
        path('home-ca.pem'),
        path('enrolled.pem'),
        path('enrolled.key'),
        join(root, 'journal'),
        '--agent-config',
        config,
        '--watch',
      ],
      { env: { ...process.env, HOME: root }, stdio: ['ignore', 'ignore', 'pipe'] },
    )
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4096)
    })
    t.after(async () => {
      if (child.exitCode !== null || child.signalCode !== null) return
      const done = once(child, 'exit')
      child.kill('SIGTERM')
      await done
    })
    const open = async () => {
      for await (const _ of setInterval(30, undefined, { signal: AbortSignal.timeout(8000) })) {
        if (child.exitCode !== null) throw new Error(stderr)
        if (pool.list(projectId).some((slot) => !slot.busy))
          return pool.start(workerId, placement, {
            checkout,
            toolPort,
            setup: { directory: '', commands: ['printf worker-setup > setup.log', 'printf ready'] },
          })
      }
      throw new Error(stderr || 'The native worker did not connect')
    }

    for (const data of ['first agent', 'next agent']) {
      const agent = await open()
      ok(agent.workspacePath.startsWith(workspaces + '/'))
      equal(agent.setup?.exitCode, 0)
      equal(Buffer.from(agent.setup?.outputTail ?? []).toString(), 'ready')
      equal(readFileSync(join(agent.workspacePath, 'setup.log'), 'utf8'), 'worker-setup')
      equal(existsSync(join(repo, 'setup.log')), false)
      const commandOutput: Buffer[] = []
      const build = await agent.startCommand({
        id: 'proc_' + 'a'.repeat(32),
        directory: '',
        command: "cat setup.log; printf 'build failed' >&2; exit 7",
        output: (bytes) => commandOutput.push(Buffer.from(bytes)),
      })
      equal((await build.exit).exitCode, 7)
      equal(Buffer.concat(commandOutput).toString(), 'worker-setupbuild failed')
      const service = await agent.startCommand({
        id: 'proc_' + 'b'.repeat(32),
        directory: '',
        command: `${quote(process.execPath)} ${quote(previewServer)}`,
        output: () => undefined,
      })
      const note = join(agent.workspacePath, 'preview.port')
      for await (const _ of setInterval(25, undefined, { signal: AbortSignal.timeout(5_000) })) {
        if (existsSync(note) && readFileSync(note, 'utf8') !== '') break
      }
      ok(service.preview !== undefined)
      const socket = await service.preview(Number(readFileSync(note, 'utf8')))
      socket.write('GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n')
      const chunks: Buffer[] = []
      for await (const chunk of socket) chunks.push(Buffer.from(chunk))
      ok(Buffer.concat(chunks).includes('native preview'))
      socket.destroy()
      await service.stop()
      equal((await service.exit).outcome, AgentRunOutcome.STOPPED)
      const echoed = once(agent.output, 'data', { signal: AbortSignal.timeout(8000) })
      await agent.write(Buffer.from(data + '\n'))
      deepEqual(await echoed, [Buffer.from('Home source\n' + data + '\n')])
      const change = await agent.readPatch(tree, head)
      ok(Buffer.from(change.patch).includes('+' + data))
      const response = await fetch('http://127.0.0.1:' + agent.toolPort + '/mcp', {
        headers: { Authorization: 'Bearer tool-token' },
        signal: AbortSignal.timeout(5000),
      })
      equal(await response.text(), 'home tools')
      equal((await agent.stop()).outcome, AgentRunOutcome.STOPPED)
    }
  },
)

void test(
  'a reconnect needs the same journal and a confirmed stop before the workspace can be started again',
  { timeout: 15_000 },
  async (t) => {
    const { pool, connect } = await fixture(t)
    const worker = connect()
    worker.send(hello())
    await worker.read()
    const pending = pool.start(workerId, placement)
    const start = await worker.read()
    ok(start?.case === 'start')
    const { runId } = start.value
    const interrupted = rejects(pending, /closed/)
    worker.call.cancel()
    await interrupted
    const changed = connect()
    changed.send(hello(workerId, 'wjn_' + 'a'.repeat(32)))
    await rejects(changed.read(), { code: status.PERMISSION_DENIED })
    const resumed = connect()
    resumed.send(hello())
    equal((await resumed.read())?.case, 'hello')
    const recovery = await resumed.read()
    ok(recovery?.case === 'reconcile')
    equal(recovery.value.workspaceId, workspaceId)
    equal(recovery.value.runId, runId)
    await rejects(pool.start(workerId, placement), /already running/)
    resumed.send({ case: 'exit', value: { $typeName: 'althar.worker.v1.AgentRunExit', runId, outcome: AgentRunOutcome.STOPPED } })
    equal(await resumed.read(), undefined)
    const reconnected = connect()
    reconnected.send(hello())
    equal((await reconnected.read())?.case, 'hello')
    equal(pool.list(projectId)[0]?.busy, false)
    reconnected.call.cancel()
  },
)
