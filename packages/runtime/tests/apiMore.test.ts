import { createHash, randomBytes } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { Duplex, PassThrough, Readable, Writable } from 'node:stream'
import { once } from 'node:events'
import { MessageChannel } from 'node:worker_threads'

import { Api, clientProtocol, emitterPort, type ClientIdentity, type ThreadSnapshot } from '@althar/contracts'
import { AgentRequestFailed, agents as registry } from '@althar/provider-adapters'
import { fakeAgentMain, scenarios } from '@althar/provider-adapters/testing'
import { createDeviceKey } from '@althar/transport-node'
import { AgentRunOutcome, type AgentManagedExit } from '@althar/worker-protocol'
import { assert, describe, it } from '@effect/vitest'
import { Context, Deferred, Duration, Effect, Fiber, Layer, Stream } from 'effect'
import { RpcClient } from 'effect/rpc'
import { until } from '@althar/testing/effect'

import { connection, services } from '../src/Api'
import { text } from '../src/api/plans'
import { type AgentEntry, Agents, type RuntimeOptions } from '../src/Config'
import { ClientIdentities } from '../src/ClientIdentities'
import { Instance } from '../src/Instance'
import { Folders } from '../src/Folders'
import { git as gitOf, treeOf, untouched } from '../src/git'
import { Helpers } from '../src/Helpers'
import { Secrets } from '../src/Secrets'
import type { ToolAccess } from '../src/ToolServer'
import type { WorkerExecution } from '../src/workerExecution'

import { callTool, fakeAgents, fakeConnectors, repository, ROOMY } from './support'

/*
 * More of the API, as the app's window has it: an agent Althar can download
 * for the person, a task of several repositories opened in an editor, and a
 * question the coordinator asks, answered from the window.
 */

const commandId = () => `cmd_${randomBytes(16).toString('hex')}`

const connected = (
  options: {
    readonly agents?: Layer.Layer<Agents>
    readonly editors?: RuntimeOptions['editors']
    readonly workers?: RuntimeOptions['workers']
    readonly countdown?: Duration.Duration
  } = {},
) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      services({
        database: ':memory:',
        worktreeRoot: mkdtempSync(join(tmpdir(), 'althar-worktrees-')),
        appVersion: '0.0.0-test',
        deviceName: 'Test Mac',
        agents: options.agents ?? fakeAgents(),
        secrets: Secrets.memory(),
        connectors: fakeConnectors({}),
        accountsRoot: mkdtempSync(join(tmpdir(), 'althar-accounts-')),
        agentsRoot: mkdtempSync(join(tmpdir(), 'althar-agents-')),
        busy: { machine: ROOMY },
        checksAppear: Duration.zero,
        ...(options.countdown === undefined ? {} : { countdown: options.countdown }),
        ...(options.workers === undefined ? {} : { workers: options.workers }),
        ...(options.editors === undefined ? {} : { editors: options.editors }),
      }),
    )
    const connect = (kind: 'window' | 'socket', identity?: ClientIdentity) =>
      Effect.gen(function* () {
        const channel = new MessageChannel()
        yield* Effect.addFinalizer(() => Effect.sync(() => channel.port1.close()))
        yield* Effect.forkScoped(
          Layer.launch(
            connection(
              emitterPort(channel.port1, (data) => data),
              { kind },
              identity,
            ),
          ).pipe(Effect.provideContext(context)),
        )
        const protocol = yield* Layer.build(clientProtocol(emitterPort(channel.port2, (data) => data)))
        return yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
      })
    const client = yield* connect('window')
    const grant = (path: string) => Context.get(context, Folders).allow(path)
    const separateDevice = Effect.gen(function* () {
      const keys = yield* createDeviceKey
      const paired = yield* Context.get(context, ClientIdentities).register({
        role: 'socket',
        publicKey: keys.publicKey,
        name: 'Another desktop',
      })
      const instance = Context.get(context, Instance)
      return yield* connect('socket', { homeId: instance.homeId, actorId: instance.personId, deviceId: paired.deviceId, role: 'socket' })
    })
    return { client, grant, connect, separateDevice, helpers: Context.get(context, Helpers), context }
  })

const idle = (thread: { readonly session: ThreadSnapshot['session'] }) =>
  thread.session !== null && !thread.session.turnRunning && thread.session.turnEndedAt !== null

/** What a worker's own check found where it can take a task: its sandbox starts, it has git, and its agents started there. */
const READY = {
  sandbox: { starts: true as const },
  tools: [{ name: 'git', version: '2.43.0' }],
  models: [],
  agents: [
    { providerId: 'codex', starts: true },
    { providerId: 'claude-code', starts: true },
  ],
}

const openFakeWorker = (cwd: string) =>
  Effect.gen(function* () {
    const child = spawn('bun', [fakeAgentMain], { cwd, stdio: ['pipe', 'pipe', 'ignore'] })
    const exited = once(child, 'exit')
    const stop = Effect.promise(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill()
      await exited
    })
    yield* Effect.addFinalizer(() => stop)
    return {
      _tag: 'Remote',
      stdin: Writable.toWeb(child.stdin),
      stdout: Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      exited: Effect.promise(() => exited.then(([code, signal]) => ({ code: code as number | null, signal: signal as string | null }))),
      stop,
    } satisfies WorkerExecution['transport']
  })

/** A folder holding a repository for each name, as a project of several opens from. */
const folderWith = (names: ReadonlyArray<string>) => {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'althar-folder-')))
  for (const name of names) {
    const path = join(folder, name)
    mkdirSync(path)
    const git = (...args: Array<string>) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd: path })
    git('init', '-q', '-b', 'main')
    writeFileSync(join(path, 'README.md'), `# ${name}\n`)
    git('add', '.')
    git('commit', '-q', '-m', 'Start')
  }
  return folder
}

describe('an agent Althar can download, through the API', () => {
  it.live('says how large its download is, and that none is under way', () => {
    // The fake agent, with OpenCode's command and its release to download.
    const downloadable = Layer.effect(
      Agents,
      Effect.gen(function* () {
        const fakes = yield* Agents
        const changed = (entry: AgentEntry): AgentEntry =>
          entry.definition.id === 'opencode'
            ? {
                ...entry,
                definition: { ...entry.definition, ...(registry.opencode.cli === undefined ? {} : { cli: registry.opencode.cli }) },
              }
            : entry
        return Agents.of({ list: fakes.list.map(changed), get: (id) => Effect.map(fakes.get(id), changed) })
      }),
    ).pipe(Layer.provide(fakeAgents()))
    return Effect.scoped(
      Effect.gen(function* () {
        const { client } = yield* connected({ agents: downloadable })
        const status = yield* client.Status({})
        const opencode = status.agents.find((agent) => agent.id === 'opencode')
        assert.deepStrictEqual(opencode?.download, { size: registry.opencode.cli?.download?.size ?? '', installing: false, pinned: null })
        assert.isFalse(opencode?.kept)
        // One without a command of its own to download offers none.
        assert.isNull(status.agents.find((agent) => agent.id === 'codex')?.download)
      }),
    )
  })
})

