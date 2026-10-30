import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  appendFileSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import { Api, clientProtocol, emitterPort, MESSAGE_FILES, type ThreadItem, type ThreadSnapshot } from '@althar/contracts'
import { type FakeAgentOptions, SCREENSHOT_PNG } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Context, Effect, Layer } from 'effect'
import { RpcClient } from 'effect/rpc'
import { SqlClient } from 'effect/sql'
import { until } from '@althar/testing/effect'

import { connection, services } from '../src/Api'
import { copyTo, measure, wordsOf } from '../src/attachments'
import { Folders } from '../src/Folders'
import { promptFor, sentWithWords } from '../src/Sessions'
import { Secrets } from '../src/Secrets'
import { transcript } from '../src/threads'

import { fakeAgents, fakeConnectors, repository } from './support'

/*
 * Files and folders the person sends with a message, through the API as the
 * window sends them (ADR-064): by the grant main gave for each, copied into
 * the thread's folder under `.althar/attachments`, which git ignores, named
 * on the message, and linked in the prompt of the turn that delivers it, for
 * the agent to open by its path; a small text file's words go too, to an
 * agent that takes them. Refused, whole, where one can't be sent.
 */

const commandId = () => `cmd_${randomBytes(16).toString('hex')}`

/** The person's own folder, as Downloads is: outside every folder an agent reads. */
const downloads = () => {
  const folder = mkdtempSync(join(tmpdir(), 'althar-downloads-'))
  writeFileSync(join(folder, 'spec.pdf'), '%PDF-1.7\nthe spec\n')
  writeFileSync(join(folder, 'build.log'), 'error: the build broke\nat line 2\n')
  mkdirSync(join(folder, 'logs', 'older'), { recursive: true })
  writeFileSync(join(folder, 'logs', 'a.log'), 'a')
  writeFileSync(join(folder, 'logs', 'older', 'b.log'), 'bb')
  // A link in a folder isn't followed, nor copied.
  symlinkSync(join(folder, 'spec.pdf'), join(folder, 'logs', 'linked.pdf'))
  return folder
}

const connected = (options: { readonly each?: Readonly<Record<string, FakeAgentOptions>> } = {}) =>
  Effect.gen(function* () {
    const channel = new MessageChannel()
    yield* Effect.addFinalizer(() => Effect.sync(() => channel.port1.close()))
    const worktreeRoot = mkdtempSync(join(tmpdir(), 'althar-worktrees-'))
    const context = yield* Layer.build(
      services({
        database: ':memory:',
        worktreeRoot,
        appVersion: '0.0.0-test',
        deviceName: 'Test Mac',
        agents: fakeAgents({}, [], options.each ?? {}),
        secrets: Secrets.memory(),
        connectors: fakeConnectors({}),
        accountsRoot: mkdtempSync(join(tmpdir(), 'althar-accounts-')),
        artifactsRoot: mkdtempSync(join(tmpdir(), 'althar-artifacts-')),
      }),
    )
    yield* Effect.forkScoped(Layer.launch(connection(emitterPort(channel.port1, (data) => data))).pipe(Effect.provideContext(context)))
    const protocol = yield* Layer.build(clientProtocol(emitterPort(channel.port2, (data) => data)))
    const client = yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
    const grant = (path: string) => Context.get(context, Folders).allow(path)
    return { client, grant, worktreeRoot, sql: Context.get(context, SqlClient.SqlClient) }
  })

const idle = (thread: ThreadSnapshot) => thread.session !== null && !thread.session.turnRunning
const said = (items: ReadonlyArray<ThreadItem>) => items.flatMap((item) => (item.kind === 'agent_message' ? [item.content.text] : []))
const messages = (items: ReadonlyArray<ThreadItem>) => items.flatMap((item) => (item.kind === 'user_message' ? [item] : []))

const taskWithLead = (setup: Effect.Success<ReturnType<typeof connected>>) =>
  Effect.gen(function* () {
    const { client, grant } = setup
    const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
    const task = yield* client.CreateTask({ commandId: commandId(), projectId: project.id, title: 'Read the spec' })
    yield* client.StartSession({ commandId: commandId(), threadId: task.threadId, agentId: 'codex' })
    yield* until(client.GetThread({ threadId: task.threadId }), (thread) => idle(thread) && thread.items.length > 0)
    const [worktree] = yield* setup.sql<{ path: string }>`SELECT path FROM workspaces`
    return { project, task, worktree: worktree?.path ?? '' }
  })

