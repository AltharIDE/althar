import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { Ledger } from '@althar/persistence-sqlite'
import { Api, CANVASES_FOLDER, clientProtocol, emitterPort, type ThreadItem, type ThreadSnapshot } from '@althar/contracts'
import { assert, describe, it } from '@effect/vitest'
import { Context, Deferred, Effect, Layer } from 'effect'
import { RpcClient } from 'effect/rpc'
import { SqlClient } from 'effect/sql'
import { until } from '@althar/testing/effect'

import { connection, services } from '../src/Api'
import { asideFor, canvasesIn, holdsOnly, isCopyPath, manifestOf, readCopy } from '../src/canvasFiles'
import { entryAmong, titleFromName } from '../src/Canvases'
import { Connections } from '../src/Connections'
import { Folders } from '../src/Folders'
import { git, gitExactly, gitOutcome, gitWithInput } from '../src/git'
import { Instance } from '../src/Instance'
import { Secrets } from '../src/Secrets'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeAgents, fakeConnectors, HOST, hosted, listTools, repository } from './support'

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

const connectedWith = (github?: FakeService) =>
  Effect.gen(function* () {
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
        connectors: fakeConnectors(github === undefined ? {} : { github }),
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

const connected = connectedWith()
type Setup = Effect.Success<typeof connected>

const idle = (thread: ThreadSnapshot) => thread.session !== null && !thread.session.turnRunning

/** What an agent with this access asks of Althar's tools, over MCP, as the runtime's own services serve it. */
const ask = (setup: Setup, access: ToolAccess, name: string, args?: Record<string, unknown>) =>
  callTool(access, name, args).pipe(Effect.provideContext(setup.context))

/** A project with two tasks whose leads have worktrees on this computer, each lead's access, and the coordinator's. */
const project = (setup: Setup, checkout = repository()) =>
  Effect.gen(function* () {
    const { client, grant, sql } = setup
    const opened = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(checkout) })
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
          // Who published it, and the conversation it was published from, where it is talked about.
          assert.deepStrictEqual(summary?.latest.by, {
            role: 'lead',
            taskId: first.task.id,
            taskTitle: 'Redesign sign-in',
            threadId: first.access.threadId,
          })
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

  it.live('draw a canvas of boards from its canvas.json, and refuse one whose boards aren’t all there', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const setup = yield* connected
        const { first } = yield* project(setup)
        const publish = (args: Record<string, unknown>) => ask(setup, first.access, 'canvas_publish', args)
        const boards = (pages: unknown) => JSON.stringify({ pages })
        const page = '<!doctype html><title>Checkout</title>'
        draw(first.folder, 'checkout', {
          'canvas.json': boards([{ name: 'Checkout', boards: [{ name: 'Desktop', file: 'desktop.html', width: 1440, height: 900 }] }]),
          'desktop.html': page,
          'phone.html': page,
        })
        // canvas.json is drawn first where the agent names no entry, before an index.
        assert.include(yield* publish({ name: 'checkout' }), 'drawn from canvas.json (boards)')

        writeFileSync(
          join(first.folder, CANVASES_FOLDER, 'checkout', 'canvas.json'),
          boards([{ name: 'Checkout', boards: [{ name: 'Phone', file: 'gone.html', width: 390, height: 844 }] }]),
        )
        assert.include(yield* publish({ name: 'checkout' }), 'Phone on Checkout is drawn from gone.html, which isn’t in the canvas.')
        writeFileSync(
          join(first.folder, CANVASES_FOLDER, 'checkout', 'canvas.json'),
          boards([{ name: 'Checkout', boards: [{ name: 'Phone', file: 'phone.html', width: 39, height: 844 }] }]),
        )
        assert.include(yield* publish({ name: 'checkout' }), 'needs a width and a height in whole pixels')
        writeFileSync(join(first.folder, CANVASES_FOLDER, 'checkout', 'canvas.json'), '{ not json')
        assert.include(yield* publish({ name: 'checkout' }), 'canvas.json isn’t JSON. Nothing was published.')

        // One page may be written as its boards alone.
        writeFileSync(
          join(first.folder, CANVASES_FOLDER, 'checkout', 'canvas.json'),
          JSON.stringify({ boards: [{ name: 'Phone', file: './phone.html', width: 390, height: 844 }] }),
        )
        assert.include(yield* publish({ name: 'checkout', note: 'A phone' }), 'Published checkout v2 on v1')
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

const atOrigin = Effect.gen(function* () {
  const checkout = repository()
  const bare = mkdtempSync(join(tmpdir(), 'althar-artifact-origin-'))
  mkdirSync(join(checkout, 'designs', 'existing'), { recursive: true })
  writeFileSync(join(checkout, 'designs', 'existing', 'intro.md'), '# Existing\n')
  writeFileSync(join(checkout, '.gitattributes'), '*.md text eol=lf\n')
  yield* git(checkout, 'add', '.')
  yield* git(checkout, '-c', 'user.name=Test', '-c', 'user.email=test@althar.test', 'commit', '-m', 'Designs')
  yield* git(checkout, 'clone', '--bare', '.', bare)
  yield* git(checkout, 'remote', 'add', 'origin', bare)
  yield* git(checkout, 'fetch', 'origin')
  return { checkout, bare }
})

const publishedAt = (setup: Setup, checkout: string) =>
  Effect.gen(function* () {
    const { first, project: opened } = yield* project(setup, checkout)
    const projectId = opened.id
    const [binding] = yield* setup.sql<{ id: string }>`SELECT id FROM repository_bindings WHERE project_id = ${projectId}`
    const repositoryId = binding?.id ?? assert.fail('No repository')
    draw(first.folder, 'sign-in', { 'index.md': '# Sign in\r\n', 'css/site.css': 'h1{}' })
    const publish = ask(setup, first.access, 'canvas_publish', { name: 'sign-in' })
    assert.include(yield* publish, 'Published sign-in v1')
    const [canvas] = yield* setup.client.ListCanvases({ projectId })
    const canvasId = canvas?.id ?? assert.fail('No canvas')
    const detail = () => setup.client.GetCanvas({ canvasId })
    const save = (path: string, how: 'pr' | 'main' = 'main', follow = true, makeHome?: boolean) =>
      setup.client.SaveCanvas({ commandId: commandId(), canvasId, repositoryId, path, how, follow, makeHome })
    const settled = () => until(detail(), ({ summary }) => summary.saved?.state === 'saved' || summary.saved?.state === 'failed')
    return { canvasId, repositoryId, projectId, folder: first.folder, detail, publish, save, settled }
  })

/** A canvas's own branch for its pull requests: its name and its id, so no other artifact's shares it. */
const branchOf = (canvasId: string) => `althar/artifacts/sign-in-${canvasId.replace(/^cnv_/, '').slice(0, 12)}`

describe('saving a canvas to its repository', () => {
  it.live('guesses from the remote tree, sets the first home, mirrors files, follows, moves, and stops', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { checkout, bare } = yield* atOrigin
        const setup = yield* connected
        const { projectId, repositoryId, canvasId, folder, save, settled, publish, detail } = yield* publishedAt(setup, checkout)
        const { client } = setup
        const place = client.GetArtifactsPlace({ projectId })
        const folders = client.ListRepositoryFolders({ projectId, repositoryId })
        assert.deepStrictEqual(yield* folders, { folders: ['designs/', 'designs/existing/'], truncated: false })
        const guessed = yield* place
        assert.isNull(guessed.home)
        assert.include(guessed.guess, { repositoryId, folder: 'designs/', how: 'pr', follow: true })
        assert.include(guessed.guess?.why, 'keeps its designs')

        yield* save('designs/sign-in/')
        const first = (yield* settled()).summary.saved
        assert.include(first, { state: 'saved', version: 1, pullRequest: null, how: 'main', problem: null })
        assert.strictEqual(first?.commit, yield* git(bare, 'rev-parse', 'main'))
        assert.strictEqual(yield* gitExactly(bare, 'show', 'main:designs/sign-in/index.md'), '# Sign in\r\n')
        assert.strictEqual(yield* git(bare, 'show', '-s', '--format=%s', 'main'), 'Save Sign in v1 from Althar')
        const firstHome = yield* place
        assert.include(firstHome.home, { repositoryId, folder: 'designs/', how: 'main', follow: true })
        assert.isNull(firstHome.guess)

        rmSync(join(folder, CANVASES_FOLDER, 'sign-in', 'css'), { recursive: true })
        draw(folder, 'sign-in', { 'index.md': '# Better sign in\n' })
        assert.include(yield* publish, 'Published sign-in v2')
        yield* until(detail(), ({ summary }) => summary.saved?.version === 2 && summary.saved.state === 'saved')
        assert.strictEqual(yield* git(bare, 'show', 'main:designs/sign-in/index.md'), '# Better sign in')
        assert.strictEqual(yield* git(bare, 'ls-tree', '-r', '--name-only', 'main', '--', 'designs/sign-in'), 'designs/sign-in/index.md')
        assert.strictEqual(yield* git(bare, 'show', '-s', '--format=%s', 'main'), 'Update Sign in to v2')

        yield* save('docs/design/sign-in/', 'main', true, true)
        assert.include((yield* settled()).summary.saved, { state: 'saved', version: 2, path: 'docs/design/sign-in/' })
        assert.strictEqual(yield* git(bare, 'show', '-s', '--format=%s', 'main'), 'Move Sign in to docs/design/sign-in/')
        assert.strictEqual(yield* git(bare, 'ls-tree', '--name-only', 'main', '--', 'designs/sign-in'), '')
        assert.strictEqual(yield* git(bare, 'show', 'main:docs/design/sign-in/index.md'), '# Better sign in')
        assert.include((yield* folders).folders, 'docs/design/sign-in/')
        assert.include((yield* place).home, { folder: 'docs/design/' })

        const home = { repositoryId, folder: '', how: 'pr' as const, follow: false }
        yield* client.SetArtifactsHome({ commandId: commandId(), projectId, home })
        assert.include((yield* place).home, home)
        yield* client.SetArtifactsHome({ commandId: commandId(), projectId, home: null })
        assert.isNull((yield* place).home)

        const before = yield* git(bare, 'rev-parse', 'main')
        yield* client.StopSavingCanvas({ commandId: commandId(), canvasId })
        draw(folder, 'sign-in', { 'index.md': '# A third version\n' })
        assert.include(yield* publish, 'Published sign-in v3')
        assert.isNull((yield* detail()).summary.saved)
        assert.isNull((yield* client.ListCanvases({ projectId }))[0]?.saved)
        assert.strictEqual(yield* git(bare, 'rev-parse', 'main'), before)
        assert.lengthOf(
          (yield* git(checkout, 'worktree', 'list')).split('\n').filter((line) => line.includes('.canvas-save-')),
          0,
        )
      }),
    ),
  )

  it.live('never takes over a folder that holds files, keeps what others added, and refuses over what others changed', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { checkout, bare } = yield* atOrigin
        const setup = yield* connected
        const { save, settled, publish, detail, folder } = yield* publishedAt(setup, checkout)
        const before = yield* git(bare, 'rev-parse', 'main')

        // A first save into a folder that already holds files refuses, and nothing is pushed.
        yield* save('designs/existing/')
        const occupied = (yield* settled()).summary.saved
        assert.strictEqual(occupied?.state, 'failed')
        assert.include(occupied?.problem ?? '', 'already holds files')
        assert.strictEqual(yield* git(bare, 'rev-parse', 'main'), before)

        // Saved in a folder of its own; then someone adds a file beside it, in git.
        yield* save('designs/sign-in/')
        assert.strictEqual((yield* settled()).summary.saved?.state, 'saved')
        const other = mkdtempSync(join(tmpdir(), 'althar-artifact-other-'))
        yield* git(other, 'clone', '-q', bare, '.')
        writeFileSync(join(other, 'designs', 'sign-in', 'notes.md'), '# Ana’s notes\n')
        yield* git(other, 'add', 'designs/sign-in/notes.md')
        yield* git(other, '-c', 'user.name=Ana', '-c', 'user.email=ana@althar.test', 'commit', '-q', '-m', 'Notes')
        yield* git(other, 'push', '-q', 'origin', 'HEAD:main')
        const anas = yield* git(bare, 'rev-parse', 'main')

        // A version with a file of its own where Ana's is refuses, and leaves hers and the branch as they were.
        draw(folder, 'sign-in', { 'index.md': '# Sign in, v2\n', 'notes.md': '# The artifact’s notes\n' })
        assert.include(yield* publish, 'Published sign-in v2')
        const claimed = yield* until(detail(), ({ summary }) => summary.saved?.state === 'failed')
        assert.strictEqual(claimed.summary.saved?.version, 1)
        assert.include(claimed.summary.saved?.problem ?? '', 'would write over designs/sign-in/notes.md')
        assert.strictEqual(yield* git(bare, 'rev-parse', 'main'), anas)
        assert.strictEqual(yield* git(bare, 'show', 'main:designs/sign-in/notes.md'), '# Ana’s notes')

        // A new version replaces the artifact's own files and keeps Ana's.
        rmSync(join(folder, CANVASES_FOLDER, 'sign-in', 'notes.md'))
        draw(folder, 'sign-in', { 'index.md': '# Sign in, v3\n' })
        assert.include(yield* publish, 'Published sign-in v3')
        yield* save('designs/sign-in/')
        assert.include((yield* settled()).summary.saved, { state: 'saved', version: 3 })
        assert.strictEqual(yield* git(bare, 'show', 'main:designs/sign-in/notes.md'), '# Ana’s notes')
        assert.strictEqual(yield* git(bare, 'show', 'main:designs/sign-in/index.md'), '# Sign in, v3')

        // A move to a folder that holds files refuses; to an empty one, it takes only its own files and leaves Ana's.
        yield* save('designs/existing/')
        assert.include((yield* settled()).summary.saved?.problem ?? '', 'already holds files')
        yield* save('docs/sign-in/')
        assert.include((yield* settled()).summary.saved, { state: 'saved', path: 'docs/sign-in/' })
        assert.strictEqual(yield* git(bare, 'ls-tree', '-r', '--name-only', 'main', '--', 'designs/sign-in'), 'designs/sign-in/notes.md')
        assert.strictEqual(yield* git(bare, 'show', 'main:docs/sign-in/index.md'), '# Sign in, v3')

        // Where someone changed one of its own files, it refuses rather than overwrite their work.
        yield* git(other, 'fetch', '-q', 'origin')
        yield* git(other, 'reset', '-q', '--hard', 'origin/main')
        writeFileSync(join(other, 'docs', 'sign-in', 'index.md'), '# Sign in, as Ana left it\n')
        yield* git(other, 'add', 'docs/sign-in/index.md')
        yield* git(other, '-c', 'user.name=Ana', '-c', 'user.email=ana@althar.test', 'commit', '-q', '-m', 'Ana’s edit')
        yield* git(other, 'push', '-q', 'origin', 'HEAD:main')
        draw(folder, 'sign-in', { 'index.md': '# Sign in, v4\n' })
        assert.include(yield* publish, 'Published sign-in v4')
        // It stays saved at v3, and says why v4 isn't.
        const refused = yield* until(detail(), ({ summary }) => summary.saved?.state === 'failed')
        assert.strictEqual(refused.summary.saved?.version, 3)
        assert.include(refused.summary.saved?.problem ?? '', 'Someone changed docs/sign-in/index.md')
        assert.strictEqual(yield* git(bare, 'show', 'main:docs/sign-in/index.md'), '# Sign in, as Ana left it')
      }),
    ),
  )

  it.live('counts a submodule someone added as theirs, and a file of its own made executable as changed', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { checkout, bare } = yield* atOrigin
        const setup = yield* connected
        const { save, settled, publish, detail, folder } = yield* publishedAt(setup, checkout)
        yield* save('designs/sign-in/')
        assert.strictEqual((yield* settled()).summary.saved?.state, 'saved')
        const other = mkdtempSync(join(tmpdir(), 'althar-artifact-other-'))
        yield* git(other, 'clone', '-q', bare, '.')
        const push = (message: string) =>
          Effect.gen(function* () {
            yield* git(other, '-c', 'user.name=Ana', '-c', 'user.email=ana@althar.test', 'commit', '-q', '-m', message)
            yield* git(other, 'push', '-q', 'origin', 'HEAD:main')
            return yield* git(bare, 'rev-parse', 'main')
          })

        // Ana adds a submodule beside it; a version with a file where it is refuses, and leaves it and main as they were.
        const pinned = yield* git(other, 'rev-parse', 'HEAD')
        yield* git(other, 'update-index', '--add', '--cacheinfo', `160000,${pinned},designs/sign-in/examples`)
        const withSubmodule = yield* push('Examples')
        draw(folder, 'sign-in', { 'index.md': '# Sign in\r\n', examples: 'a file of the artifact’s\n' })
        assert.include(yield* publish, 'Published sign-in v2')
        const over = yield* until(detail(), ({ summary }) => summary.saved?.state === 'failed')
        assert.include(over.summary.saved?.problem ?? '', 'would write over designs/sign-in/examples')
        assert.strictEqual(yield* git(bare, 'rev-parse', 'main'), withSubmodule)
        assert.strictEqual(
          yield* git(bare, 'ls-tree', 'main', '--', 'designs/sign-in/examples'),
          `160000 commit ${pinned}\tdesigns/sign-in/examples`,
        )

        // Ana makes one of its files executable, its bytes as they were; the next version refuses rather than undo it.
        rmSync(join(folder, CANVASES_FOLDER, 'sign-in', 'examples'))
        yield* git(other, 'update-index', '--chmod=+x', 'designs/sign-in/css/site.css')
        const executable = yield* push('Run it')
        draw(folder, 'sign-in', { 'index.md': '# Sign in, v3\n' })
        assert.include(yield* publish, 'Published sign-in v3')
        const changed = yield* until(detail(), ({ summary }) => (summary.saved?.problem ?? '').includes('Someone changed'))
        assert.include(changed.summary.saved, { state: 'failed', version: 1 })
        assert.include(changed.summary.saved?.problem ?? '', 'designs/sign-in/css/site.css')
        assert.strictEqual(yield* git(bare, 'rev-parse', 'main'), executable)
        assert.match(yield* git(bare, 'ls-tree', 'main', '--', 'designs/sign-in/css/site.css'), /^100755 blob /)
      }),
    ),
  )

  it.live('answers while git work is waiting and follows each version in one pull request', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { working, bare } = hosted()
        const wait = yield* Deferred.make<void>()
        const github = makeFakeService({
          pushUrl: () => bare,
          waitsFor: (method) => (method === 'findChange' ? Deferred.await(wait) : Effect.void),
        })
        github.addRepository(['meridian', 'api'])
        const setup = yield* connectedWith(github)
        const instance = Context.get(setup.context, Instance)
        const connections = Context.get(setup.context, Connections)
        yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
        const { canvasId, projectId, folder, save, detail, publish } = yield* publishedAt(setup, working)
        const branch = branchOf(canvasId)
        const ledger = Context.get(setup.context, Ledger)
        const changes = () =>
          ledger
            .changesSince(0, 1000)
            .pipe(Effect.map((feed) => feed.filter((change) => change.aggregateType === 'canvas' && change.aggregateId === canvasId)))
        const before = (yield* changes()).length
        yield* save('design/sign-in/', 'pr')
        assert.include((yield* detail()).summary.saved, { state: 'saving', version: null, commit: null, pullRequest: null })
        assert.include((yield* setup.client.ListCanvases({ projectId }))[0]?.saved, { state: 'saving' })
        assert.lengthOf(yield* changes(), before + 1)
        draw(folder, 'sign-in', { 'index.md': '# Version two\n' })
        assert.include(yield* publish, 'Published sign-in v2')
        draw(folder, 'sign-in', { 'index.md': '# Version three\n' })
        assert.include(yield* publish, 'Published sign-in v3')
        yield* Deferred.succeed(wait, undefined)
        const { summary } = yield* until(detail(), ({ summary }) => summary.saved?.version === 3 && summary.saved.state === 'saved')
        assert.strictEqual(summary.saved?.commit, yield* git(bare, 'rev-parse', branch))
        assert.strictEqual(yield* git(bare, 'show', `${branch}:design/sign-in/index.md`), '# Version three')
        assert.strictEqual(
          yield* git(bare, 'log', '--format=%s', `main..${branch}`),
          'Update Sign in to v3\nUpdate Sign in to v2\nSave Sign in v1 from Althar',
        )
        assert.lengthOf(github.changes, 1)
        const [pull] = github.changes
        assert.include(pull, { title: 'Add Sign in', source: branch, target: 'main' })
        assert.include(pull?.body, 'v1')
        assert.deepStrictEqual(summary.saved?.pullRequest, { number: pull?.number, url: pull?.url })
        assert.isAbove((yield* changes()).length, before + 1)
      }),
    ),
  )

  it.live('lists only the first 5000 folders and still finds a design folder past that limit', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { checkout, bare } = yield* atOrigin
        const folder = yield* git(checkout, 'rev-parse', 'main:designs/existing')
        const names = Array.from({ length: 5000 }, (_, i) => `a-${String(i).padStart(4, '0')}`)
        const input = [...names, 'design'].map((name) => `040000 tree ${folder}\t${name}\n`).join('')
        const tree = (yield* gitWithInput(checkout, input, 'mktree')).trim()
        const parent = yield* git(checkout, 'rev-parse', 'main')
        const commit = yield* git(
          checkout,
          '-c',
          'user.name=Test',
          '-c',
          'user.email=test@althar.test',
          'commit-tree',
          tree,
          '-p',
          parent,
          '-m',
          'Many folders',
        )
        yield* git(checkout, 'push', bare, `${commit}:refs/heads/main`)
        yield* git(checkout, 'fetch', 'origin')
        const { client, grant } = yield* connected
        const { id: projectId } = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(checkout) })
        const { guess } = yield* client.GetArtifactsPlace({ projectId })
        assert.include(guess, { folder: 'design/' })
        assert.include(guess?.why, 'keeps its designs')
        const repositoryId = guess?.repositoryId ?? assert.fail('No repository')
        assert.deepStrictEqual(yield* client.ListRepositoryFolders({ projectId, repositoryId }), {
          folders: names.map((name) => `${name}/`),
          truncated: true,
        })
      }),
    ),
  )

  it.live('retries opening a pull request without another commit, then follows from main once it closes', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { working, bare } = hosted()
        const github = makeFakeService({ pushUrl: () => bare })
        github.addRepository(['meridian', 'api'])
        github.failNext('openChange', 'unreachable')
        const setup = yield* connectedWith(github)
        const { personId } = Context.get(setup.context, Instance)
        yield* Context.get(setup.context, Connections).connectToken({ product: 'github', token: 't', actorId: personId, webUrl: HOST })
        const { canvasId, folder, save, settled, detail, publish } = yield* publishedAt(setup, working)
        const branch = branchOf(canvasId)
        yield* save('design/sign-in/', 'pr')
        assert.include((yield* settled()).summary.saved, { state: 'failed', pullRequest: null })
        const first = yield* git(bare, 'rev-parse', branch)

        yield* save('design/sign-in/', 'pr')
        const retried = (yield* settled()).summary.saved
        assert.include(retried, { state: 'saved', commit: first, version: 1 })
        assert.strictEqual(github.changes[0]?.title, 'Add Sign in')
        github.close(retried?.pullRequest?.number ?? assert.fail('No pull request'))

        draw(folder, 'sign-in', { 'index.md': '# Next version\n' })
        assert.include(yield* publish, 'Published sign-in v2')
        const followed = yield* until(detail(), ({ summary }) => summary.saved?.state === 'saved' && summary.saved.version === 2)
        assert.strictEqual(yield* git(bare, 'rev-parse', `${branch}^`), yield* git(bare, 'rev-parse', 'main'))
        assert.lengthOf(github.changes, 2)
        assert.strictEqual(followed.summary.saved?.pullRequest?.number, github.changes[1]?.number)
      }),
    ),
  )

  it.live('saves on a branch of its own, and never continues a pull request from it that it didn’t open', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { working, bare } = hosted()
        const github = makeFakeService({ pushUrl: () => bare })
        const repository = github.addRepository(['meridian', 'api'])
        const setup = yield* connectedWith(github)
        const { personId } = Context.get(setup.context, Instance)
        yield* Context.get(setup.context, Connections).connectToken({ product: 'github', token: 't', actorId: personId, webUrl: HOST })
        const { canvasId, save, settled } = yield* publishedAt(setup, working)
        // Its branch is its own: its name and its id, so another project's sign-in never shares it.
        const branch = branchOf(canvasId)
        assert.match(branch, /^althar\/artifacts\/sign-in-[0-9a-f]{12}$/)
        // Someone's pull request from that branch, which this artifact never opened.
        yield* git(working, 'push', '-q', bare, `HEAD:refs/heads/${branch}`)
        yield* github.openChange(repository, { title: 'Not Althar’s', body: '', source: branch, target: 'main', draft: false })
        yield* save('design/sign-in/', 'pr')
        const refused = (yield* settled()).summary.saved
        assert.include(refused, { state: 'failed', pullRequest: null })
        assert.include(refused?.problem ?? '', 'didn’t open for this artifact')
        assert.lengthOf(github.changes, 1)
      }),
    ),
  )

  it.live('after a push whose pull request didn’t open, takes for its own only the one the host opened for it', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { working, bare } = hosted()
        const github = makeFakeService({ pushUrl: () => bare })
        github.addRepository(['meridian', 'api'])
        const setup = yield* connectedWith(github)
        const { personId } = Context.get(setup.context, Instance)
        yield* Context.get(setup.context, Connections).connectToken({ product: 'github', token: 't', actorId: personId, webUrl: HOST })
        const { canvasId, save, settled } = yield* publishedAt(setup, working)
        const branch = branchOf(canvasId)
        // Someone opens a pull request from its branch, between its push and its trying again: by its title, as anyone may.
        const opensOne = (author: string) =>
          github.addPullRequest({ path: ['meridian', 'api'], title: 'Add Sign in', author, source: branch, target: 'main' })
        const tryAgain = Effect.suspend(() => Effect.andThen(save('design/sign-in/', 'pr'), settled()))

        // The host said no: one opened after, even by the same account, is the person's own doing, not this artifact's.
        github.failNext('openChange', 'rejected')
        assert.include((yield* tryAgain).summary.saved, { state: 'failed', pullRequest: null })
        const byHand = opensOne('you')
        const refused = (yield* tryAgain).summary.saved
        assert.include(refused, { state: 'failed', pullRequest: null })
        assert.include(refused?.problem ?? '', 'didn’t open for this artifact')
        github.close(byHand.number)

        // Its answer lost, the host may have opened it: still, one by anyone else isn't.
        github.failNext('openChange', 'unreachable')
        assert.include((yield* tryAgain).summary.saved, { state: 'failed', pullRequest: null })
        const anas = opensOne('ana')
        assert.include((yield* tryAgain).summary.saved?.problem ?? '', 'didn’t open for this artifact')
        github.close(anas.number)

        // The one by the account it asked with, with the title it asked for, is the one the host opened: it carries on in it.
        const lost = opensOne('you')
        const adopted = (yield* tryAgain).summary.saved
        assert.include(adopted, { state: 'saved', version: 1 })
        assert.deepStrictEqual(adopted?.pullRequest, { number: lost.number, url: lost.url })
        assert.strictEqual(adopted?.commit, yield* git(bare, 'rev-parse', branch))
      }),
    ),
  )

  it.live('keeps a refused save for retry and removes its worktree on either outcome', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { checkout, bare } = yield* atOrigin
        const setup = yield* connected
        const { save, settled } = yield* publishedAt(setup, checkout)
        const before = yield* git(bare, 'rev-parse', 'main')
        yield* git(bare, 'config', 'receive.hideRefs', 'refs/heads/main')
        yield* save('designs/sign-in/')
        const failed = (yield* settled()).summary.saved
        assert.include(failed, { state: 'failed', path: 'designs/sign-in/', commit: null, version: null })
        assert.include(failed?.problem, 'refused the push')
        assert.strictEqual(yield* git(bare, 'rev-parse', 'main'), before)
        assert.notInclude(yield* git(checkout, 'worktree', 'list'), '.canvas-save-')

        yield* git(bare, 'config', '--unset', 'receive.hideRefs')
        yield* save('designs/sign-in/')
        const retried = (yield* settled()).summary.saved
        assert.include(retried, { state: 'saved', version: 1, problem: null })
        assert.strictEqual(retried?.commit, yield* git(bare, 'rev-parse', 'main'))
        assert.notInclude(yield* git(checkout, 'worktree', 'list'), '.canvas-save-')
        assert.notEqual((yield* gitOutcome(checkout, 'show', 'HEAD:designs/sign-in/index.md')).code, 0)
      }),
    ),
  )
})

