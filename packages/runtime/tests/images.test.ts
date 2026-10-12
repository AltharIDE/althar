import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import { Api, clientProtocol, emitterPort, type ThreadItem, type ThreadSnapshot } from '@althar/contracts'
import { type FakeAgentOptions, SCREENSHOT_PNG } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Context, Effect, Layer } from 'effect'
import { RpcClient } from 'effect/rpc'
import { SqlClient } from 'effect/sql'

import { artifactPath } from '../src/Artifacts'
import { connection, services } from '../src/Api'
import { Folders } from '../src/Folders'
import { promptFor } from '../src/Sessions'
import { Secrets } from '../src/Secrets'
import { transcript } from '../src/threads'

import { fakeAgents, fakeConnectors, repository } from './support'

/*
 * Images the person sends with a message, through the API as the window
 * sends them: kept in the artifact store, named on the message, and sent to
 * the agent as image blocks with its words in the turn that delivers it,
 * after a restart too; said to the person and the agent where the agent
 * doesn't take images; and refused, whole, where one can't be sent.
 */

const commandId = () => `cmd_${randomBytes(16).toString('hex')}`

const PNG = Buffer.from(SCREENSHOT_PNG, 'base64')
/** A JPEG's start and its frame's header, 640 wide and 400 high: enough for its kind and size. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 8, 0x01, 0x90, 0x02, 0x80, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0])
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const png = { data: SCREENSHOT_PNG, name: 'shot.png' }
const jpeg = { data: JPEG.toString('base64'), name: 'photo.jpg' }

/** The runtime serving the API on one end of a channel and a client on the other, over a database and a store that may outlive it. */
const connected = (
  options: {
    readonly database?: string
    readonly artifactsRoot?: string
    readonly each?: Readonly<Record<string, FakeAgentOptions>>
  } = {},
) =>
  Effect.gen(function* () {
    const channel = new MessageChannel()
    yield* Effect.addFinalizer(() => Effect.sync(() => channel.port1.close()))
    const context = yield* Layer.build(
      services({
        database: options.database ?? ':memory:',
        worktreeRoot: mkdtempSync(join(tmpdir(), 'althar-worktrees-')),
        appVersion: '0.0.0-test',
        deviceName: 'Test Mac',
        agents: fakeAgents({}, [], options.each ?? {}),
        secrets: Secrets.memory(),
        connectors: fakeConnectors({}),
        accountsRoot: mkdtempSync(join(tmpdir(), 'althar-accounts-')),
        artifactsRoot: options.artifactsRoot ?? mkdtempSync(join(tmpdir(), 'althar-artifacts-')),
      }),
    )
    yield* Effect.forkScoped(Layer.launch(connection(emitterPort(channel.port1, (data) => data))).pipe(Effect.provideContext(context)))
    const protocol = yield* Layer.build(clientProtocol(emitterPort(channel.port2, (data) => data)))
    const client = yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
    const grant = (path: string) => Context.get(context, Folders).allow(path)
    return { client, grant, sql: Context.get(context, SqlClient.SqlClient) }
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

const idle = (thread: ThreadSnapshot) => thread.session !== null && !thread.session.turnRunning
const said = (items: ReadonlyArray<ThreadItem>) => items.flatMap((item) => (item.kind === 'agent_message' ? [item.content.text] : []))
const messages = (items: ReadonlyArray<ThreadItem>) => items.flatMap((item) => (item.kind === 'user_message' ? [item] : []))

/** A project, a task on it, and its lead started and waiting. */
const taskWithLead = (setup: Effect.Success<ReturnType<typeof connected>>, agentId = 'codex') =>
  Effect.gen(function* () {
    const { client, grant } = setup
    const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
    const task = yield* client.CreateTask({ commandId: commandId(), projectId: project.id, title: 'Fix the layout' })
    yield* client.StartSession({ commandId: commandId(), threadId: task.threadId, agentId })
    yield* eventually(client.GetThread({ threadId: task.threadId }), (thread) => idle(thread) && thread.items.length > 0)
    return { project, task }
  })

describe('images sent with a message', () => {
  it.live('go to the agent as image blocks after its words, and show on the message, kept in the store by their digests', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const setup = yield* connected()
        const { client, sql } = setup
        const { task } = yield* taskWithLead(setup)
        const send = { commandId: commandId(), threadId: task.threadId, body: 'What is off here?', disposition: 'after_current' as const }
        yield* client.Send({ ...send, images: [png, jpeg] })
        const thread = yield* eventually(client.GetThread({ threadId: task.threadId }), (value) =>
          said(value.items).some((text) => text.includes('echo: What is off here?')),
        )
        assert.include(said(thread.items).join('\n'), `saw images: image/png ${PNG.length} B, image/jpeg ${JPEG.length} B`)
        const [message] = messages(thread.items)
        assert.deepStrictEqual(message?.content.pictures, [
          { digest: digest(PNG), mediaType: 'image/png', bytes: PNG.length, width: 480, height: 300, name: 'shot.png', unkept: null },
          { digest: digest(JPEG), mediaType: 'image/jpeg', bytes: JPEG.length, width: 640, height: 400, name: 'photo.jpg', unkept: null },
        ])
        // The input names them in order, each an artifact the input and its message refer to.
        const named = yield* sql<{ position: number; sha256: string }>`
          SELECT ii.position, a.sha256 FROM user_input_images ii JOIN artifacts a ON a.id = ii.artifact_id ORDER BY ii.position`
        assert.deepStrictEqual(
          named.map((row) => [row.position, row.sha256]),
          [
            [1, digest(PNG)],
            [2, digest(JPEG)],
          ],
        )
        const links = yield* sql<{
          subjectType: string
        }>`SELECT subject_type FROM artifact_links WHERE role = 'image' ORDER BY subject_type`
        assert.deepStrictEqual(
          links.map((link) => link.subjectType),
          ['thread_item', 'thread_item', 'user_input', 'user_input'],
        )
        // Sent again under the same command, it is the same message: nothing is said twice.
        yield* client.Send({ ...send, images: [png, jpeg] })
        assert.lengthOf(messages((yield* client.GetThread({ threadId: task.threadId })).items), 1)
        // The same command with other images is another command, and refused.
        const reused = yield* Effect.flip(client.Send({ ...send, images: [png] }))
        assert.strictEqual(reused.reason, 'CommandIdReused')

        // An image Althar keeps goes again by its digest, as when a message waiting its turn is changed.
        yield* client.Send({
          commandId: commandId(),
          threadId: task.threadId,
          body: 'And now?',
          disposition: 'after_current',
          images: [{ digest: digest(PNG), name: 'shot.png' }],
        })
        const again = yield* eventually(client.GetThread({ threadId: task.threadId }), (value) =>
          said(value.items).some((text) => text.includes('echo: And now?')),
        )
        assert.include(said(again.items).join('\n'), `saw images: image/png ${PNG.length} B\n`)
        assert.deepStrictEqual(
          messages(again.items).map((item) => item.content.pictures.map((picture) => picture.name)),
          [['shot.png', 'photo.jpg'], ['shot.png']],
        )
        // Images alone are a message too.
        yield* client.Send({ commandId: commandId(), threadId: task.threadId, body: '', disposition: 'after_current', images: [jpeg] })
        yield* eventually(client.GetThread({ threadId: task.threadId }), (value) =>
          said(value.items).some((text) => text.startsWith(`saw images: image/jpeg ${JPEG.length} B\n\necho: `)),
        )
      }),
    ),
  )

  it.live('go to the coordinator with what the person says to it, which starts it', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant } = yield* connected()
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        const coordinator = yield* client.GetCoordinator({ projectId: project.id })
        yield* client.Send({
          commandId: commandId(),
          threadId: coordinator.threadId,
          body: 'This is the bug.',
          disposition: 'after_current',
          images: [png],
        })
        const heard = yield* eventually(client.GetCoordinator({ projectId: project.id }), (snapshot) =>
          said(snapshot.items).some((text) => text.includes('saw images')),
        )
        assert.include(said(heard.items).join('\n'), `saw images: image/png ${PNG.length} B`)
        assert.strictEqual(messages(heard.items)[0]?.content.pictures[0]?.digest, digest(PNG))
      }),
    ),
  )

  it.live('are said to the person and the agent, not dropped, where the agent doesn’t take images', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const setup = yield* connected({ each: { codex: { images: false } } })
        const { client } = setup
        const { task } = yield* taskWithLead(setup)
        yield* client.Send({
          commandId: commandId(),
          threadId: task.threadId,
          body: 'Look',
          disposition: 'after_current',
          images: [png, jpeg],
        })
        const thread = yield* eventually(client.GetThread({ threadId: task.threadId }), (value) =>
          said(value.items).some((text) => text.startsWith('echo: Look')),
        )
        assert.include(said(thread.items), "echo: Look\n\n(The person sent 2 images with this, which Althar couldn't pass on to you.)")
        assert.notInclude(said(thread.items).join('\n'), 'saw images')
        const notices = thread.items.flatMap((item) => (item.kind === 'notice' ? [item.content.title] : []))
        assert.include(notices, "Fake codex doesn't take images, so the 2 images you sent weren't passed on to it.")
        // The message keeps them all the same.
        assert.lengthOf(messages(thread.items)[0]?.content.pictures ?? [], 2)
        // The window knows which agents take images, from what each said when it started or was asked.
        const catalog = yield* eventually(client.GetModels({}), (all) => all.every((agent) => !agent.probing))
        assert.deepStrictEqual(
          catalog.map((agent) => [agent.agentId, agent.images]),
          [
            ['claude-code', true],
            ['codex', false],
            ['opencode', true],
          ],
        )
      }),
    ),
  )

  it.live('are refused whole where one can’t be sent, and nothing of the message is', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const setup = yield* connected()
        const { client } = setup
        const { task } = yield* taskWithLead(setup)
        const refused = (
          images: ReadonlyArray<
            { readonly data: string; readonly name: string | null } | { readonly digest: string; readonly name: string | null }
          >,
        ) =>
          Effect.map(
            Effect.flip(
              client.Send({ commandId: commandId(), threadId: task.threadId, body: 'Look', disposition: 'after_current', images }),
            ),
            (error) => error.message,
          )
        const svg = { data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64'), name: 'logo.svg' }
        assert.strictEqual(yield* refused([png, svg]), "logo.svg isn't a PNG, JPEG, GIF or WebP image, so it can't be sent.")
        const huge = Buffer.alloc(5 * 1024 * 1024 + 1)
        PNG.copy(huge)
        assert.strictEqual(
          yield* refused([{ data: huge.toString('base64'), name: null }]),
          "An image is larger than 5 MB, so it can't be sent.",
        )
        assert.strictEqual(yield* refused([{ digest: 'f'.repeat(64), name: 'old.png' }]), "old.png isn't kept any more. Add it again.")
        // More than a message carries doesn't leave the window.
        const many = yield* Effect.exit(
          client.Send({
            commandId: commandId(),
            threadId: task.threadId,
            body: 'Look',
            disposition: 'after_current',
            images: Array.from({ length: 11 }, () => png),
          }),
        )
        assert.strictEqual(many._tag, 'Failure')
        assert.lengthOf(messages((yield* client.GetThread({ threadId: task.threadId })).items), 0)
      }),
    ),
  )

  it.live('are kept through a restart, and sent with the message when it is delivered then', () =>
    Effect.gen(function* () {
      const database = join(mkdtempSync(join(tmpdir(), 'althar-db-')), 'profile.sqlite')
      const artifactsRoot = mkdtempSync(join(tmpdir(), 'althar-artifacts-'))
      // Said to a task with no lead yet: it waits in the queue.
      const threadId = yield* Effect.scoped(
        Effect.gen(function* () {
          const { client, grant } = yield* connected({ database, artifactsRoot })
          const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
          const task = yield* client.CreateTask({ commandId: commandId(), projectId: project.id, title: 'Fix the layout' })
          yield* client.Send({
            commandId: commandId(),
            threadId: task.threadId,
            body: 'Here',
            disposition: 'after_current',
            images: [jpeg],
          })
          return task.threadId
        }),
      )
      assert.isTrue(existsSync(artifactPath(artifactsRoot, digest(JPEG))))
      yield* Effect.scoped(
        Effect.gen(function* () {
          const { client } = yield* connected({ database, artifactsRoot })
          const before = yield* client.GetThread({ threadId })
          assert.strictEqual(messages(before.items)[0]?.content.pictures[0]?.name, 'photo.jpg')
          yield* client.StartSession({ commandId: commandId(), threadId, agentId: 'codex' })
          const thread = yield* eventually(client.GetThread({ threadId }), (value) =>
            said(value.items).some((text) => text.includes('saw images')),
          )
          assert.include(said(thread.items).join('\n'), `saw images: image/jpeg ${JPEG.length} B`)
        }),
      )
    }),
  )
})

