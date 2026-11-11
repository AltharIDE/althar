import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import { Api, CANVASES_FOLDER, clientProtocol, emitterPort, type ThreadItem, type ThreadSnapshot } from '@althar/contracts'
import { assert, describe, it } from '@effect/vitest'
import { Context, Effect, Layer } from 'effect'
import { RpcClient } from 'effect/rpc'
import { SqlClient } from 'effect/sql'
import { until } from '@althar/testing/effect'

import { connection, services } from '../src/Api'
import { asideFor, canvasesIn, holdsOnly, isCopyPath, manifestOf, readCopy } from '../src/canvasFiles'
import { entryAmong, titleFromName } from '../src/Canvases'
import { Folders } from '../src/Folders'
import { Secrets } from '../src/Secrets'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeAgents, fakeConnectors, listTools, repository } from './support'

/*
 * A project's canvases (ADR-104): drawn by its agents, each a version for
 * every publish, and reached by every lead and the coordinator of the
 * project. An agent writes a canvas's files in its own folder and publishes
 * them; a publish made on a version that is no longer the latest is refused,
 * with the latest set aside to bring the change onto; getting a canvas never
 * overwrites edits; and the person's comments are kept with the message that
 * sends them, never before.
 */

const commandId = () => `cmd_${randomBytes(16).toString('hex')}`

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

/** What an agent with this access asks of Althar's tools, over MCP, as the runtime's own services serve it. */
const ask = (setup: Setup, access: ToolAccess, name: string, args?: Record<string, unknown>) =>
  callTool(access, name, args).pipe(Effect.provideContext(setup.context))

/** A project with two tasks whose leads have worktrees on this computer, each lead's access, and the coordinator's. */
const project = (setup: Setup) =>
  Effect.gen(function* () {
    const { client, grant, sql } = setup
    const opened = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
    const coordinator = yield* client.GetCoordinator({ projectId: opened.id })
    const lead = (title: string) =>
      Effect.gen(function* () {
        const task = yield* client.CreateTask({ commandId: commandId(), projectId: opened.id, title })
        yield* client.StartSession({ commandId: commandId(), threadId: task.threadId, agentId: 'codex' })
        yield* until(client.GetThread({ threadId: task.threadId }), (thread) => idle(thread) && thread.items.length > 0)
        const [worktree] = yield* sql<{ path: string }>`SELECT w.path FROM workspaces w WHERE w.task_id = ${task.id}`
        const access: ToolAccess = { role: 'lead', projectId: opened.id, threadId: task.threadId, sessionId: 'session', taskId: task.id }
        return { access, folder: worktree?.path ?? '', task }
      })
    const first = yield* lead('Redesign sign-in')
    const second = yield* lead('Build sign-in')
    const [folder] = yield* sql<{ slug: string }>`SELECT slug FROM projects WHERE id = ${opened.id}`
    const own: ToolAccess = {
      role: 'coordinator',
      projectId: opened.id,
      threadId: coordinator.threadId,
      sessionId: 'session',
      taskId: null,
    }
    return { project: opened, first, second, coordinator: own, coordinatorThread: coordinator.threadId, slug: folder?.slug ?? '' }
  })

/** Writes a canvas's files into an agent's folder, as its own tools would. */
const draw = (folder: string, path: string, files: Readonly<Record<string, string>>) => {
  for (const [name, words] of Object.entries(files)) {
    const target = join(folder, CANVASES_FOLDER, path, name)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, words)
  }
}

const canvasItems = (items: ReadonlyArray<ThreadItem>) => items.flatMap((item) => (item.kind === 'canvas' ? [item.content] : []))