describe('an artifact’s own chat', () => {
  const LEAD = { key: 'implement' as const, agentId: 'codex', model: null, skipped: false }

  it.live('is one per canvas, never on the board or among the asides, briefed as the artifact’s, and what it publishes says so', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const setup = yield* connected
        const { client, sql } = setup
        const { project: opened, first } = yield* project(setup)
        draw(first.folder, 'sign-in', { 'README.md': '# Sign-in\n\nThe form.\n' })
        yield* ask(setup, first.access, 'canvas_publish', { name: 'sign-in' })
        const [drawn] = yield* client.ListCanvases({ projectId: opened.id })
        assert.isDefined(drawn)
        if (drawn === undefined) return
        assert.isNull(drawn.chat ?? null)
        assert.strictEqual(drawn.latest.by.role, 'lead')

        // Opened and talked to, it has a chat of its own; asked again, it is the same one.
        const start = () =>
          client.StartTask({
            commandId: commandId(),
            projectId: opened.id,
            title: 'Sign-in',
            steps: [LEAD],
            chat: true,
            artifact: { canvasId: drawn.id },
          })
        const chat = yield* start()
        assert.strictEqual((yield* start()).id, chat.id)
        const [listed] = yield* client.ListCanvases({ projectId: opened.id })
        assert.deepStrictEqual(listed?.chat, { taskId: chat.id, threadId: chat.threadId })
        const thread = yield* client.GetThread({ threadId: chat.threadId })
        assert.deepStrictEqual(thread.task?.artifact, { canvasId: drawn.id })

        // Never a task on the board, nor an aside's pill.
        const board = yield* client.GetBoard({ projectId: opened.id })
        assert.isFalse(board.tasks.some((task) => task.taskId === chat.id))
        assert.isTrue(board.tasks.some((task) => task.taskId === first.task.id))
        assert.deepStrictEqual(yield* client.ListArtifactsDrawing({ projectId: opened.id }), [])

        // Its lead is told it is the artifact's chat, and how to change it.
        yield* client.Send({ commandId: commandId(), threadId: chat.threadId, body: 'Make the form shorter', disposition: 'after_current' })
        const prompt = yield* until(
          sql<{ prompt: string }>`SELECT prompt FROM turn_deliveries WHERE thread_id = ${chat.threadId}`,
          (rows) => rows.length > 0,
        )
        assert.include(prompt[0]?.prompt ?? '', "You are an artifact's own chat")
        assert.include(prompt[0]?.prompt ?? '', `.althar/canvases/sign-in/`)
        assert.notInclude(prompt[0]?.prompt ?? '', 'an aside of this project')

        // What it publishes on its canvas is the chat's, and the canvas stays its own.
        const [folder] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${chat.id}`
        const access: ToolAccess = { role: 'lead', projectId: opened.id, threadId: chat.threadId, sessionId: 'session', taskId: chat.id }
        yield* ask(setup, access, 'canvas_get', { name: 'sign-in' })
        writeFileSync(join(folder?.path ?? '', CANVASES_FOLDER, 'sign-in', 'README.md'), '# Sign-in\n\nShorter.\n')
        assert.include(yield* ask(setup, access, 'canvas_publish', { name: 'sign-in' }), 'Published sign-in v2 on v1')
        const [after] = yield* client.ListCanvases({ projectId: opened.id })
        assert.strictEqual(after?.latest.by.role, 'chat')
        assert.deepStrictEqual(after?.chat, { taskId: chat.id, threadId: chat.threadId })
        const [shelf] = yield* sql<{ shelf: string | null }>`SELECT shelf FROM tasks WHERE id = ${chat.id}`
        assert.strictEqual(shelf?.shelf, 'scratch')
      }),
    ),
  )

  it.live('started by the coordinator, is drawing among the artifacts until its first canvas, which is then its own', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const setup = yield* connected
        const { client, sql } = setup
        const { project: opened, coordinator } = yield* project(setup)
        const said = yield* ask(setup, coordinator, 'start_artifact', {
          title: 'Spring mood board',
          request: 'A mood board for the spring classes. [lead:wait]',
          lead: { agent: 'codex' },
        })
        assert.include(said, 'Started the artifact Spring mood board')
        assert.include(
          yield* ask(setup, coordinator, 'start_artifact', { title: 'Spring mood board', request: 'Again', lead: { agent: 'codex' } }),
          'already',
        )
        const drawing = yield* client.ListArtifactsDrawing({ projectId: opened.id })
        assert.deepStrictEqual(
          drawing.map((one) => one.title),
          ['Spring mood board'],
        )
        const [one] = drawing
        if (one === undefined) return
        const board = yield* client.GetBoard({ projectId: opened.id })
        assert.isFalse(board.tasks.some((task) => task.taskId === one.taskId))

        // Its first canvas is its artifact: no longer drawing, and the canvas names it as its chat.
        const [folder] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${one.taskId}`
        draw(folder?.path ?? '', 'spring', { 'README.md': '# Spring\n' })
        const access: ToolAccess = { role: 'lead', projectId: opened.id, threadId: one.threadId, sessionId: 'session', taskId: one.taskId }
        yield* ask(setup, access, 'canvas_publish', { name: 'spring' })
        assert.deepStrictEqual(yield* client.ListArtifactsDrawing({ projectId: opened.id }), [])
        const spring = (yield* client.ListCanvases({ projectId: opened.id })).find((canvas) => canvas.name === 'spring')
        assert.deepStrictEqual(spring?.chat, { taskId: one.taskId, threadId: one.threadId })
        assert.strictEqual(spring?.latest.by.role, 'chat')
      }),
    ),
  )
})
