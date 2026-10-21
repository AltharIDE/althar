import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import { Api, clientProtocol, emitterPort, type ThreadSnapshot } from '@althar/contracts'
import { agents as registry } from '@althar/provider-adapters'
import { scenarios } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Context, Duration, Effect, Layer } from 'effect'
import { RpcClient } from 'effect/rpc'

import { connection, services } from '../src/Api'
import { type AgentEntry, Agents, type RuntimeOptions } from '../src/Config'
import { Folders } from '../src/Folders'
import { Secrets } from '../src/Secrets'

import { fakeAgents, fakeConnectors, ROOMY } from './support'

/*
 * More of the API, as the app's window has it: an agent Althar can download
 * for the person, a task of several repositories opened in an editor, and a
 * question the coordinator asks, answered from the window.
 */

const commandId = () => `cmd_${randomBytes(16).toString('hex')}`

const connected = (options: { readonly agents?: Layer.Layer<Agents>; readonly editors?: RuntimeOptions['editors'] } = {}) =>
  Effect.gen(function* () {
    const channel = new MessageChannel()
    yield* Effect.addFinalizer(() => Effect.sync(() => channel.port1.close()))
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
        ...(options.editors === undefined ? {} : { editors: options.editors }),
      }),
    )
    yield* Effect.forkScoped(Layer.launch(connection(emitterPort(channel.port1, (data) => data))).pipe(Effect.provideContext(context)))
    const protocol = yield* Layer.build(clientProtocol(emitterPort(channel.port2, (data) => data)))
    const client = yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
    const grant = (path: string) => Context.get(context, Folders).allow(path)
    return { client, grant }
  })

const eventually = <A>(effect: Effect.Effect<A, unknown>, check: (value: A) => boolean) =>
  Effect.gen(function* () {
    for (let tries = 0; tries < 250; tries += 1) {
      const value = yield* Effect.orDie(effect)
      if (check(value)) return value
      yield* Effect.sleep('20 millis')
    }
    return yield* Effect.die(new Error('Timed out'))
  })

const idle = (thread: { readonly session: ThreadSnapshot['session'] }) => thread.session !== null && !thread.session.turnRunning

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
        assert.strictEqual(opened?.[1], dirname(opened?.[2] ?? '').replace(/\/web$/, ''))
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
        yield* eventually(client.GetCoordinator({ projectId: project.id }), idle)
        yield* client.Send({ commandId: commandId(), threadId, body: scenarios.questions, disposition: 'after_current' })
        const asking = yield* eventually(client.GetCoordinator({ projectId: project.id }), (snapshot) =>
          snapshot.items.some((item) => item.kind === 'question' && item.content.state === 'open'),
        )
        const question = asking.items.find((item) => item.kind === 'question')
        const fields = question?.kind === 'question' ? question.content.fields : []
        yield* client.AnswerQuestion({
          commandId: commandId(),
          attentionId: question?.kind === 'question' ? question.content.attentionId : '',
          answers: Object.fromEntries(fields.map((field) => [field.id, { values: [field.options[0]?.value ?? ''] }])),
        })
        const answered = yield* eventually(
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
