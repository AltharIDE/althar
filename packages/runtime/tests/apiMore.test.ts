import { createHash, randomBytes } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
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
import { Context, Duration, Effect, Fiber, Layer, Stream } from 'effect'
import { RpcClient } from 'effect/rpc'
import { until } from '@althar/testing/effect'

import { connection, services, text } from '../src/Api'
import { type AgentEntry, Agents, type RuntimeOptions } from '../src/Config'
import { ClientIdentities } from '../src/ClientIdentities'
import { Instance } from '../src/Instance'
import { Folders } from '../src/Folders'
import { git as gitOf, treeOf, untouched } from '../src/git'
import { Helpers } from '../src/Helpers'
import { Secrets } from '../src/Secrets'
import type { WorkerExecution } from '../src/workerExecution'

import { fakeAgents, fakeConnectors, repository, ROOMY } from './support'

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
    return { client, grant, connect, separateDevice, helpers: Context.get(context, Helpers) }
  })

const idle = (thread: { readonly session: ThreadSnapshot['session'] }) =>
  thread.session !== null && !thread.session.turnRunning && thread.session.turnEndedAt !== null

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
            list: () => [{ workerId, providers: ['codex'], busy: false, multiRepoProviders: ['codex'] }],
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
                assert.deepStrictEqual(request.setup, {
                  repositories: [{ workspaceId: api.workspaceId, directory: '', commands: ['bun install --frozen-lockfile'] }],
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

  it.live('projects the held plan’s requirements and rechecks the selected worker at Start', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const workerId = 'wrk_' + '6'.repeat(32)
        const { client, grant } = yield* connected({
          countdown: Duration.minutes(5),
          workers: {
            list: () => [{ workerId, providers: ['codex', 'claude-code'], busy: true }],
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
            list: () => [{ workerId, providers: ['codex'], busy: false }],
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
          { workerId: 'wrk_' + '1'.repeat(32), providers: ['codex'], busy: false, capacity: { ...capacity, freeMemoryMib: 1024 } },
          { workerId: 'wrk_' + '2'.repeat(32), providers: ['codex'], busy: true, capacity: { ...capacity, freeMemoryMib: 32768 } },
          { workerId, providers: ['codex'], busy: false, capacity },
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
                assert.deepStrictEqual(request.setup, { directory: '', commands: ['bun install --frozen-lockfile'] })
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
        assert.deepStrictEqual(yield* client.ListProjectWorkers({ projectId: project.id }), candidates)
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