describe('files sent with a message', () => {
  it.live('are copied into the task’s worktree, where git ignores them, linked for the agent to open, and shown on the message', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const setup = yield* connected()
        const { client, grant, sql } = setup
        const { task, worktree } = yield* taskWithLead(setup)
        const from = downloads()
        const files = [
          { grant: yield* grant(join(from, 'spec.pdf')) },
          { grant: yield* grant(join(from, 'build.log')) },
          { grant: yield* grant(join(from, 'logs')) },
        ]
        yield* client.Send({ commandId: commandId(), threadId: task.threadId, body: 'Read these', disposition: 'after_current', files })
        const thread = yield* until(client.GetThread({ threadId: task.threadId }), (value) =>
          said(value.items).some((text) => text.includes('echo: Read these')),
        )
        // The agent opened each copy by its path, as it would with its own tools.
        const heard = said(thread.items).join('\n')
        assert.include(heard, 'spec.pdf (linked, application/pdf, 18 B): %PDF-1.7')
        assert.include(heard, 'build.log (linked, text/plain, 33 B): error: the build broke')
        // A folder is linked as one, its link left out.
        assert.include(heard, 'logs (linked folder): a.log, older')
        const [message] = messages(thread.items)
        const kept = message?.content.files ?? []
        assert.deepStrictEqual(
          kept.map(({ name, kind, mediaType, bytes, entries }) => ({ name, kind, mediaType, bytes, entries })),
          [
            { name: 'spec.pdf', kind: 'file', mediaType: 'application/pdf', bytes: 18, entries: null },
            { name: 'build.log', kind: 'file', mediaType: 'text/plain', bytes: 33, entries: null },
            { name: 'logs', kind: 'folder', mediaType: null, bytes: 3, entries: 2 },
          ],
        )
        for (const file of kept) assert.isTrue(file.path.startsWith(join(worktree, '.althar', 'attachments')), file.path)
        assert.strictEqual(readFileSync(kept[0]?.path ?? '', 'utf8'), '%PDF-1.7\nthe spec\n')
        assert.isFalse(existsSync(join(kept[2]?.path ?? '', 'linked.pdf')))
        // Never committed: git sees nothing new in the worktree.
        assert.strictEqual(readFileSync(join(worktree, '.althar', 'attachments', '.gitignore'), 'utf8'), '*\n')
        assert.strictEqual(execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: worktree, encoding: 'utf8' }), '')
        // The input names them in order, with where each copy is.
        const rows = yield* sql<{ position: number; name: string }>`SELECT position, name FROM user_input_files ORDER BY position`
        assert.deepStrictEqual(
          rows.map((row) => [row.position, row.name]),
          [
            [1, 'spec.pdf'],
            [2, 'build.log'],
            [3, 'logs'],
          ],
        )
        // An agent taking the thread over reads where the copies are.
        assert.include(
          (yield* transcript(task.threadId, 10_000).pipe(Effect.provideService(SqlClient.SqlClient, sql))).text,
          `[sent 3 files: ${kept.map((file) => file.path).join(', ')}]`,
        )

        // A copy Althar keeps goes again by its id, as when a message waiting its turn is changed: the same copy.
        yield* client.Send({
          commandId: commandId(),
          threadId: task.threadId,
          body: 'Again',
          disposition: 'after_current',
          files: [{ kept: kept[0]?.id ?? '' }],
        })
        const again = yield* until(client.GetThread({ threadId: task.threadId }), (value) =>
          said(value.items).some((text) => text.includes('echo: Again')),
        )
        assert.strictEqual(messages(again.items)[1]?.content.files[0]?.path, kept[0]?.path)
        // Files alone are a message too; one dropped as a link goes as what it points at.
        yield* client.Send({
          commandId: commandId(),
          threadId: task.threadId,
          body: '',
          disposition: 'after_current',
          files: [{ grant: yield* grant(join(from, 'logs', 'linked.pdf')) }],
        })
        const alone = yield* until(client.GetThread({ threadId: task.threadId }), (value) =>
          said(value.items).some((text) => text.startsWith('saw files: linked.pdf (linked')),
        )
        const linkedCopy = messages(alone.items)[2]?.content.files[0]?.path ?? ''
        assert.isFalse(lstatSync(linkedCopy).isSymbolicLink())
        assert.strictEqual(readFileSync(linkedCopy, 'utf8'), '%PDF-1.7\nthe spec\n')
      }),
    ),
  )

  it.live('put a small text file’s words in the prompt for an agent that takes them, and link the rest', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const setup = yield* connected({ each: { codex: { embeddedContext: true } } })
        const { client, grant } = setup
        const { task } = yield* taskWithLead(setup)
        const from = downloads()
        yield* client.Send({
          commandId: commandId(),
          threadId: task.threadId,
          body: 'Why?',
          disposition: 'after_current',
          files: [{ grant: yield* grant(join(from, 'build.log')) }, { grant: yield* grant(join(from, 'logs')) }],
        })
        const thread = yield* until(client.GetThread({ threadId: task.threadId }), (value) =>
          said(value.items).some((text) => text.includes('echo: Why?')),
        )
        assert.include(said(thread.items).join('\n'), 'saw files: build.log (embedded): error: the build broke; logs (linked folder)')
      }),
    ),
  )

  it.live('go to the coordinator in its own folder, beside the copies it gets afresh each turn, which keep them', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant, worktreeRoot } = yield* connected()
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        const coordinator = yield* client.GetCoordinator({ projectId: project.id })
        const from = downloads()
        yield* client.Send({
          commandId: commandId(),
          threadId: coordinator.threadId,
          body: 'Plan from this.',
          disposition: 'after_current',
          files: [{ grant: yield* grant(join(from, 'spec.pdf')) }],
        })
        const heard = yield* until(client.GetCoordinator({ projectId: project.id }), (snapshot) =>
          said(snapshot.items).some((text) => text.includes('saw files')),
        )
        assert.include(said(heard.items).join('\n'), 'saw files: spec.pdf (linked, application/pdf, 18 B): %PDF-1.7')
        const path = messages(heard.items)[0]?.content.files[0]?.path ?? ''
        assert.isTrue(path.startsWith(worktreeRoot) && path.includes(join('.coordinator', '.althar', 'attachments')), path)
        // Its next turn makes its copies afresh, and the file stays.
        yield* client.Send({ commandId: commandId(), threadId: coordinator.threadId, body: 'And?', disposition: 'after_current' })
        yield* until(client.GetCoordinator({ projectId: project.id }), (snapshot) => said(snapshot.items).length > 1)
        assert.isTrue(existsSync(path))
      }),
    ),
  )

  it.live('are refused whole where one can’t be sent, and nothing of the message is', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const setup = yield* connected()
        const { client, grant } = setup
        const { task, worktree } = yield* taskWithLead(setup)
        const from = downloads()
        const huge = join(from, 'huge.zip')
        writeFileSync(huge, '')
        truncateSync(huge, MESSAGE_FILES.bytes + 1)
        const refused = (files: ReadonlyArray<{ readonly grant: string } | { readonly kept: string }>) =>
          Effect.map(
            Effect.flip(
              client.Send({ commandId: commandId(), threadId: task.threadId, body: 'Look', disposition: 'after_current', files }),
            ),
            (error) => error.message,
          )
        assert.strictEqual(
          yield* refused([{ grant: yield* grant(join(from, 'spec.pdf')) }, { grant: yield* grant(huge) }]),
          "huge.zip is larger than 50 MB, so it can't be sent.",
        )
        assert.strictEqual(yield* refused([{ grant: 'grant_gone' }]), "A file isn't there any more. Add it again.")
        assert.strictEqual(yield* refused([{ kept: 'input_0:1' }]), "A file isn't there any more. Add it again.")
        assert.strictEqual(yield* refused([{ grant: yield* grant(join(from, 'nothing-here')) }]), "Althar couldn't read nothing-here.")
        // Nothing was copied for a message refused, nor said.
        assert.isFalse(existsSync(join(worktree, '.althar', 'attachments')))
        assert.lengthOf(messages((yield* client.GetThread({ threadId: task.threadId })).items), 0)
      }),
    ),
  )
})

