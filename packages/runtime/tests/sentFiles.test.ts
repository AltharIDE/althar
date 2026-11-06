import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import { Api, clientProtocol, emitterPort, MESSAGE_FILES, type ThreadItem, type ThreadSnapshot } from '@althar/contracts'
import { assert, describe, it } from '@effect/vitest'
import { Context, Effect, Layer } from 'effect'
import { RpcClient } from 'effect/rpc'
import { SqlClient } from 'effect/sql'
import { until } from '@althar/testing/effect'

import { connection, services } from '../src/Api'
import { Folders } from '../src/Folders'
import { Secrets } from '../src/Secrets'
import { filesForTurn, keepFiles, requestFilesForTurn } from '../src/sentFiles'

import { fakeAgents, fakeConnectors, repository } from './support'

/*
 * The files the person sends with a message, at the edges the window doesn't
 * reach (ADR-064): asked of the runtime itself, with none or more than a
 * message carries, sent again from their copy, gone before the turn that
 * delivers them, and for a task whose folder isn't here any more.
 */

const commandId = () => `cmd_${randomBytes(16).toString('hex')}`

/** The person's own folder, as Downloads is: a file, a log and a folder of logs. */
const downloads = () => {
  const folder = mkdtempSync(join(tmpdir(), 'althar-downloads-'))
  writeFileSync(join(folder, 'spec.pdf'), '%PDF-1.7\nthe spec\n')
  writeFileSync(join(folder, 'build.log'), 'error: the build broke\nat line 2\n')
  mkdirSync(join(folder, 'logs'))
  writeFileSync(join(folder, 'logs', 'a.log'), 'a')
  return folder
}

const connected = Effect.gen(function* () {
  const channel = new MessageChannel()
  yield* Effect.addFinalizer(() => Effect.sync(() => channel.port1.close()))
  const context = yield* Layer.build(
    services({
      database: ':memory:',
      worktreeRoot: mkdtempSync(join(tmpdir(), 'althar-worktrees-')),
      appVersion: '0.0.0-test',
      deviceName: 'Test Mac',
      agents: fakeAgents({}, [], {}),
      secrets: Secrets.memory(),
      connectors: fakeConnectors({}),
      accountsRoot: mkdtempSync(join(tmpdir(), 'althar-accounts-')),
      artifactsRoot: mkdtempSync(join(tmpdir(), 'althar-artifacts-')),
    }),
  )
  yield* Effect.forkScoped(
    Layer.launch(
      connection(
        emitterPort(channel.port1, (data) => data),
        { kind: 'window' },
      ),
    ).pipe(Effect.provideContext(context)),
  )
  const protocol = yield* Layer.build(clientProtocol(emitterPort(channel.port2, (data) => data)))
  const client = yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
  const grant = (path: string) => Context.get(context, Folders).allow(path)
  return { client, grant, context, sql: Context.get(context, SqlClient.SqlClient) }
})

type Setup = Effect.Success<typeof connected>

const idle = (thread: ThreadSnapshot) => thread.session !== null && !thread.session.turnRunning
const said = (items: ReadonlyArray<ThreadItem>) => items.flatMap((item) => (item.kind === 'agent_message' ? [item.content.text] : []))
const messages = (items: ReadonlyArray<ThreadItem>) => items.flatMap((item) => (item.kind === 'user_message' ? [item] : []))

/** What the runtime does itself, as the API's handlers ask it, with its services. */
const provided = <A, E, R>(setup: Setup, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provideContext(setup.context as Context.Context<R>))

const refusal = <A, R>(setup: Setup, effect: Effect.Effect<A, unknown, R>) =>
  Effect.map(Effect.flip(provided(setup, effect)), (error) => (error as { readonly reason?: string }).reason)

