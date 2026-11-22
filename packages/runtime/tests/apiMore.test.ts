import { randomBytes } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Duplex, PassThrough, Readable, Writable } from 'node:stream'
import { once } from 'node:events'
import { MessageChannel } from 'node:worker_threads'

import { Api, clientProtocol, emitterPort, type ThreadSnapshot } from '@althar/contracts'
import { agents as registry } from '@althar/provider-adapters'
import { fakeAgentMain, scenarios } from '@althar/provider-adapters/testing'
import { AgentRunOutcome, type AgentManagedExit } from '@althar/worker-protocol'
import { assert, describe, it } from '@effect/vitest'
import { Context, Duration, Effect, Layer } from 'effect'
import { RpcClient } from 'effect/rpc'
import { until } from '@althar/testing/effect'

import { connection, services, text } from '../src/Api'
import { type AgentEntry, Agents, type RuntimeOptions } from '../src/Config'
import { Folders } from '../src/Folders'
import { Secrets } from '../src/Secrets'

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
    const connect = (kind: 'window' | 'socket') =>
      Effect.gen(function* () {
        const channel = new MessageChannel()
        yield* Effect.addFinalizer(() => Effect.sync(() => channel.port1.close()))
        yield* Effect.forkScoped(
          Layer.launch(
            connection(
              emitterPort(channel.port1, (data) => data),
              { kind },
            ),
          ).pipe(Effect.provideContext(context)),
        )
        const protocol = yield* Layer.build(clientProtocol(emitterPort(channel.port2, (data) => data)))
        return yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
      })
    const client = yield* connect('window')
    const grant = (path: string) => Context.get(context, Folders).allow(path)
    return { client, grant, connect }
  })

const idle = (thread: { readonly session: ThreadSnapshot['session'] }) =>
  thread.session !== null && !thread.session.turnRunning && thread.session.turnEndedAt !== null

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
        assert.strictEqual(rejected.message, 'This worker is already running a task.')
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
        assert.strictEqual(yield* refused({ repositories: ['api', 'web'] }), 'A worker needs a task with one repository.')
        assert.strictEqual(yield* refused({ chat: true }), 'This task stays on its home.')
        assert.strictEqual(
          yield* refused({ repositories: ['api'], steps: [{ ...request.steps[0]!, agentId: 'claude-code' }] }),
          'This worker does not have the lead’s agent.',
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
        const { client, grant, connect } = yield* connected({
          agents: homeAgents,
          workers: {
            list: (projectId) => (projectId === expectedProject ? [{ workerId, providers: ['codex'], busy: false }] : []),
            startCommand: (command) =>
              Effect.gen(function* () {
                assert.strictEqual(command.workerId, workerId)
                assert.strictEqual(command.projectId, expectedProject)
                assert.strictEqual(command.worktree, placed[0]?.site)
                assert.strictEqual(command.directory, '')
                managed.push(command.command)
                command.output(Buffer.from('From the worker only.\nLocal: http://127.0.0.1:5173/\n'))
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
                placed.push({ workspace: request.workspaceId, site: request.worktree })
                assert.deepStrictEqual(request.setup, { directory: '', commands: ['bun install --frozen-lockfile'] })
                writeFileSync(join(workerPath, 'staged'), 'from the worker setup')
                const child = spawn('bun', [fakeAgentMain], { cwd: workerPath, stdio: ['pipe', 'pipe', 'ignore'] })
                const exited = once(child, 'exit')
                const stop = Effect.promise(async () => {
                  if (child.exitCode === null && child.signalCode === null) child.kill()
                  await exited
                })
                yield* Effect.addFinalizer(() => stop)
                return {
                  transport: {
                    _tag: 'Remote' as const,
                    stdin: Writable.toWeb(child.stdin),
                    stdout: Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
                    exited: Effect.promise(() =>
                      exited.then(([code, signal]) => ({ code: code as number | null, signal: signal as string | null })),
                    ),
                    stop,
                  },
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
        assert.deepStrictEqual(yield* client.ListProjectWorkers({ projectId: project.id }), [
          { workerId, providers: ['codex'], busy: false },
        ])
        const task = yield* client.StartTask({
          commandId: commandId(),
          projectId: project.id,
          workerId,
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
        yield* client.StopLaunch({ commandId: commandId(), id: launch.id })
        yield* Effect.flip(client.ReadLaunchPreview(readPreview))
        assert.strictEqual(managedStopped, 1)
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
        assert.isTrue(existsSync(join(workerPath, 'change.txt')))
        assert.isFalse(existsSync(join(placed[0]!.site, 'node_modules')))
        const setup = snapshot.items.filter((item) => item.kind === 'setup')
        assert.lengthOf(setup, 1)
        assert.include(JSON.stringify(setup[0]?.content), 'Setup completed on the worker.')
        assert.isUndefined(permission(snapshot))
      }),
    ),
  )
})