describe('measure', () => {
  it('stops walking a folder as soon as it holds too many files', () => {
    const folder = mkdtempSync(join(tmpdir(), 'althar-many-'))
    for (let n = 0; n <= MESSAGE_FILES.entries; n += 1) writeFileSync(join(folder, `${n}.txt`), '')
    assert.deepStrictEqual(measure(folder), { ok: false, why: 'too_many_files' })
    assert.deepStrictEqual(measure(join(folder, '0.txt')), { ok: true, kind: 'file', bytes: 0, entries: null })
  })

  it('reads a small file’s words only where it is text', () => {
    const folder = mkdtempSync(join(tmpdir(), 'althar-words-'))
    writeFileSync(join(folder, 'a.csv'), 'a,b\n1,2\n')
    writeFileSync(join(folder, 'b.bin'), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]))
    writeFileSync(join(folder, 'c.txt'), Buffer.from([0xc3, 0x28]))
    assert.strictEqual(wordsOf(join(folder, 'a.csv'), 8), 'a,b\n1,2\n')
    assert.isNull(wordsOf(join(folder, 'b.bin'), 6))
    assert.isNull(wordsOf(join(folder, 'c.txt'), 2), 'not UTF-8')
    assert.isNull(wordsOf(join(folder, 'a.csv'), MESSAGE_FILES.embedded + 1), 'too large to embed')
  })
})