describe('a task of several repositories, through the API', () => {
  it.live('starts in the repositories named, and opens in an editor on the folder that holds its worktrees', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const opens: Array<[string, string, string | null, number | null]> = []
        const { client, grant } = yield* connected({
          editors: {
            list: () => [{ id: 'zed', name: 'Zed' }],
            open: (editor, folder, file, line) => Effect.sync(() => void opens.push([editor, folder, file, line])).pipe(Effect.as(true)),
          },
        })
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(folderWith(['api', 'web'])) })
        const both = yield* client.CreateTask({
          commandId: commandId(),
          projectId: project.id,
          title: 'Rename the route',
          repositories: ['api', 'web'],
        })
        assert.isTrue(
          yield* client.OpenInEditor({ commandId: commandId(), taskId: both.id, editor: 'zed', path: 'web/README.md', line: 1 }),
        )
        const [opened] = opens
        assert.strictEqual(opened?.[1], dirname(dirname(opened?.[2] ?? '')))
        assert.strictEqual(opened?.[2], join(opened?.[1] ?? '', 'web', 'README.md'))
        // A task started at once in one of them, by the person.
        const one = yield* client.StartTask({
          commandId: commandId(),
          projectId: project.id,
          title: 'Fix the API',
          description: '[lead:finish]',
          repositories: ['api'],
          steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
        })
        assert.strictEqual(one.title, 'Fix the API')
        // One with no worktree here isn't there to open.
        assert.strictEqual(
          (yield* Effect.flip(client.OpenInEditor({ commandId: commandId(), taskId: 'task_gone', editor: 'zed' }))).message,
          "That thing isn't there any more.",
        )
      }),
    ),
  )
})

describe('a file moved in one of a task’s several repositories, through the API', () => {
  it.live('is listed and read under its repository, with where it was', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant } = yield* connected()
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(folderWith(['api', 'web'])) })
        const task = yield* client.CreateTask({
          commandId: commandId(),
          projectId: project.id,
          title: 'Move the docs',
          repositories: ['api', 'web'],
        })
        const holder = (yield* client.GetThread({ threadId: task.threadId })).task.worktree ?? ''
        const web = [join(holder, 'web'), join(dirname(holder), 'web')].find((path) => {
          try {
            execFileSync('git', ['rev-parse'], { cwd: path, stdio: 'ignore' })
            return true
          } catch {
            return false
          }
        })
        execFileSync('git', ['mv', 'README.md', 'DOCS.md'], { cwd: web ?? '' })
        const files = (yield* client.GetThread({ threadId: task.threadId, fresh: true })).task.files
        const moved = files.find((file) => file.status === 'renamed')
        assert.deepInclude(moved, { path: 'web/DOCS.md', from: 'web/README.md' })
        const diff = yield* client.GetFileDiff({ taskId: task.id, path: 'web/DOCS.md' })
        assert.deepInclude(diff.file, { path: 'web/DOCS.md', from: 'web/README.md', status: 'renamed' })
      }),
    ),
  )
})

describe('an issue card’s Always file at once and Always ask first, through the API', () => {
  it.live('say it to the coordinator as the person, for it to keep as a note', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant } = yield* connected()
        const path = folderWith(['api'])
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(join(path, 'api')) })
        const { threadId } = yield* client.GetCoordinator({ projectId: project.id })
        yield* client.PreferIssueCards({ commandId: commandId(), threadId, atOnce: true })
        yield* client.PreferIssueCards({ commandId: commandId(), threadId, atOnce: false })
        const said = yield* until(
          client.GetCoordinator({ projectId: project.id }),
          (snapshot) => snapshot.items.filter((item) => item.kind === 'user_message').length >= 2,
        )
        assert.deepStrictEqual(said.items.flatMap((item) => (item.kind === 'user_message' ? [item.content.text] : [])).slice(0, 2), [
          text.issuesAtOnce,
          text.issuesAskFirst,
        ])
      }),
    ),
  )
})

describe('the coordinator’s question, through the API', () => {
  it.live('is answered from the window, and the coordinator that asked hears it', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant } = yield* connected()
        const path = folderWith(['api'])
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(join(path, 'api')) })
        const { threadId } = yield* client.GetCoordinator({ projectId: project.id })
        // Its first turn reads its brief; the next asks.
        yield* client.Send({ commandId: commandId(), threadId, body: 'Hello.', disposition: 'after_current' })
        yield* until(client.GetCoordinator({ projectId: project.id }), idle)
        yield* client.Send({ commandId: commandId(), threadId, body: scenarios.questions, disposition: 'after_current' })
        const asking = yield* until(client.GetCoordinator({ projectId: project.id }), (snapshot) =>
          snapshot.items.some((item) => item.kind === 'question' && item.content.state === 'open'),
        )
        const question = asking.items.find((item) => item.kind === 'question')
        const fields = question?.kind === 'question' ? question.content.fields : []
        yield* client.AnswerQuestion({
          commandId: commandId(),
          attentionId: question?.kind === 'question' ? question.content.attentionId : '',
          answers: Object.fromEntries(fields.map((field) => [field.id, { values: [field.options[0]?.value ?? ''] }])),
        })
        const answered = yield* until(
          client.GetCoordinator({ projectId: project.id }),
          (snapshot) => idle(snapshot) && snapshot.items.some((item) => item.kind === 'question' && item.content.state === 'answered'),
        )
        assert.isTrue(
          answered.items.some((item) => item.kind === 'agent_message' && item.content.text.includes(fields[0]?.options[0]?.value ?? '?')),
        )
      }),
    ),
  )
})