describe('a canvas’s files', () => {
  it('are read whole, in path order, refusing a link, Althar’s own paths and what is over', () => {
    const root = canvasesIn(mkdtempSync(join(tmpdir(), 'althar-canvas-')))
    assert.strictEqual(readFileSync(join(root, '.gitignore'), 'utf8'), '*\n')
    assert.isFalse(readCopy(join(root, 'none')).ok)
    mkdirSync(join(root, 'empty'))
    assert.deepStrictEqual(readCopy(join(root, 'empty')), { ok: false, why: 'It has no files in it.' })
    draw(dirname(dirname(root)), 'flow', { 'index.html': '<h1>Flow</h1>', 'css/site.css': 'h1{}' })
    const read = readCopy(join(root, 'flow'))
    assert.isTrue(read.ok)
    if (read.ok)
      assert.deepStrictEqual(
        read.files.map((file) => file.path),
        ['css/site.css', 'index.html'],
      )
    draw(dirname(dirname(root)), 'held', { '.althar/state.json': '{}' })
    const held = readCopy(join(root, 'held'))
    assert.isFalse(held.ok)
    if (!held.ok) assert.include(held.why, 'Althar')
    draw(dirname(dirname(root)), 'linked', { 'a.md': '# A' })
    symlinkSync('/etc/hosts', join(root, 'linked', 'hosts'))
    const linked = readCopy(join(root, 'linked'))
    assert.isFalse(linked.ok)
    if (!linked.ok) assert.include(linked.why, 'is a link')
  })

  it('are told unchanged from what was put there, and set aside under the next free name', () => {
    const root = canvasesIn(mkdtempSync(join(tmpdir(), 'althar-canvas-')))
    draw(dirname(dirname(root)), 'flow', { 'index.md': '# Flow' })
    const read = readCopy(join(root, 'flow'))
    assert.isTrue(read.ok)
    if (!read.ok) return
    const manifest = manifestOf('index.md', read.files)
    assert.isTrue(holdsOnly(join(root, 'flow'), manifest))
    writeFileSync(join(root, 'flow', 'index.md'), '# Flow, changed')
    assert.isFalse(holdsOnly(join(root, 'flow'), manifest))
    assert.deepStrictEqual(
      asideFor(root, 'flow', 3, () => false),
      { path: 'flow@3', reuse: false },
    )
    mkdirSync(join(root, 'flow@3'))
    assert.deepStrictEqual(
      asideFor(root, 'flow', 3, () => false),
      { path: 'flow@3-2', reuse: false },
    )
    assert.deepStrictEqual(
      asideFor(root, 'flow', 3, (path) => path === 'flow@3'),
      { path: 'flow@3', reuse: true },
    )
    assert.isTrue(isCopyPath('flow@3-2'))
    assert.isFalse(isCopyPath('../flow'))
    assert.isFalse(isCopyPath('flow@0'))
  })

  it('are drawn from an index, a README or the one file where the agent names none, and titled from their name', () => {
    const file = (path: string) => ({ path, bytes: new Uint8Array() })
    assert.strictEqual(entryAmong([file('a.svg')], null), 'a.svg')
    assert.strictEqual(entryAmong([file('app.js'), file('index.html')], null), 'index.html')
    assert.strictEqual(entryAmong([file('README.md'), file('x.png')], null), 'README.md')
    assert.strictEqual(entryAmong([file('a.md'), file('b.md')], 'b.md'), 'b.md')
    assert.isNull(entryAmong([file('a.md'), file('b.md')], null))
    assert.strictEqual(titleFromName('login-flow'), 'Login flow')
  })
})