describe('copyTo', () => {
  it('counts what it copies, not what was measured: a file grown since is refused, and nothing of it is left', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'althar-grown-'))
    const log = join(folder, 'run.log')
    writeFileSync(log, 'one line\n')
    assert.deepStrictEqual(measure(log), { ok: true, kind: 'file', bytes: 9, entries: null })
    // The log grows between being measured and being copied.
    appendFileSync(log, 'x'.repeat(64))
    const target = join(folder, 'copy.log')
    assert.deepStrictEqual(await copyTo(log, target, { bytes: 32, entries: 10 }), { ok: false, why: 'too_large' })
    assert.isFalse(existsSync(target))
    // Within the budget, the copy says what it copied: all of it, as it is now.
    assert.deepStrictEqual(await copyTo(log, target, { bytes: 100, entries: 10 }), { ok: true, kind: 'file', bytes: 73, entries: null })
    assert.strictEqual(readFileSync(target, 'utf8').length, 73)
  })

  it('stops copying a folder given more files since it was measured, and takes the copy away', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'althar-filling-'))
    const logs = join(folder, 'logs')
    mkdirSync(join(logs, 'older'), { recursive: true })
    writeFileSync(join(logs, 'a.log'), 'a\n')
    assert.deepStrictEqual(measure(logs), { ok: true, kind: 'folder', bytes: 2, entries: 1 })
    writeFileSync(join(logs, 'b.log'), 'b\n')
    writeFileSync(join(logs, 'older', 'c.log'), 'c\n')
    const target = join(folder, 'copy')
    assert.deepStrictEqual(await copyTo(logs, target, { bytes: 1000, entries: 2 }), { ok: false, why: 'too_many_files' })
    assert.isFalse(existsSync(target))
    assert.deepStrictEqual(await copyTo(logs, target, { bytes: 5, entries: 10 }), { ok: false, why: 'too_large' })
    assert.isFalse(existsSync(target))
  })

  it('copies a folder’s files with their modes, and leaves its links out', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'althar-copy-'))
    const tools = join(folder, 'tools')
    mkdirSync(join(tools, 'bin'), { recursive: true })
    writeFileSync(join(tools, 'bin', 'run.sh'), '#!/bin/sh\n')
    chmodSync(join(tools, 'bin', 'run.sh'), 0o755)
    symlinkSync('/etc/hosts', join(tools, 'hosts'))
    symlinkSync('/etc', join(tools, 'etc'))
    const target = join(folder, 'copy')
    assert.deepStrictEqual(await copyTo(tools, target), { ok: true, kind: 'folder', bytes: 10, entries: 1 })
    // Windows keeps no modes of this kind: a file there reads 0o666 whatever it was given.
    if (process.platform !== 'win32') assert.strictEqual(statSync(join(target, 'bin', 'run.sh')).mode & 0o777, 0o755)
    assert.isFalse(existsSync(join(target, 'hosts')))
    assert.isFalse(existsSync(join(target, 'etc')))
  })
})

describe('promptFor', () => {
  it('says a file whose copy is gone, so the agent can ask for it', () => {
    assert.strictEqual(
      promptFor([{ body: 'Look', disposition: 'after_current', filesGone: 2 }], undefined),
      "Look\n\n(The person sent 2 files with this whose copy isn't there any more. Ask for it if you need it.)",
    )
  })
})