describe('a normal task assigned to a worker', () => {
  it.live('hands a grouped checkout to its worker and keeps a helper from copying a stale checkout', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const workerId = 'wrk_' + '7'.repeat(32)
        const homePath = folderWith(['api', 'web'])
        const apiPath = join(homePath, 'api')
        writeFileSync(join(apiPath, 'package.json'), JSON.stringify({ name: 'worker-api', dependencies: { fixture: 'file:./fixture' } }))
        writeFileSync(join(apiPath, 'bun.lock'), '')
        execFileSync('git', ['add', '.'], { cwd: apiPath })
        execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', 'commit', '-qm', 'Keep API setup'], { cwd: apiPath })
        const workerPath = folderWith(['api', 'web'])
        let openings = 0
        const { client, grant, helpers } = yield* connected({
          workers: {
            list: () => [{ workerId, providers: ['codex'], busy: false, multiRepoProviders: ['codex'], readiness: READY }],
            open: (request) =>
              Effect.gen(function* () {
                assert.strictEqual(request.workerId, workerId)
                const bound = request.repositories ?? []
                assert.deepEqual(bound.map((repository) => repository.directory).sort(), ['api', 'web'])
                for (const repository of bound) {
                  assert.strictEqual(basename(repository.worktree), repository.directory)
                  assert.strictEqual(dirname(repository.worktree), dirname(request.worktree))
                }
                const api = bound.find((repository) => repository.directory === 'api') ?? assert.fail('The API worktree is missing.')
                // The API's bun.lock says Bun, which the worker hasn't: it installs it before the setup runs.
                assert.deepStrictEqual(request.setup, {
                  repositories: [{ workspaceId: api.workspaceId, directory: '', commands: ['bun install --frozen-lockfile'] }],
                  tools: [{ name: 'bun', version: 'latest' }],
                })
                assert.strictEqual(bound.find((repository) => repository.worktree === request.worktree)?.workspaceId, request.workspaceId)
                openings += 1
                return {
                  path: workerPath,
                  toolPort: request.toolPort,
                  transport: yield* openFakeWorker(join(workerPath, basename(request.worktree))),
                  repositorySetup: { [api.workspaceId]: { code: 0, timedOut: false, output: 'Installed API dependencies on the worker.' } },
                  checkpoint: Effect.void,
                }
              }),
          },
        })
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(homePath) })
        yield* client.SetProjectRules({ commandId: commandId(), projectId: project.id, permissions: 'ask', allowEverything: false })
        const task = yield* client.StartTask({
          commandId: commandId(),
          projectId: project.id,
          workerId,
          repositories: ['api', 'web'],
          title: 'Update both repositories on the worker',
          description: '[lead:permission] [lead:finish]',
          end: 'ready',
          steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
        })
        const awaiting = yield* until(client.GetThread({ threadId: task.threadId, fresh: true }), (thread) =>
          thread.attention.some((attention) => attention.kind === 'permission'),
        )
        assert.strictEqual(openings, 1)
        assert.include(JSON.stringify(awaiting.items), 'Installed API dependencies on the worker.')
        assert.strictEqual(
          yield* helpers.start({
            taskId: task.id,
            name: 'Check the API',
            brief: 'Read the task changes.',
            agentId: 'codex',
            model: null,
            modelName: 'Codex',
            inCopy: true,
          }),
          'This worker cannot make a separate helper checkout yet.',
        )
        assert.isEmpty(yield* helpers.working(task.id))
        const approval = awaiting.attention.find((attention) => attention.kind === 'permission') ?? assert.fail('The lead did not ask.')
        yield* client.Answer({ attentionId: approval.id, decision: 'allow', commandId: commandId() })
        yield* until(client.GetThread({ threadId: task.threadId, fresh: true }), (thread) =>
          thread.items.some((item) => item.kind === 'step_result' && item.content.step === 'implement'),
        )
      }),
    ),
  )

  it.live('lists the home’s workers with the task each runs and the projects it may work on, and takes one out', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const workerId = 'wrk_' + '4'.repeat(32)
        const away = 'wrk_' + '3'.repeat(32)
        const workerPath = repository()
        const capacity = { platform: 'linux', architecture: 'x64', cpuCores: 16, freeMemoryMib: 30_000, freeDiskMib: 200_000 } as const
        let projectId = ''
        let busy = false
        const revoked: string[] = []
        const { client, grant } = yield* connected({
          workers: {
            list: () => [{ workerId, providers: ['codex'], busy, readiness: READY }],
            enrolled: () => [
              { workerId, connected: true, busy, capacity, providers: ['codex'], projectIds: [projectId] },
              { workerId: away, connected: false, busy: false, providers: [], projectIds: [projectId, 'proj_' + '0'.repeat(32)] },
            ],
            revoke: (id) => (id === away ? Effect.sync(() => void revoked.push(id)) : Effect.fail('It runs a task.')),
            open: (request) =>
              Effect.gen(function* () {
                busy = true
                return {
                  path: workerPath,
                  toolPort: request.toolPort,
                  transport: yield* openFakeWorker(workerPath),
                  checkpoint: Effect.void,
                }
              }),
          },
        })
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        projectId = project.id
        yield* client.SetProjectRules({ commandId: commandId(), projectId: project.id, permissions: 'ask', allowEverything: false })
        const task = yield* client.StartTask({
          commandId: commandId(),
          projectId: project.id,
          workerId,
          title: 'Run it on the worker',
          description: '[lead:permission] [lead:finish]',
          end: 'ready',
          steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
        })
        yield* until(client.GetThread({ threadId: task.threadId, fresh: true }), (thread) =>
          thread.attention.some((attention) => attention.kind === 'permission'),
        )
        const { enabled, workers } = yield* client.GetWorkers({})
        assert.isTrue(enabled)
        assert.deepStrictEqual(workers, [
          {
            workerId,
            connected: true,
            busy: true,
            capacity,
            providers: ['codex'],
            projects: [{ id: project.id, name: project.name }],
            task: { taskId: task.id, threadId: task.threadId, title: 'Run it on the worker', project: project.name },
          },
          // A project the home no longer has isn't named.
          { workerId: away, connected: false, busy: false, providers: [], projects: [{ id: project.id, name: project.name }], task: null },
        ])
        yield* client.RemoveWorker({ commandId: commandId(), workerId: away })
        assert.deepStrictEqual(revoked, [away])
        const refused = yield* Effect.flip(client.RemoveWorker({ commandId: commandId(), workerId }))
        assert.strictEqual(refused.message, 'It runs a task.')
      }),
    ),
  )

  it.live('names the task whose workspace a worker’s run holds, its run settled or the worker gone', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const workerId = 'wrk_' + '5'.repeat(32)
        const workerPath = repository()
        let projectId = ''
        // The workspace the worker's run holds, as its ledger keeps it: a follow-up to a settled task holds it the same.
        let held: string | undefined
        let online = true
        const { client, grant } = yield* connected({
          workers: {
            list: () => [{ workerId, providers: ['codex'], busy: false, readiness: READY }],
            enrolled: () => [
              {
                workerId,
                connected: online,
                busy: held !== undefined,
                providers: online ? ['codex'] : [],
                projectIds: [projectId],
                ...(held === undefined ? {} : { workspaceId: held }),
              },
            ],
            open: (request) =>
              Effect.gen(function* () {
                held = request.workspaceId
                return {
                  path: workerPath,
                  toolPort: request.toolPort,
                  transport: yield* openFakeWorker(workerPath),
                  checkpoint: Effect.void,
                }
              }),
          },
        })
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        projectId = project.id
        const task = yield* client.StartTask({
          commandId: commandId(),
          projectId: project.id,
          workerId,
          title: 'Follow up on the worker',
          description: '[lead:finish]',
          steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
        })
        // Its run has ended: nothing of the task runs, yet the worker's run holds its workspace.
        yield* until(client.GetBoard({ projectId: project.id }), (board) =>
          board.tasks.some((one) => one.taskId === task.id && one.phase === 'ready'),
        )
        assert.isDefined(held)
        const named = { taskId: task.id, threadId: task.threadId, title: 'Follow up on the worker', project: project.name }
        assert.deepStrictEqual((yield* client.GetWorkers({})).workers[0]?.task, named)
        // Gone offline during it, the worker still names it.
        online = false
        const [gone] = (yield* client.GetWorkers({})).workers
        assert.deepInclude(gone, { connected: false, busy: true, task: named })
      }),
    ),
  )

  it.live('adds a worker as the window asks, picks its projects among the home’s, and says where the home can’t', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const workerId = 'wrk_' + '8'.repeat(32)
        const added: Array<{ name: string; ssh: string | null; key: string }> = []
        const assigned: Array<ReadonlyArray<string>> = []
        const grant = {
          homeId: 'home_' + '1'.repeat(32),
          workerId,
          authority: 'CA',
          certificate: 'CERT',
          serverName: 'home.althar.invalid',
          port: 6770,
          addresses: ['10.0.0.2:6770'],
        }
        const {
          client,
          grant: folder,
          connect,
          separateDevice,
        } = yield* connected({
          workers: {
            list: () => [],
            enrolled: () => null,
            open: () => Effect.die('No worker'),
            adds: () => true,
            admin: {
              add: (input) =>
                Effect.sync(() => {
                  added.push({ name: input.name, ssh: input.ssh, key: Buffer.from(input.publicKey).toString('utf8') })
                  return grant
                }),
              code: () => Effect.succeed({ code: 'althar-worker1.abc', expiresAt: 1 }),
              assign: (_id, projectIds) => Effect.sync(() => void assigned.push(projectIds)),
            },
          },
        })
        // It takes none yet, but adds them itself.
        assert.deepStrictEqual(yield* client.GetWorkers({}), { enabled: false, workers: [], adds: true })
        const signed = yield* client.AddWorker({
          commandId: commandId(),
          publicKey: Buffer.from('KEY').toString('base64url'),
          name: ' build-box ',
          ssh: 'althar@build-box',
        })
        assert.deepStrictEqual(signed, grant)
        assert.deepStrictEqual(added, [{ name: 'build-box', ssh: 'althar@build-box', key: 'KEY' }])
        assert.deepStrictEqual(yield* client.CreateWorkerCode({ name: 'laptop' }), { code: 'althar-worker1.abc', expiresAt: 1 })
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* folder(repository()) })
        yield* client.SetWorkerProjects({ commandId: commandId(), workerId, projectIds: [project.id, project.id] })
        assert.deepStrictEqual(assigned, [[project.id]])
        const unknown = yield* Effect.flip(
          client.SetWorkerProjects({ commandId: commandId(), workerId, projectIds: ['proj_' + '9'.repeat(32)] }),
        )
        assert.strictEqual(unknown.reason, 'NotFound')

        // The home's own socket, as a window over SSH reaches it, is its operator: it may.
        const operator = yield* connect('socket')
        assert.strictEqual((yield* operator.CreateWorkerCode({ name: 'laptop' })).code, 'althar-worker1.abc')
        // A device paired over the network may not add, change or remove workers.
        const paired = yield* separateDevice
        const refusals = [
          yield* Effect.flip(paired.AddWorker({ commandId: commandId(), publicKey: 'S0VZ', name: 'x' })),
          yield* Effect.flip(paired.CreateWorkerCode({ name: 'x' })),
          yield* Effect.flip(paired.SetWorkerProjects({ commandId: commandId(), workerId, projectIds: [] })),
          yield* Effect.flip(paired.RemoveWorker({ commandId: commandId(), workerId })),
        ]
        assert.deepStrictEqual(
          refusals.map((refused) => refused.reason),
          ['Forbidden', 'Forbidden', 'Forbidden', 'Forbidden'],
        )
        assert.strictEqual(added.length, 1)

        // A home with no authority of its own enrolls by its operator's command only.
        const { client: operators } = yield* connected({
          workers: { list: () => [], enrolled: () => [], open: () => Effect.die('No worker') },
        })
        assert.deepStrictEqual(yield* operators.GetWorkers({}), { enabled: true, workers: [] })
        const refused = yield* Effect.flip(operators.CreateWorkerCode({ name: 'laptop' }))
        assert.strictEqual(refused.reason, 'WorkersOff')
      }),
    ),
  )

  it.live('says a home that isn’t listening for workers takes none', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client } = yield* connected({ workers: { list: () => [], enrolled: () => null, open: () => Effect.die('No worker') } })
        assert.deepStrictEqual(yield* client.GetWorkers({}), { enabled: false, workers: [] })
        const { client: plain } = yield* connected({})
        assert.deepStrictEqual(yield* plain.GetWorkers({}), { enabled: false, workers: [] })
      }),
    ),
  )

  it.live('projects the held plan’s requirements and rechecks the selected worker at Start', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const workerId = 'wrk_' + '6'.repeat(32)
        const { client, grant } = yield* connected({
          countdown: Duration.minutes(5),
          workers: {
            list: () => [{ workerId, providers: ['codex', 'claude-code'], busy: true, readiness: READY }],
            open: () => Effect.die('A busy worker must not start again'),
          },
        })
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        const thread = client.GetCoordinator({ projectId: project.id })
        yield* client.Send({
          commandId: commandId(),
          threadId: (yield* thread).threadId,
          body: 'Add a retry. [coordinator:plan]',
          disposition: 'after_current',
        })
        const planned = yield* until(thread, (snapshot) =>
          snapshot.items.some((item) => item.kind === 'task' && item.content.plan !== null),
        )
        const item = planned.items.find((one) => one.kind === 'task')
        assert.isTrue(item?.kind === 'task')
        const plan = item?.kind === 'task' ? item.content.plan : null
        assert.deepStrictEqual(plan?.workerRequirements, { repositoryCount: 1, homeOnly: false, readOnly: false })
        const planId = plan?.id ?? ''
        yield* client.HoldPlan({ commandId: commandId(), planId })
        const rejected = yield* Effect.flip(client.StartPlan({ commandId: commandId(), planId, workerId }))
        assert.strictEqual(rejected.message, 'Linux worker 666666 is at work on another task.')
        const held = (yield* thread).items.find((one) => one.kind === 'task')
        assert.strictEqual(held?.kind === 'task' ? held.content.phase : null, 'held')
      }),
    ),
  )

  it.live('refuses unsupported worker starts before creating a task', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const workerId = 'wrk_' + '5'.repeat(32)
        let opened = 0
        const { client, grant } = yield* connected({
          workers: {
            list: () => [{ workerId, providers: ['codex'], busy: false, readiness: READY }],
            open: () => Effect.sync(() => ++opened).pipe(Effect.andThen(Effect.die('A refused task must not open a worker'))),
          },
        })
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(folderWith(['api', 'web'])) })
        const request = {
          projectId: project.id,
          workerId,
          title: 'Test placement',
          steps: [{ key: 'implement' as const, agentId: 'codex', model: null, skipped: false }],
        }
        const refused = (changes: Partial<Pick<typeof request, 'steps'>> & { repositories?: string[]; chat?: boolean }) =>
          Effect.flip(client.StartTask({ ...request, ...changes, commandId: commandId() })).pipe(Effect.map((error) => error.message))
        assert.strictEqual(yield* refused({ repositories: ['api', 'web'] }), 'A worker takes one repository at a time.')
        assert.strictEqual(yield* refused({ chat: true }), 'An aside runs on the home.')
        assert.strictEqual(
          yield* refused({ repositories: ['api'], steps: [{ ...request.steps[0]!, agentId: 'claude-code' }] }),
          'Linux worker 555555 doesn’t have the lead’s agent.',
        )
        assert.lengthOf((yield* client.ListTasks({ projectId: project.id })).tasks, 0)
        assert.strictEqual(opened, 0)
      }),
    ),
  )

  it.live('starts its lead in the worker checkout and lands its edits before the task sees the turn finish', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const workerId = 'wrk_' + '4'.repeat(32)
        const capacity = { platform: 'linux' as const, architecture: 'x64' as const, cpuCores: 4, freeMemoryMib: 8192, freeDiskMib: 16384 }
        const candidates = [
          {
            workerId: 'wrk_' + '1'.repeat(32),
            providers: ['codex'],
            busy: false,
            capacity: { ...capacity, freeMemoryMib: 1024 },
            readiness: READY,
          },
          {
            workerId: 'wrk_' + '2'.repeat(32),
            providers: ['codex'],
            busy: true,
            capacity: { ...capacity, freeMemoryMib: 32768 },
            readiness: READY,
          },
          { workerId, providers: ['codex'], busy: false, capacity, readiness: READY },
        ]
        const homePath = repository()
        writeFileSync(join(homePath, 'package.json'), JSON.stringify({ name: 'worker-task', dependencies: { fixture: 'file:./fixture' } }))
        writeFileSync(join(homePath, 'bun.lock'), '')
        const git = (...args: string[]) =>
          execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd: homePath })
        git('add', 'package.json', 'bun.lock')
        git('commit', '--quiet', '-m', 'Add the project setup')
        const workerPath = join(mkdtempSync(join(tmpdir(), 'althar-placed-checkout-')), 'worker')
        git('clone', '--quiet', homePath, workerPath)
        let expectedProject: string | undefined
        const placed: Array<{ workspace: string; site: string }> = []
        const managed: string[] = []
        let managedStopped = 0
        let homeSandboxProbes = 0
        let workerAvailable = true
        let previewMode: 'live' | 'refuse' | 'closed' = 'live'
        let announcesPort = true
        let stageState: 'valid' | 'missing' | 'changed' = 'valid'
        const homeAgents = Layer.effect(
          Agents,
          Effect.gen(function* () {
            const fakes = yield* Agents
            const withHomeSandbox = (entry: AgentEntry): AgentEntry =>
              entry.definition.id !== 'codex'
                ? entry
                : {
                    ...entry,
                    definition: {
                      ...entry.definition,
                      ready: () => {
                        homeSandboxProbes += 1
                        return undefined
                      },
                      holds: () => {
                        homeSandboxProbes += 1
                        return undefined
                      },
                    },
                  }
            return Agents.of({ list: fakes.list.map(withHomeSandbox), get: (id) => Effect.map(fakes.get(id), withHomeSandbox) })
          }),
        ).pipe(Layer.provide(fakeAgents()))
        const { client, grant, connect, separateDevice } = yield* connected({
          agents: homeAgents,
          workers: {
            list: (projectId) => (projectId === expectedProject ? candidates : []),
            readFile: (input) =>
              Effect.gen(function* () {
                assert.deepStrictEqual(input, { workerId, projectId: expectedProject, worktree: placed[0]?.site, path: 'staged' })
                if (!workerAvailable)
                  return yield* new AgentRequestFailed({ method: 'workspace/file', failure: 'transient', message: 'Worker disconnected.' })
                const bytes = Buffer.from('from the worker setup')
                return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
              }),
            captureCheckouts: (input) =>
              Effect.gen(function* () {
                assert.deepStrictEqual(input, { workerId, projectId: expectedProject, worktree: placed[0]?.site })
                if (!workerAvailable)
                  return yield* new AgentRequestFailed({
                    method: 'workspace/checkpoint',
                    failure: 'transient',
                    message: 'Worker disconnected.',
                  })
                const tree = yield* treeOf(input.worktree).pipe(Effect.orDie)
                const head = yield* gitOf(input.worktree, 'rev-parse', 'HEAD').pipe(Effect.orDie)
                const index = yield* untouched(
                  input.worktree,
                  Effect.gen(function* () {
                    yield* gitOf(input.worktree, 'read-tree', tree)
                    yield* gitOf(input.worktree, 'update-index', '--force-remove', '--', 'change.txt')
                    return yield* gitOf(input.worktree, 'write-tree')
                  }),
                ).pipe(Effect.orDie)
                return new Map(
                  stageState === 'missing'
                    ? []
                    : [[input.worktree, { head: stageState === 'changed' ? 'a'.repeat(40) : head, tree, index }]],
                )
              }),
            startCommand: (command) =>
              Effect.gen(function* () {
                assert.strictEqual(command.workerId, workerId)
                assert.strictEqual(command.projectId, expectedProject)
                assert.strictEqual(command.worktree, placed[0]?.site)
                assert.strictEqual(command.directory, '')
                managed.push(command.command)
                command.output(Buffer.from('From the worker only.\n'))
                if (announcesPort) command.output(Buffer.from('Local: http://127.0.0.1:5173/\n'))
                let outcome!: (result: AgentManagedExit) => void
                const exit = new Promise<AgentManagedExit>((resolve) => {
                  outcome = resolve
                })
                const stop = async () => {
                  managedStopped += 1
                  outcome({ $typeName: 'althar.worker.v1.AgentManagedExit', outcome: AgentRunOutcome.STOPPED })
                }
                yield* Effect.addFinalizer(() => Effect.promise(stop))
                const preview = async (port: number) => {
                  assert.strictEqual(port, 5173)
                  if (previewMode === 'refuse') throw new Error('The application stopped listening')
                  if (previewMode === 'closed') {
                    const closed = new PassThrough()
                    closed.destroy()
                    return closed
                  }
                  const request = new PassThrough()
                  const response = new PassThrough()
                  request.once('data', (bytes: Buffer) => {
                    assert.include(bytes.toString(), 'GET /page HTTP/1.1')
                    response.end('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 6\r\nConnection: close\r\n\r\nworker')
                  })
                  return Duplex.from({ readable: response, writable: request })
                }
                return { exit, stop, preview }
              }),
            open: (request) =>
              Effect.gen(function* () {
                assert.strictEqual(request.workerId, workerId)
                placed.push({ workspace: request.workspaceId, site: request.worktree })
                // Its bun.lock says Bun, which the worker hasn't: it installs it before the setup runs.
                assert.deepStrictEqual(request.setup, {
                  directory: '',
                  commands: ['bun install --frozen-lockfile'],
                  tools: [{ name: 'bun', version: 'latest' }],
                })
                writeFileSync(join(workerPath, 'staged'), 'from the worker setup')
                return {
                  transport: yield* openFakeWorker(workerPath),
                  path: workerPath,
                  toolPort: request.toolPort,
                  setup: { code: 0, timedOut: false, output: 'Setup completed on the worker.' },
                  checkpoint: Effect.sync(() => {
                    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workerPath }).toString().trim()
                    const home = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: request.worktree }).toString().trim()
                    if (head === home) return
                    execFileSync('git', ['-c', 'protocol.file.allow=always', 'fetch', '--no-tags', workerPath, head], {
                      cwd: request.worktree,
                      stdio: 'ignore',
                    })
                    execFileSync('git', ['merge', '--ff-only', 'FETCH_HEAD'], { cwd: request.worktree, stdio: 'ignore' })
                  }),
                }
              }),
          },
        })
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(homePath) })
        expectedProject = project.id
        yield* client.SetProjectRules({ commandId: commandId(), projectId: project.id, permissions: 'ask', allowEverything: false })
        // Each as it said, with what the project's files need that it lacks, by its own check.
        const listed = yield* client.ListProjectWorkers({ projectId: project.id })
        assert.deepStrictEqual(
          listed.map(({ needs: _needs, ...worker }) => worker),
          candidates,
        )
        assert.isTrue(listed.every((worker) => worker.needs === undefined || worker.needs.every((need) => need.why !== '')))
        const task = yield* client.StartTask({
          commandId: commandId(),
          projectId: project.id,
          workerId: 'auto',
          title: 'Work on the worker',
          description: '[lead:permission] [lead:edit] [lead:finish]',
          end: 'ready',
          steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
        })
        const permission = (thread: ThreadSnapshot) =>
          thread.attention.find((call) => call.kind === 'permission' && call.command === 'make deploy')
        const approval = yield* until(
          client.GetThread({ threadId: task.threadId, fresh: true }),
          (thread) => permission(thread) !== undefined,
        )
        const decision = { attentionId: permission(approval)!.id, decision: 'allow' as const }
        const run = yield* client.KeepRunnable({ commandId: commandId(), projectId: project.id, name: 'Build', command: 'touch home-leak' })
        const startRun = () =>
          client.RunProject({
            commandId: commandId(),
            projectId: project.id,
            taskId: task.id,
            threadId: task.threadId,
            runnableId: run.id,
          })
        const launch = yield* startRun()
        assert.strictEqual((yield* startRun()).id, launch.id)
        assert.lengthOf(managed, 1)
        assert.include(managed[0], 'touch home-leak')
        assert.include((yield* client.ReadLaunchOutput({ id: launch.id })).text, 'From the worker only.')
        assert.isFalse(existsSync(join(placed[0]!.site, 'home-leak')))
        const runView = yield* until(client.GetThread({ threadId: task.threadId, fresh: true }), (view) =>
          view.task.launches.some((one) => one.url !== null),
        )
        assert.match(runView.task.launches[0]?.url ?? '', /^althar-preview:\/\//)
        const readPreview = { projectId: project.id, id: launch.id, method: 'GET' as const, path: '/page' }
        const preview = yield* client.ReadLaunchPreview(readPreview)
        assert.strictEqual(Buffer.from(preview.bodyBase64, 'base64').toString(), 'worker')
        yield* Effect.flip(client.ReadLaunchPreview({ ...readPreview, projectId: 'proj_' + '0'.repeat(32) }))
        const { projectId } = readPreview
        const previewRun = { projectId, id: launch.id }
        yield* Effect.flip(client.OpenLaunchPreviewSocket({ ...previewRun, projectId: 'proj_' + '0'.repeat(32) }))
        const remoteRunShell = yield* Effect.flip(
          client.OpenTerminal({
            commandId: commandId(),
            projectId: project.id,
            taskId: task.id,
            launchId: launch.id,
            id: 'term_worker_run',
            cols: 80,
            rows: 24,
          }),
        )
        assert.include(remoteRunShell.message, 'It runs on Linux worker')
        previewMode = 'refuse'
        assert.include((yield* Effect.flip(client.ReadLaunchPreview(readPreview))).message, 'couldn’t reach the app')
        yield* Effect.flip(client.OpenLaunchPreviewSocket(previewRun))
        previewMode = 'closed'
        yield* Effect.flip(client.OpenLaunchPreviewSocket(previewRun))
        previewMode = 'live'
        const tunnel = yield* client.OpenLaunchPreviewSocket(previewRun)
        const paired = yield* connect('socket')
        const data = Buffer.from('GET /page HTTP/1.1\r\nHost: localhost\r\n\r\n').toString('base64')
        yield* Effect.flip(paired.WriteLaunchPreviewSocket({ socket: tunnel, data }))
        yield* Effect.flip(client.WriteLaunchPreviewSocket({ socket: tunnel, data: 'invalid=' }))
        const received = yield* Effect.forkScoped(Stream.runCollect(client.ReadLaunchPreviewSocket({ socket: tunnel })))
        yield* client.WriteLaunchPreviewSocket({ socket: tunnel, data })
        const transferred = Buffer.concat((yield* Fiber.join(received)).map((chunk) => Buffer.from(chunk, 'base64')))
        assert.match(transferred.toString(), /worker$/)
        yield* Effect.flip(client.WriteLaunchPreviewSocket({ socket: tunnel, data }))
        yield* client.StopLaunch({ commandId: commandId(), id: launch.id })
        yield* Effect.flip(client.ReadLaunchPreview(readPreview))
        yield* Effect.flip(client.OpenLaunchPreviewSocket(previewRun))
        assert.strictEqual(managedStopped, 1)
        announcesPort = false
        const quiet = yield* startRun()
        const quietPreview = { projectId, id: quiet.id }
        yield* Effect.flip(client.OpenLaunchPreviewSocket(quietPreview))
        yield* Effect.flip(client.ReadLaunchPreview({ ...readPreview, id: quiet.id }))
        yield* client.StopLaunch({ commandId: commandId(), id: quiet.id })
        const socket = yield* connect('socket')
        const refused = yield* Effect.flip(socket.Answer({ ...decision, commandId: commandId() }))
        assert.strictEqual(refused.reason, 'PersonRequired')
        yield* client.Answer({ ...decision, commandId: commandId() })
        const snapshot = yield* until(
          client.GetThread({ threadId: task.threadId, fresh: true }),
          (view) =>
            view.task.files.some((file) => file.path === 'change.txt') &&
            view.items.some((item) => item.kind === 'step_result' && item.content.step === 'implement'),
        )
        assert.lengthOf(placed, 1)
        assert.strictEqual(homeSandboxProbes, 0)
        assert.strictEqual(snapshot.task.worktree, placed[0]?.site)
        assert.strictEqual(snapshot.task.workerId, workerId)
        assert.isTrue(existsSync(join(workerPath, 'change.txt')))
        assert.isFalse(existsSync(join(placed[0]!.site, 'node_modules')))
        const setup = snapshot.items.filter((item) => item.kind === 'setup')
        assert.lengthOf(setup, 1)
        assert.include(JSON.stringify(setup[0]?.content), 'Setup completed on the worker.')
        assert.isUndefined(permission(snapshot))
        const shell = yield* Effect.flip(
          client.OpenTerminal({
            commandId: commandId(),
            projectId: project.id,
            taskId: task.id,
            id: 'term_worker_copy',
            cols: 80,
            rows: 24,
          }),
        )
        assert.include(shell.message, 'To work in its files here, copy them from its Worktree.')
        const requested = { projectId: project.id, taskId: task.id, source: 'worker' as const }
        yield* Effect.flip(client.PrepareWorkerSnapshot({ ...requested, projectId: 'proj_' + '0'.repeat(32) }))
        const copy = yield* client.PrepareWorkerSnapshot(requested)
        const [repo] = copy.repositories
        assert.isDefined(repo)
        if (repo === undefined) return
        assert.notStrictEqual(repo.index, repo.tree)
        assert.notStrictEqual(repo.index, yield* gitOf(placed[0]!.site, 'write-tree'))
        for (const state of ['missing', 'changed'] as const) {
          stageState = state
          const rejected = yield* Effect.flip(client.PrepareWorkerSnapshot(requested))
          assert.include(rejected.message, state === 'missing' ? 'staged files for every repository' : 'changed while the snapshot')
        }
        stageState = 'valid'
        const request = { id: copy.id, workspaceId: repo.workspaceId, offset: 0 }
        const workerFile = { projectId: project.id, taskId: task.id, workspaceId: repo.workspaceId, relativePath: 'staged' }
        const output = yield* client.ReadWorkerFile(workerFile)
        assert.strictEqual(Buffer.from(output.bodyBase64, 'base64').toString('utf8'), 'from the worker setup')
        const defaultOutput = yield* client.ReadWorkerFile({ projectId: project.id, taskId: task.id, relativePath: 'staged' })
        assert.deepStrictEqual(defaultOutput, output)
        yield* Effect.flip(client.ReadWorkerFile({ ...workerFile, workspaceId: 'ws_' + '0'.repeat(32) }))
        workerAvailable = false
        assert.strictEqual((yield* Effect.flip(client.ReadWorkerFile(workerFile))).message, 'Worker disconnected.')
        const unavailable = yield* Effect.flip(client.PrepareWorkerSnapshot(requested))
        assert.strictEqual(unavailable.reason, 'WorkerUnavailable')
        assert.strictEqual(unavailable.message, 'Worker disconnected.')
        const homeCopy = yield* client.PrepareWorkerSnapshot({ ...requested, source: 'home_copy' })
        assert.strictEqual(homeCopy.source, 'home_copy')
        assert.strictEqual((yield* Effect.flip(client.PrepareWorkerSnapshot(requested))).reason, 'WorkerUnavailable')
        const other = yield* separateDevice
        const anotherCopy = yield* other.PrepareWorkerSnapshot({ ...requested, source: 'home_copy' })
        const extraCopy = yield* other.PrepareWorkerSnapshot({ ...requested, source: 'home_copy' })
        const third = yield* separateDevice
        assert.include(
          (yield* Effect.flip(third.PrepareWorkerSnapshot({ ...requested, source: 'home_copy' }))).message,
          'Finish downloading',
        )
        yield* other.ReleaseWorkerSnapshot({ id: anotherCopy.id })
        const thirdCopy = yield* third.PrepareWorkerSnapshot({ ...requested, source: 'home_copy' })
        yield* third.ReleaseWorkerSnapshot({ id: thirdCopy.id })
        yield* other.ReleaseWorkerSnapshot({ id: extraCopy.id })
        yield* client.ReleaseWorkerSnapshot({ id: homeCopy.id })
        assert.strictEqual((yield* Effect.flip(other.ReadWorkerSnapshotChunk(request))).reason, 'NotFound')
        const reconnect = yield* connect('window')
        const read = yield* reconnect.ReadWorkerSnapshotChunk(request)
        assert.isTrue(read.done)
        assert.strictEqual(read.nextOffset, repo.bytes)
        assert.strictEqual((yield* Effect.flip(reconnect.ReadWorkerSnapshotChunk({ ...request, offset: repo.bytes }))).reason, 'NotFound')
        assert.strictEqual(
          (yield* Effect.flip(reconnect.ReadWorkerSnapshotChunk({ ...request, workspaceId: 'ws_' + '0'.repeat(32) }))).reason,
          'NotFound',
        )
        const bytes = Buffer.from(read.bodyBase64, 'base64')
        assert.strictEqual(createHash('sha256').update(bytes).digest('hex'), repo.sha256)
        const stored = join(workerPath, 'offered.bundle')
        writeFileSync(stored, bytes)
        assert.include(execFileSync('git', ['bundle', 'list-heads', stored]).toString(), 'refs/althar/worker-snapshot')
        const fragment = yield* reconnect.ReadWorkerSnapshotChunk({ ...request, offset: 7 })
        assert.deepStrictEqual(Buffer.from(fragment.bodyBase64, 'base64'), bytes.subarray(7))
        yield* other.ReleaseWorkerSnapshot({ id: copy.id })
        yield* client.ReadWorkerSnapshotChunk(request)
        yield* reconnect.ReleaseWorkerSnapshot({ id: copy.id })
        yield* Effect.flip(client.ReadWorkerSnapshotChunk(request))
      }),
    ),
  )
})