describe('files sent with a message, asked of the runtime', () => {
  it.live('keeps none, refuses more than a message carries, and sends again a folder from its copy', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const setup = yield* connected
        const { client, grant } = setup
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        const task = yield* client.CreateTask({ commandId: commandId(), projectId: project.id, title: 'Read the logs' })
        const from = downloads()
        yield* client.StartSession({ commandId: commandId(), threadId: task.threadId, agentId: 'codex' })
        yield* until(client.GetThread({ threadId: task.threadId }), (thread) => idle(thread) && thread.items.length > 0)

        assert.deepStrictEqual(yield* provided(setup, keepFiles(task.threadId, [])), [])
        const many = yield* Effect.forEach(Array.from({ length: MESSAGE_FILES.count + 1 }), () =>
          Effect.map(grant(join(from, 'spec.pdf')), (one) => ({ grant: one })),
        )
        assert.strictEqual(yield* refusal(setup, keepFiles(task.threadId, many)), 'too_many')

        yield* client.Send({
          commandId: commandId(),
          threadId: task.threadId,
          body: 'Read these',
          disposition: 'after_current',
          files: [{ grant: yield* grant(join(from, 'build.log')) }, { grant: yield* grant(join(from, 'logs')) }],
        })
        const [message] = messages((yield* client.GetThread({ threadId: task.threadId })).items)
        const folder = message?.content.files.find((file) => file.name === 'logs')
        // A folder sent again is the copy Althar keeps, a folder still.
        const [again] = yield* provided(setup, keepFiles(task.threadId, [{ kept: folder?.id ?? '' }]))
        assert.strictEqual(again?.kind, 'folder')
        assert.isNull(again?.mediaType)
        assert.strictEqual(again?.path, folder?.path)
      }),
    ),
  )

  it.live('counts, for the turn that delivers them, the copies that aren’t there any more', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const setup = yield* connected
        const { client, grant, sql } = setup
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        const task = yield* client.CreateTask({ commandId: commandId(), projectId: project.id, title: 'Read the logs' })
        yield* client.StartSession({ commandId: commandId(), threadId: task.threadId, agentId: 'codex' })
        yield* until(client.GetThread({ threadId: task.threadId }), (thread) => idle(thread) && thread.items.length > 0)
        const from = downloads()
        assert.deepStrictEqual(yield* provided(setup, filesForTurn([])), { files: new Map(), gone: new Map() })
        yield* client.Send({
          commandId: commandId(),
          threadId: task.threadId,
          body: 'Read these',
          disposition: 'after_current',
          files: [
            { grant: yield* grant(join(from, 'spec.pdf')) },
            { grant: yield* grant(join(from, 'build.log')) },
            { grant: yield* grant(join(from, 'logs')) },
          ],
        })
        const kept = yield* sql<{ userInputId: string; path: string }>`SELECT user_input_id, path FROM user_input_files ORDER BY position`
        const inputId = kept[0]?.userInputId ?? ''
        // Two of their copies go before the turn that delivers them.
        rmSync(kept[0]?.path ?? '')
        rmSync(kept[1]?.path ?? '')
        const turn = yield* provided(setup, filesForTurn([inputId]))
        assert.strictEqual(turn.gone.get(inputId), 2)
        const folder = (turn.files.get(inputId) ?? []).find((one) => one.path === kept[2]?.path)
        assert.isTrue(folder?.folder)
        assert.notProperty(folder ?? {}, 'text')
      }),
    ),
  )

  it.live('copies what a task was made from again where its copy went, and says what can’t be', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const setup = yield* connected
        const { client, grant, sql } = setup
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        const coordinator = yield* client.GetCoordinator({ projectId: project.id })
        const from = downloads()
        yield* client.Send({
          commandId: commandId(),
          threadId: coordinator.threadId,
          body: 'Try this. [coordinator:start] [lead:finish]',
          disposition: 'after_current',
          files: [{ grant: yield* grant(join(from, 'build.log')) }, { grant: yield* grant(join(from, 'logs')) }],
        })
        const [made] = yield* until(
          sql<{ threadId: string; taskId: string }>`SELECT id AS thread_id, task_id FROM threads WHERE kind = 'task'`,
          (rows) => rows.length === 1,
        )
        const threadId = made?.threadId ?? ''
        const taskId = made?.taskId ?? ''
        yield* until(client.GetThread({ threadId }), (value) => said(value.items).some((text) => text.includes('saw files')))
        const [worktree] = yield* sql<{ path: string }>`SELECT path FROM workspaces`
        const request = join(worktree?.path ?? '', '.althar', 'attachments', 'request')

        // Already in the task's folder, they are given as they are: the log with its words, the folder without.
        const given = yield* provided(setup, requestFilesForTurn(threadId, taskId))
        assert.strictEqual(given.gone, 0)
        assert.deepStrictEqual(
          given.files.map((one) => [one.name, one.folder, 'text' in one]),
          [
            ['build.log', false, true],
            ['logs', true, false],
          ],
        )

        // Their copies in the task's folder go, and the coordinator's copy of the log too: the folder is copied again, the log can't be.
        rmSync(request, { recursive: true, force: true })
        const [log] = yield* sql<{ path: string }>`SELECT path FROM user_input_files WHERE name = 'build.log'`
        rmSync(log?.path ?? '')
        const again = yield* provided(setup, requestFilesForTurn(threadId, taskId))
        assert.strictEqual(again.gone, 1)
        assert.deepStrictEqual(
          again.files.map((one) => one.name),
          ['logs'],
        )
        assert.isTrue(existsSync(join(request, 'logs', 'a.log')))

        // With the task's folder gone, none of them can be.
        rmSync(worktree?.path ?? '', { recursive: true, force: true })
        assert.deepStrictEqual(yield* provided(setup, requestFilesForTurn(threadId, taskId)), { files: [], gone: 2 })
        assert.strictEqual(yield* refusal(setup, keepFiles(threadId, [{ grant: yield* grant(join(from, 'spec.pdf')) }])), 'nowhere')
      }),
    ),
  )
})