describe('what the person sent with a message a task is made from', () => {
  /** A screenshot and a file, sent to the coordinator with words that have it make a task, and the task it made, once its lead has read its brief. */
  const madeFrom = (body: string, cues = '') =>
    Effect.gen(function* () {
      const { client, grant, sql } = yield* connected()
      const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
      const coordinator = yield* client.GetCoordinator({ projectId: project.id })
      const from = downloads()
      // Sent with no words, what it is to make plays from the file's.
      if (cues !== '') writeFileSync(join(from, 'build.log'), `error: the build broke ${cues}\nat line 2\n`)
      yield* client.Send({
        commandId: commandId(),
        threadId: coordinator.threadId,
        body,
        disposition: 'after_current',
        images: [{ data: SCREENSHOT_PNG, name: 'bug.png' }],
        files: [{ grant: yield* grant(join(from, 'build.log')) }],
      })
      const [made] = yield* until(
        sql<{ threadId: string }>`SELECT id AS thread_id FROM threads WHERE kind = 'task'`,
        (rows) => rows.length === 1,
      )
      const threadId = made?.threadId ?? ''
      // A plan the coordinator proposed waits for the person to start it.
      if (`${body}${cues}`.includes('[coordinator:plan]')) {
        const [plan] = yield* until(sql<{ id: string }>`SELECT id FROM task_plans`, (rows) => rows.length === 1)
        yield* client.StartPlan({ commandId: commandId(), planId: plan?.id ?? '' })
      }
      const thread = yield* until(client.GetThread({ threadId }), (value) => said(value.items).some((text) => text.includes('saw files')))
      const sent = messages((yield* client.GetCoordinator({ projectId: project.id })).items)[0]?.content
      const [brief] = yield* sql<{
        prompt: string
      }>`SELECT prompt FROM turn_deliveries WHERE thread_id = ${threadId} ORDER BY requested_at LIMIT 1`
      const [worktree] = yield* sql<{ path: string }>`SELECT path FROM workspaces`
      return { thread, sent, brief: brief?.prompt ?? '', worktree: worktree?.path ?? '', bytes: statSync(join(from, 'build.log')).size }
    })

  const opensWithThem = ({ thread, sent, brief, worktree, bytes }: Effect.Success<ReturnType<typeof madeFrom>>) => {
    // Its thread opens with them, as the coordinator's chat shows them.
    assert.deepStrictEqual(thread.task.requestPictures, sent?.pictures)
    assert.strictEqual(thread.task.requestPictures?.[0]?.name, 'bug.png')
    assert.deepStrictEqual(thread.task.requestFiles, sent?.files)
    // Its lead's first turn is sent them with its brief: the image as an image, the file copied into its worktree and linked there.
    const heard = said(thread.items).join('\n')
    assert.include(heard, `saw images: image/png ${Buffer.from(SCREENSHOT_PNG, 'base64').length} B`)
    assert.include(heard, `build.log (linked, text/plain, ${bytes} B): error: the build broke`)
    assert.include(brief, 'The person sent an image and a file with what they asked for: they come with this message.')
    assert.isTrue(existsSync(join(worktree, '.althar', 'attachments', 'request', 'build.log')))
  }

  it.live('go with a task the coordinator drafts and plans from it', () =>
    Effect.scoped(
      madeFrom('Did we fix this already. [coordinator:plan] [coordinator:plan-no-review] [lead:finish]').pipe(Effect.map(opensWithThem)),
    ),
  )

  it.live('go with a task the coordinator starts from it at once', () =>
    Effect.scoped(madeFrom('Try this. [coordinator:start] [lead:finish]').pipe(Effect.map(opensWithThem))),
  )

  it.live('go with a task drafted from them sent with no words, which opens with them alone', () =>
    Effect.scoped(
      madeFrom('', '[coordinator:plan] [coordinator:plan-no-review] [lead:finish]').pipe(
        Effect.map((made) => {
          opensWithThem(made)
          assert.isNull(made.thread.task.request)
        }),
      ),
    ),
  )

  it.live('go with a task started from them sent with no words', () =>
    Effect.scoped(madeFrom('', '[coordinator:start] [lead:finish]').pipe(Effect.map(opensWithThem))),
  )

  it('are said in the lead’s brief, and so are those it can’t be given', () => {
    assert.strictEqual(sentWithWords({ images: [], files: [], withheld: 0, gone: 0 }), '')
    assert.strictEqual(
      sentWithWords({ images: [1, 2], files: [], withheld: 0, gone: 0 }),
      'The person sent 2 images with what they asked for: they come with this message.',
    )
    assert.strictEqual(
      sentWithWords({ images: [], files: [1], withheld: 1, gone: 2 }),
      "The person sent a file with what they asked for: it comes with this message.\n\n(The person sent an image with what they asked for, which Althar couldn't pass on to you.)\n\n(The person sent 2 files with what they asked for whose copy isn't there any more. Ask for it if you need it.)",
    )
  })
})