describe('a task moving between the home and its workers (ADR-103)', () => {
  it.live(
    'moves between the home and workers with its work, by the lead it has now, and stays where a worker can’t bring its work home',
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const runner1 = 'wrk_' + '5'.repeat(32)
          const runner2 = 'wrk_' + '6'.repeat(32)
          const unready = 'wrk_' + '8'.repeat(32)
          const homePath = repository()
          const capacity = { platform: 'linux', architecture: 'x64', cpuCores: 8, freeMemoryMib: 16_000, freeDiskMib: 80_000 } as const
          const checked = (models: ReadonlyArray<string>) => ({
            sandbox: { starts: true as const },
            tools: [{ name: 'git', version: '2.43.0' }],
            models: [{ providerId: 'codex', models: models.map((id) => ({ id, name: id })) }],
            agents: [{ providerId: 'codex', starts: true }],
          })
          const listed = (
            workerId: string,
            name: string,
            readiness:
              | ReturnType<typeof checked>
              | (Omit<ReturnType<typeof checked>, 'sandbox'> & { sandbox: { starts: false; problem: string } }),
          ) => ({
            workerId,
            name,
            providers: ['codex'],
            signedIn: ['codex'],
            busy: false,
            capacity,
            readiness,
          })
          // What each worker has of the task's work, as its checkout came: the files in the home's worktree as it opened there.
          const opened: Array<{ workerId: string; files: ReadonlyArray<string> }> = []
          // A checkpoint brings what the worker changed home, as the real one lands its patch (workerWorkspace.ts); one may fail.
          let checkpointFails = false
          const changedOn = new Map<string, string>()
          const { client, grant, context } = yield* connected({
            workers: {
              list: () => [
                listed(runner1, 'runner-1', checked(['small', 'large'])),
                listed(runner2, 'runner-2', checked(['small'])),
                listed(unready, 'runner-3', { ...checked([]), sandbox: { starts: false, problem: 'NoUserNamespaces' } }),
              ],
              checkpointWorktree: (input) =>
                checkpointFails
                  ? Effect.fail(
                      new AgentRequestFailed({ method: 'workspace/checkpoint', failure: 'transient', message: 'The worker is gone.' }),
                    )
                  : Effect.sync(() => {
                      const file = changedOn.get(input.workerId)
                      if (file !== undefined) writeFileSync(join(input.worktree, file), `written on ${input.workerId}\n`)
                    }),
              open: (request) =>
                Effect.gen(function* () {
                  opened.push({ workerId: request.workerId, files: readdirSync(request.worktree).filter((file) => !file.startsWith('.')) })
                  const workerPath = repository()
                  return {
                    path: workerPath,
                    toolPort: request.toolPort,
                    transport: yield* openFakeWorker(workerPath),
                    checkpoint: Effect.void,
                  }
                }),
            },
          })
          const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(homePath) })
          const task = yield* client.StartTask({
            commandId: commandId(),
            projectId: project.id,
            title: 'Carry on wherever it runs',
            description: '[lead:finish]',
            end: 'ready',
            steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
          })
          yield* until(client.GetThread({ threadId: task.threadId, fresh: true }), (thread) =>
            thread.items.some((item) => item.kind === 'step_result' && item.content.step === 'implement'),
          )
          // Its lead moved to the large model since it started: where it goes is judged by that, not its plan's.
          yield* client.SetModel({ commandId: commandId(), threadId: task.threadId, model: 'large' })
          const home = yield* until(client.GetThread({ threadId: task.threadId, fresh: true }), (view) => view.session?.model === 'large')
          const worktree = home.task.worktree ?? assert.fail('The task has no worktree.')
          writeFileSync(join(worktree, 'made-at-home.txt'), 'home\n')
          const move = (to: string, more: { readonly lead?: { readonly model: string }; readonly fromLastTurn?: boolean } = {}) =>
            client.MoveTaskTo({ commandId: commandId(), taskId: task.id, to, ...more })
          // Its lead moves it too, by where it runs as the person says it (change_part runs_on).
          const lead: ToolAccess = { role: 'lead', projectId: project.id, threadId: task.threadId, sessionId: 'none', taskId: task.id }
          const runsOn = (args: Record<string, unknown>) =>
            callTool(lead, 'change_part', { part: 'workspace', why: 'Elsewhere.', ...args }).pipe(Effect.provideContext(context))
          const placedOn = (workerId: string | null) =>
            until(client.GetThread({ threadId: task.threadId, fresh: true }), (thread) => (thread.task.workerId ?? null) === workerId)
          const said = (place: string) => `Moved to ${place}: its lead carries on there.`
          // A message taken up and its turn over: what the lead was told reached it, and it answered.
          const answered = (text: string) =>
            until(client.GetThread({ threadId: task.threadId, fresh: true }), (thread) => {
              const at = thread.items.findIndex((item) => item.kind === 'user_message' && item.content.text.startsWith(text))
              return (
                at !== -1 &&
                thread.items.slice(at + 1).some((item) => item.kind === 'agent_message') &&
                thread.session?.turnRunning !== true
              )
            })
          // runner-3's sandbox can't start, and runner-2 doesn't offer the large model its lead is on.
          assert.include((yield* Effect.flip(move(unready))).message, 'runner-3 can’t start its agents’ sandbox')
          assert.strictEqual((yield* Effect.flip(move(runner2))).message, 'runner-2 doesn’t offer large. Pick a model it has.')
          assert.strictEqual(
            yield* runsOn({ runs_on: 'nowhere' }),
            'No worker of this project is called nowhere. Its workers: runner-1, runner-2, runner-3; or the home.',
          )
          // To runner-1, which does: once its turn has ended, with what the home's worktree has.
          const first = yield* move(runner1)
          if (first.kind === 'waits') assert.strictEqual(first.why, 'Moves to runner-1 once its lead’s turn ends.')
          else assert.deepStrictEqual(first, { kind: 'placed', said: said('runner-1') })
          assert.isUndefined((yield* placedOn(runner1)).task.placing)
          yield* client.Send({
            commandId: commandId(),
            threadId: task.threadId,
            body: 'On runner-1 now. [lead:finish]',
            disposition: 'after_current',
          })
          yield* until(
            Effect.sync(() => opened.length),
            (count) => count === 1,
          )
          assert.deepStrictEqual(opened[0]?.workerId, runner1)
          assert.include(opened[0]?.files ?? [], 'made-at-home.txt')
          yield* answered('On runner-1 now.')
          // Worker to worker, on the small model runner-2 offers: what runner-1 changed comes home first, then goes on to runner-2.
          changedOn.set(runner1, 'made-on-runner-1.txt')
          assert.match(yield* runsOn({ runs_on: 'Runner-2', model: 'small' }), /: Moved to runner-2: its lead carries on there\.$/u)
          assert.strictEqual(readFileSync(join(worktree, 'made-on-runner-1.txt'), 'utf8'), `written on ${runner1}\n`)
          yield* placedOn(runner2)
          yield* client.Send({
            commandId: commandId(),
            threadId: task.threadId,
            body: 'On runner-2 now. [lead:finish]',
            disposition: 'after_current',
          })
          yield* until(
            Effect.sync(() => opened.length),
            (count) => count === 2,
          )
          assert.strictEqual(opened[1]?.workerId, runner2)
          assert.includeMembers([...(opened[1]?.files ?? [])], ['made-at-home.txt', 'made-on-runner-1.txt'])
          // On the small model picked for runner-2, as its handover started it.
          assert.strictEqual((yield* answered('On runner-2 now.')).session?.model, 'small')
          // runner-2 can't bring its work home just now: the task stays on it.
          changedOn.set(runner2, 'made-on-runner-2.txt')
          checkpointFails = true
          assert.include((yield* Effect.flip(move('home'))).message, 'runner-2 couldn’t bring its work home just now, so it stays there.')
          assert.strictEqual((yield* client.GetThread({ threadId: task.threadId, fresh: true })).task.workerId, runner2)
          assert.isFalse(existsSync(join(worktree, 'made-on-runner-2.txt')))
          // Once it can, home it comes, with what runner-2 changed.
          checkpointFails = false
          assert.match(yield* runsOn({ runs_on: 'This Mac' }), /: Moved to this home: its lead carries on there\.$/u)
          yield* placedOn(null)
          assert.strictEqual(readFileSync(join(worktree, 'made-on-runner-2.txt'), 'utf8'), `written on ${runner2}\n`)
          assert.includeMembers(readdirSync(worktree), ['made-at-home.txt', 'made-on-runner-1.txt', 'made-on-runner-2.txt'])
          assert.deepStrictEqual(yield* move('home'), { kind: 'same' })
          assert.match(yield* runsOn({ runs_on: 'home' }), / runs there already\.$/u)
        }),
      ),
  )

  it.live(
    'waits out a fresh session taking it over, then judges the move by the incoming lead, and moves from its last turn’s copy when asked',
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const runner1 = 'wrk_' + 'a'.repeat(32)
          const runner2 = 'wrk_' + 'b'.repeat(32)
          const capacity = { platform: 'linux', architecture: 'x64', cpuCores: 8, freeMemoryMib: 16_000, freeDiskMib: 80_000 } as const
          const offering = (models: ReadonlyArray<string>) => ({
            ...READY,
            models: [{ providerId: 'codex', models: models.map((id) => ({ id, name: id })) }],
          })
          const release = yield* Deferred.make<void>()
          let opening = 0
          let checkpointFails = false
          const { client, grant, context } = yield* connected({
            workers: {
              list: () => [
                {
                  workerId: runner1,
                  name: 'runner-1',
                  providers: ['codex'],
                  signedIn: ['codex'],
                  busy: false,
                  capacity,
                  readiness: offering(['small', 'large']),
                },
                {
                  workerId: runner2,
                  name: 'runner-2',
                  providers: ['codex'],
                  signedIn: ['codex'],
                  busy: false,
                  capacity,
                  readiness: offering(['small']),
                },
              ],
              checkpointWorktree: () =>
                checkpointFails
                  ? Effect.fail(
                      new AgentRequestFailed({ method: 'workspace/checkpoint', failure: 'transient', message: 'The worker is gone.' }),
                    )
                  : Effect.void,
              open: (request) =>
                Effect.gen(function* () {
                  opening += 1
                  // The session taking it over on runner-1 is held starting, so its handover stays under way.
                  yield* Deferred.await(release)
                  const workerPath = repository()
                  return {
                    path: workerPath,
                    toolPort: request.toolPort,
                    transport: yield* openFakeWorker(workerPath),
                    checkpoint: Effect.void,
                  }
                }),
            },
          })
          const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
          const task = yield* client.StartTask({
            commandId: commandId(),
            projectId: project.id,
            title: 'Moves while it is taken over',
            description: '[lead:finish]',
            end: 'ready',
            steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
          })
          yield* until(client.GetThread({ threadId: task.threadId, fresh: true }), (thread) =>
            thread.items.some((item) => item.kind === 'step_result' && item.content.step === 'implement'),
          )
          // The lead goes out on large, and comes into runner-1 on small.
          yield* client.SetModel({ commandId: commandId(), threadId: task.threadId, model: 'large' })
          yield* until(
            client.GetThread({ threadId: task.threadId, fresh: true }),
            (view) => view.session?.model === 'large' && view.session.turnRunning !== true,
          )
          yield* client.MoveTaskTo({ commandId: commandId(), taskId: task.id, to: runner1, lead: { model: 'small' } })
          yield* until(client.GetThread({ threadId: task.threadId, fresh: true }), (thread) => thread.task.workerId === runner1)
          yield* client.Send({
            commandId: commandId(),
            threadId: task.threadId,
            body: 'Carry on. [lead:finish]',
            disposition: 'after_current',
          })
          yield* until(
            Effect.sync(() => opening),
            (count) => count === 1,
          )
          // runner-2 offers small alone: the incoming lead's, not the outgoing large one. It waits for the handover, and goes.
          const waiting = yield* client.MoveTaskTo({ commandId: commandId(), taskId: task.id, to: runner2 })
          assert.deepStrictEqual(waiting, { kind: 'waits', why: 'Moves to runner-2 once its lead’s turn ends.' })
          assert.strictEqual((yield* client.GetThread({ threadId: task.threadId, fresh: true })).task.placing?.to, runner2)
          // Back where it runs, the move that waited is called off; asked again, with the lead's model for there, it waits again.
          assert.deepStrictEqual(yield* client.MoveTaskTo({ commandId: commandId(), taskId: task.id, to: runner1 }), { kind: 'same' })
          assert.isUndefined((yield* client.GetThread({ threadId: task.threadId, fresh: true })).task.placing)
          assert.strictEqual(
            (yield* client.MoveTaskTo({ commandId: commandId(), taskId: task.id, to: runner2, lead: { model: 'small' } })).kind,
            'waits',
          )
          yield* Deferred.succeed(release, undefined)
          yield* until(
            client.GetThread({ threadId: task.threadId, fresh: true }),
            (thread) => thread.task.workerId === runner2 && thread.task.placing === undefined,
          )
          // runner-2 can't bring its work home: the person said to move from what its last turn brought home.
          yield* until(client.GetThread({ threadId: task.threadId, fresh: true }), (thread) => thread.session?.turnRunning !== true)
          checkpointFails = true
          const lead: ToolAccess = { role: 'lead', projectId: project.id, threadId: task.threadId, sessionId: 'none', taskId: task.id }
          assert.match(
            yield* callTool(lead, 'change_part', { part: 'workspace', runs_on: 'home', from_last_turn: true, why: 'Home.' }).pipe(
              Effect.provideContext(context),
            ),
            /: Moved to this home: its lead carries on there\. Its work came along as its last turn on runner-2 brought it home, as asked\.$/u,
          )
        }),
      ),
  )
})