describe('a project’s canvases', () => {
  it.live(
    'are the project’s: one lead publishes, the coordinator and another lead get, change and publish it, and a stale copy is set aside',
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const setup = yield* connected
          const { first, second, coordinator, project: opened } = yield* project(setup)

          assert.include(yield* ask(setup, first.access, 'canvas_list'), 'no canvases yet')
          draw(first.folder, 'sign-in', { 'index.html': '<h1>Sign in</h1>', 'site.css': 'h1 { color: red }' })
          const published = yield* ask(setup, first.access, 'canvas_publish', { name: 'sign-in', note: 'First cut' })
          assert.include(published, 'Published sign-in v1, a new canvas of the project’s: Sign in, 2 files, drawn from index.html (html).')
          assert.isTrue(existsSync(join(first.folder, CANVASES_FOLDER, '.gitignore')))

          // The coordinator, in its own folder, gets it, changes it and publishes v2 on v1.
          const got = yield* ask(setup, coordinator, 'canvas_get', { name: 'sign-in' })
          assert.include(got, `Put v1 in ${CANVASES_FOLDER}/sign-in/.`)
          const [own] = yield* setup.sql<{ folder: string }>`SELECT folder FROM canvas_copies WHERE thread_id = ${coordinator.threadId}`
          writeFileSync(join(own?.folder ?? '', CANVASES_FOLDER, 'sign-in', 'site.css'), 'h1 { color: green }')
          assert.include(yield* ask(setup, coordinator, 'canvas_publish', { name: 'sign-in', note: 'Green' }), 'Published sign-in v2 on v1')

          // The first lead's copy is still v1: its publish is refused, and v2 is set aside beside it.
          writeFileSync(join(first.folder, CANVASES_FOLDER, 'sign-in', 'index.html'), '<h1>Sign in, please</h1>')
          const stale = yield* ask(setup, first.access, 'canvas_publish', { name: 'sign-in' })
          assert.include(stale, 'Not published: your copy was made on v1, and the coordinator has published v2 since (“Green”).')
          assert.include(stale, `v2 is now beside it in ${CANVASES_FOLDER}/sign-in@2/`)
          assert.strictEqual(readFileSync(join(first.folder, CANVASES_FOLDER, 'sign-in', 'index.html'), 'utf8'), '<h1>Sign in, please</h1>')
          writeFileSync(join(first.folder, CANVASES_FOLDER, 'sign-in@2', 'index.html'), '<h1>Sign in, please</h1>')
          assert.include(
            yield* ask(setup, first.access, 'canvas_publish', { name: 'sign-in', from: 'sign-in@2' }),
            'Published sign-in v3 on v2',
          )

          // Another lead lists and reads it, with who drew each version.
          const listed = yield* ask(setup, second.access, 'canvas_list')
          assert.include(listed, '- sign-in: Sign in (html), v3 by the lead of Redesign sign-in')
          const read = yield* ask(setup, second.access, 'canvas_read', { name: 'sign-in' })
          assert.include(read, '- v1 by the lead of Redesign sign-in')
          assert.include(read, '- v2 on v1 by the coordinator')
          assert.include(read, '— Green')

          // The window reads the same: the project's list, the canvas whole, and nothing of another project's.
          const [summary] = yield* setup.client.ListCanvases({ projectId: opened.id })
          assert.strictEqual(summary?.name, 'sign-in')
          assert.strictEqual(summary?.latest.number, 3)
          assert.deepStrictEqual(summary?.latest.by, { role: 'lead', taskId: first.task.id, taskTitle: 'Redesign sign-in' })
          const detail = yield* setup.client.GetCanvas({ canvasId: summary?.id ?? '' })
          assert.deepStrictEqual(
            detail.versions.map((one) => [one.number, one.base, one.by.role]),
            [
              [1, null, 'lead'],
              [2, 1, 'coordinator'],
              [3, 2, 'lead'],
            ],
          )

          // Each publish is a line in the thread it came from, which opens it.
          const firstItems = canvasItems((yield* setup.client.GetThread({ threadId: first.access.threadId })).items)
          assert.deepStrictEqual(
            firstItems.map((one) => [one.name, one.version, one.action, one.open]),
            [
              ['sign-in', 1, 'published', true],
              ['sign-in', 3, 'published', true],
            ],
          )
        }),
      ),
  )

  it.live('never overwrite a copy’s edits: an untouched copy is reused or replaced, an edited one left and the version put beside it', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const setup = yield* connected
        const { first, second } = yield* project(setup)
        draw(first.folder, 'notes', { 'README.md': '# Notes' })
        yield* ask(setup, first.access, 'canvas_publish', { name: 'notes' })
        const at = (path: string) => join(second.folder, CANVASES_FOLDER, path, 'README.md')

        assert.include(yield* ask(setup, second.access, 'canvas_get', { name: 'notes' }), 'Put v1 in')
        assert.include(yield* ask(setup, second.access, 'canvas_get', { name: 'notes' }), 'already holds v1, as it was put there')

        // A new version replaces a copy with no edits in it.
        writeFileSync(join(first.folder, CANVASES_FOLDER, 'notes', 'README.md'), '# Notes, two')
        yield* ask(setup, first.access, 'canvas_publish', { name: 'notes' })
        assert.include(yield* ask(setup, second.access, 'canvas_get', { name: 'notes' }), 'in place of v1, which had no edits')
        assert.strictEqual(readFileSync(at('notes'), 'utf8'), '# Notes, two')

        // Edited, the copy stays; asked again for an older version, it goes beside it, and again beside that once edited.
        writeFileSync(at('notes'), '# Mine')
        const aside = yield* ask(setup, second.access, 'canvas_get', { name: 'notes', version: 1 })
        assert.include(aside, 'has edits (made on v2), so it was left as it is, and v1 is now beside it')
        assert.strictEqual(readFileSync(at('notes'), 'utf8'), '# Mine')
        assert.strictEqual(readFileSync(at('notes@1'), 'utf8'), '# Notes')
        assert.include(yield* ask(setup, second.access, 'canvas_get', { name: 'notes', version: 1 }), 'v1 is already beside it')
        writeFileSync(at('notes@1'), '# Mine too')
        assert.include(yield* ask(setup, second.access, 'canvas_get', { name: 'notes', version: 1 }), `${CANVASES_FOLDER}/notes@1-2/`)
        assert.strictEqual(readFileSync(at('notes@1'), 'utf8'), '# Mine too')

        // A folder Althar didn't put there is left alone too.
        draw(second.folder, 'plan', { 'a.md': '# Mine' })
        draw(first.folder, 'plan', { 'a.md': '# Plan' })
        yield* ask(setup, first.access, 'canvas_publish', { name: 'plan' })
        assert.include(yield* ask(setup, second.access, 'canvas_get', { name: 'plan' }), 'with no record of which version it came from')
      }),
    ),
  )

  it.live('refuse what can’t be published, in words for the agent', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const setup = yield* connected
        const { first, second } = yield* project(setup)
        const publish = (access: ToolAccess, args: Record<string, unknown>) => ask(setup, access, 'canvas_publish', args)
        assert.include(yield* publish(first.access, {}), 'Give the canvas’s name')
        assert.include(yield* publish(first.access, { name: 'Sign In' }), 'isn’t a canvas’s name')
        assert.include(yield* publish(first.access, { name: 'nothing' }), 'There is nothing there yet.')
        draw(first.folder, 'two', { 'a.md': '#', 'b.md': '#' })
        assert.include(yield* publish(first.access, { name: 'two' }), 'Say which file is drawn first')
        assert.include(yield* publish(first.access, { name: 'two', entry: 'c.md' }), 'c.md isn’t in')
        draw(first.folder, 'code', { 'app.js': '1' })
        assert.include(yield* publish(first.access, { name: 'code' }), 'app.js can’t be drawn')
        assert.include(yield* publish(first.access, { name: 'two', entry: 'a.md', group: 'Bad Group' }), 'isn’t a group’s name')
        assert.include(yield* publish(first.access, { name: 'two', from: 'other' }), 'from names a copy of two')
        assert.include(yield* publish(first.access, { name: 'two', entry: 'a.md', open: 'yes' }), 'open should be true or false')
        assert.include(yield* publish(first.access, { name: 'two', entry: 'a.md' }), 'Published two v1')
        assert.include(yield* publish(first.access, { name: 'two' }), 'Nothing changed since v1, so nothing was published.')
        // Another lead's own folder holds a copy of nothing: it gets the canvas first.
        draw(second.folder, 'two', { 'a.md': '# Mine' })
        assert.include(yield* publish(second.access, { name: 'two', entry: 'a.md' }), 'is a canvas already, at v1. canvas_get it first')
        assert.include(yield* ask(setup, second.access, 'canvas_get', { name: 'three' }), 'No canvas is called three in this project.')
        assert.include(yield* ask(setup, second.access, 'canvas_get', { name: 'two', version: 4 }), 'two has no v4: its latest is v1.')
        assert.include(yield* ask(setup, second.access, 'canvas_get', { name: 'two', version: 0 }), 'version should be a version’s number')
      }),
    ),
  )

  it.live('are given to every lead and the coordinator whole, and to reviewers only to read', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const setup = yield* connected
        const { first, coordinator } = yield* project(setup)
        const canvasTools = (names: ReadonlyArray<string>) => names.filter((name) => name.startsWith('canvas_'))
        const all = ['canvas_archive', 'canvas_get', 'canvas_list', 'canvas_open', 'canvas_publish', 'canvas_read', 'canvas_resolve']
        assert.deepStrictEqual(canvasTools(yield* listTools(first.access).pipe(Effect.provideContext(setup.context))), all)
        assert.deepStrictEqual(canvasTools(yield* listTools(coordinator).pipe(Effect.provideContext(setup.context))), all)
        assert.deepStrictEqual(
          canvasTools(yield* listTools({ ...first.access, role: 'reviewer' }).pipe(Effect.provideContext(setup.context))),
          ['canvas_get', 'canvas_list', 'canvas_read'],
        )
      }),
    ),
  )

  it.live('keep the person’s comments with the message that sends them, for every agent to read and resolve', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const setup = yield* connected
        const { first, second, coordinatorThread } = yield* project(setup)
        draw(first.folder, 'flow', { 'flow.mmd': 'graph TD; A-->B' })
        yield* ask(setup, first.access, 'canvas_publish', { name: 'flow', title: 'Checkout flow' })
        const [canvas] = yield* setup.sql<{ id: string }>`SELECT id FROM canvases WHERE name = 'flow'`
        const canvasId = canvas?.id ?? ''
        assert.include(yield* ask(setup, second.access, 'canvas_read', { name: 'flow' }), 'No open comments.')

        // A comment on a canvas of no version refuses the message whole, and nothing of it is kept.
        const refused = yield* Effect.flip(
          setup.client.Send({
            commandId: commandId(),
            threadId: coordinatorThread,
            body: 'Look',
            disposition: 'after_current',
            canvasComments: [{ canvasId, version: 9, anchor: { kind: 'whole' }, body: 'No' }],
          }),
        )
        assert.strictEqual(refused.reason, 'NotFound')
        const [none] = yield* setup.sql<{ n: number }>`SELECT count(*) AS n FROM canvas_comments`
        assert.strictEqual(none?.n, 0)

        yield* setup.client.Send({
          commandId: commandId(),
          threadId: coordinatorThread,
          body: 'Two things on the flow',
          disposition: 'after_current',
          canvasComments: [
            { canvasId, version: 1, anchor: { kind: 'passage', text: 'A-->B', heading: null }, body: 'B comes after a check' },
            { canvasId, version: 1, anchor: { kind: 'area', x: 0.1, y: 0.2, width: 0.3, height: 0.4 }, body: 'Too tight here' },
          ],
        })
        const read = yield* ask(setup, second.access, 'canvas_read', { name: 'flow' })
        assert.include(read, 'on “A-->B”: B comes after a check')
        assert.include(read, 'on an area 10% across and 20% down, 30% by 40% of it: Too tight here')
        const ids = [...read.matchAll(/\[(ccm_[0-9a-f]{32})\]/g)].map((found) => found[1] ?? '')
        assert.lengthOf(ids, 2)
        assert.strictEqual((yield* setup.client.ListCanvases({ projectId: first.access.projectId }))[0]?.openComments, 2)

        assert.include(
          yield* ask(setup, second.access, 'canvas_resolve', { name: 'flow', comments: [ids[0]], note: 'Check added' }),
          'Marked 1 comment on flow as answered by v1.',
        )
        assert.include(
          yield* ask(setup, second.access, 'canvas_resolve', { name: 'flow', comments: ['ccm_' + '0'.repeat(32)] }),
          'isn’t a comment on flow',
        )
        const detail = yield* setup.client.GetCanvas({ canvasId })
        assert.deepStrictEqual(
          detail.comments.map((one) => [one.body, one.resolved?.note ?? null]),
          [
            ['B comes after a check', 'Check added'],
            ['Too tight here', null],
          ],
        )
        assert.include(yield* ask(setup, second.access, 'canvas_read', { name: 'flow' }), 'Answered:')

        // The window reads a diagram's words to draw it.
        const text = yield* setup.client.ReadCanvasText({ canvasId, version: 1 })
        assert.deepStrictEqual(text, { path: 'flow.mmd', text: 'graph TD; A-->B', bytes: 15 })
        assert.strictEqual((yield* Effect.flip(setup.client.ReadCanvasText({ canvasId, version: 2 }))).reason, 'NotFound')
      }),
    ),
  )

  it.live('open beside the conversation, and leave the list archived, until they are published again', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const setup = yield* connected
        const { first, second, project: opened } = yield* project(setup)
        draw(first.folder, 'chart', { 'chart.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>' })
        yield* ask(setup, first.access, 'canvas_publish', { name: 'chart', open: false })
        assert.include(yield* ask(setup, second.access, 'canvas_open', { name: 'chart' }), 'chart v1 opens beside your conversation')
        const opens = canvasItems((yield* setup.client.GetThread({ threadId: second.access.threadId })).items)
        assert.deepStrictEqual(
          opens.map((one) => [one.action, one.open, one.canvasKind]),
          [['opened', true, 'svg']],
        )

        assert.include(yield* ask(setup, second.access, 'canvas_archive', { name: 'chart' }), 'Archived chart')
        assert.include(yield* ask(setup, second.access, 'canvas_archive', { name: 'chart' }), 'archived already')
        assert.lengthOf(yield* setup.client.ListCanvases({ projectId: opened.id }), 0)
        assert.lengthOf(yield* setup.client.ListCanvases({ projectId: opened.id, archived: true }), 1)
        assert.include(yield* ask(setup, second.access, 'canvas_list', { archived: true }), 'archived')

        rmSync(join(first.folder, CANVASES_FOLDER, 'chart', 'chart.svg'))
        draw(first.folder, 'chart', { 'chart.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="2"/>' })
        assert.include(yield* ask(setup, first.access, 'canvas_publish', { name: 'chart' }), 'Published chart v2 on v1')
        assert.lengthOf(yield* setup.client.ListCanvases({ projectId: opened.id }), 1)
      }),
    ),
  )
})