describe('what is said of images', () => {
  it('tells the agent of images it doesn’t get, in what the person said', () => {
    assert.strictEqual(
      promptFor([{ body: 'Look', disposition: 'after_current', withheld: 1 }], undefined),
      "Look\n\n(The person sent an image with this, which Althar couldn't pass on to you.)",
    )
    assert.strictEqual(
      promptFor([{ body: '', disposition: 'interrupt_and_continue', withheld: 3 }], undefined),
      "The person interrupted your last turn to say:\n\n(The person sent 3 images with this, which Althar couldn't pass on to you.)\n\nTake it into account, and carry on with the task.",
    )
  })

  it.live('says in a handover which messages had images', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const setup = yield* connected()
        const { client, sql } = setup
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* setup.grant(repository()) })
        const task = yield* client.CreateTask({ commandId: commandId(), projectId: project.id, title: 'Fix the layout' })
        yield* client.Send({ commandId: commandId(), threadId: task.threadId, body: 'One', disposition: 'after_current', images: [png] })
        yield* client.Send({
          commandId: commandId(),
          threadId: task.threadId,
          body: 'Two',
          disposition: 'after_current',
          images: [png, jpeg],
        })
        yield* client.Send({ commandId: commandId(), threadId: task.threadId, body: 'Three', disposition: 'after_current' })
        const record = yield* transcript(task.threadId, 10_000).pipe(Effect.provideService(SqlClient.SqlClient, sql))
        assert.include(record.text, '[person] One [sent an image]\n[person] Two [sent 2 images]\n[person] Three')
      }),
    ),
  )
})
