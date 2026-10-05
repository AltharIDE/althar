import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { coordinatorFolder } from '../src/coordinatorFolder'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { callTool, fakeConnectors, HOST, launches, notices, repository, runtime, turns, until } from './support'

/*
 * Projects of several repositories, and of a folder inside one
 * (docs/architecture/01): reading a folder, opening what the person kept,
 * and tasks that change more than one repository.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd })
    .toString()
    .trim()

/** A folder holding a repository for each name, a plain folder, and a hidden repository that isn't looked in. */
const folderOf = (...names: ReadonlyArray<string>) => {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'althar-folder-')))
  for (const name of [...names, '.cache']) {
    const path = join(folder, name)
    mkdirSync(path)
    git(path, 'init', '-q', '-b', 'main')
    writeFileSync(join(path, 'README.md'), `# ${name}\n`)
    git(path, 'add', '.')
    git(path, 'commit', '-q', '-m', 'Start')
  }
  mkdirSync(join(folder, 'notes'))
  return folder
}

const open = (path: string, repositories?: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    return yield* projects.open({
      envelope: yield* Runtime.envelope('project.open', {}),
      path,
      ...(repositories === undefined ? {} : { repositories }),
    })
  })

const createTask = (projectId: string, repositories?: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    return yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId,
      title: 'Share the retry',
      ...(repositories === undefined ? {} : { repositories }),
    })
  })

const withQueries = (...args: Parameters<typeof runtime>) => Queries.layer.pipe(Layer.provideMerge(runtime(...args)))

describe('opening a folder', () => {
  it.live('reads what it would make, without changing it: a repository, a folder in one, or the repositories directly inside it', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const single = realpathSync(repository())
      const read = yield* projects.read(single)
      assert.deepStrictEqual(
        [read.kind, read.name, read.repositories.map((found) => [found.path, found.folder, found.branch])],
        ['repository', basename(single), [[single, null, 'main']]],
      )
      mkdirSync(join(single, 'packages', 'api'), { recursive: true })
      const inside = yield* projects.read(join(single, 'packages', 'api'))
      assert.deepStrictEqual(
        [inside.kind, inside.name, inside.repositories.map((found) => [found.path, found.folder])],
        ['inside', 'api', [[single, join('packages', 'api')]]],
      )
      const folder = folderOf('web', 'api')
      const several = yield* projects.read(folder)
      assert.deepStrictEqual(
        [several.kind, several.repositories.map((found) => found.name), several.project],
        ['folder', ['api', 'web'], null],
      )
      const empty = yield* projects.read(mkdtempSync(join(tmpdir(), 'althar-empty-')))
      assert.deepStrictEqual([empty.kind, empty.repositories], ['folder', []])
    }).pipe(Effect.provide(runtime())),
  )

  it.live('opens a folder of repositories with the ones the person kept, and finds the project again', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const projects = yield* Projects
      const folder = folderOf('api', 'web', 'docs')
      const opened = yield* open(folder, [join(folder, 'api'), join(folder, 'web')])
      assert.strictEqual(opened.name, basename(folder))
      const bindings = yield* sql<{ slug: string; folder: string | null }>`
        SELECT slug, folder FROM repository_bindings WHERE project_id = ${opened.projectId} ORDER BY created_at, rowid`
      assert.deepStrictEqual(bindings, [
        { slug: 'api', folder: null },
        { slug: 'web', folder: null },
      ])
      // Opened again, it is the same project, and reading it says so.
      assert.strictEqual((yield* open(folder)).projectId, opened.projectId)
      assert.deepStrictEqual((yield* projects.read(folder)).project, { id: opened.projectId, name: basename(folder) })
      // One of its repositories, opened alone, is a project of its own.
      assert.notStrictEqual((yield* open(join(folder, 'api'))).projectId, opened.projectId)
      // Once archived, the project lets go of its folder: opened again, it's a new one.
      yield* sql`UPDATE projects SET archived_at = '2026-10-05T00:00:00.000Z' WHERE id = ${opened.projectId}`
      const afresh = yield* open(folder, [join(folder, 'api')])
      assert.notStrictEqual(afresh.projectId, opened.projectId)
      assert.deepStrictEqual((yield* projects.read(folder)).project, { id: afresh.projectId, name: basename(folder) })
      // Every one found, unless the person said which.
      const all = folderOf('one', 'two')
      const both = yield* open(all)
      assert.strictEqual(
        (yield* sql<{ n: number }>`SELECT count(*) AS n FROM repository_bindings WHERE project_id = ${both.projectId}`)[0]?.n,
        2,
      )
      // With a repository from elsewhere the person added.
      const mixed = yield* open(folderOf('three'), [join(dirname(all), basename(all), 'one'), repository()].slice(1))
      assert.strictEqual(
        (yield* sql<{ n: number }>`SELECT count(*) AS n FROM repository_bindings WHERE project_id = ${mixed.projectId}`)[0]?.n,
        1,
      )
      // A folder with none isn't a project.
      const error = yield* Effect.flip(open(mkdtempSync(join(tmpdir(), 'althar-empty-'))))
      assert.strictEqual(error._tag, 'NotARepository')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('opens a folder inside a repository as the project: its agents and its coordinator start there', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const root = repository()
      mkdirSync(join(root, 'packages', 'api'), { recursive: true })
      const opened = yield* open(join(root, 'packages', 'api'))
      assert.strictEqual(opened.name, 'api')
      const coordinator = yield* coordinatorFolder(opened.projectId)
      assert.isTrue(coordinator.repositories[0]?.path.endsWith(join('packages', 'api')))
      assert.strictEqual(coordinator.repositories[0]?.within, join('packages', 'api'))
      const task = yield* createTask(opened.projectId)
      yield* sessions.start({ threadId: task.threadId, agentId: 'codex' })
      assert.strictEqual(launches.at(-1)?.cwd, join(task.worktree, 'packages', 'api'))
      const [brief] = yield* until(turns(task.threadId), (rows) => rows.length > 0)
      assert.include(brief?.prompt ?? '', 'The project is its folder packages/api: start there')
    }).pipe(Effect.provide(runtime())),
  )
})

describe('a task of several repositories', () => {
  it.live('names the ones it changes, each in a worktree side by side, its lead starting in the folder that holds them', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const queries = yield* Queries
      const folder = folderOf('api', 'web')
      const opened = yield* open(folder)
      // In a project of several, a task says which it changes.
      const unnamed = yield* Effect.flip(createTask(opened.projectId))
      assert.deepStrictEqual([unnamed._tag, 'choices' in unnamed ? unnamed.choices : []], ['RepositoriesNeeded', ['api', 'web']])
      const unknown = yield* Effect.flip(createTask(opened.projectId, ['mobile']))
      assert.deepStrictEqual('unknown' in unknown ? unknown.unknown : [], ['mobile'])
      const task = yield* createTask(opened.projectId, ['web', 'API'])
      const sql = yield* SqlClient.SqlClient
      const worktrees = yield* sql<{ path: string; branch: string }>`
        SELECT w.path, w.branch FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
        WHERE w.task_id = ${task.taskId} ORDER BY b.created_at, b.rowid`
      assert.deepStrictEqual(
        worktrees.map((worktree) => basename(worktree.path)),
        ['api', 'web'],
      )
      assert.strictEqual(dirname(worktrees[0]?.path ?? ''), dirname(worktrees[1]?.path ?? ''))
      assert.deepStrictEqual(
        worktrees.map((worktree) => worktree.branch),
        [task.branch, task.branch],
      )
      yield* sessions.start({ threadId: task.threadId, agentId: 'codex' })
      assert.strictEqual(launches.at(-1)?.cwd, dirname(worktrees[0]?.path ?? ''))
      const [brief] = yield* until(turns(task.threadId), (rows) => rows.length > 0)
      assert.include(brief?.prompt ?? '', 'You are working on a task across several repositories')
      assert.include(brief?.prompt ?? '', `- web: ${worktrees[1]?.path ?? ''}, on the branch ${task.branch}`)

      // What it changed, in each, by repository.
      for (const [index, worktree] of worktrees.entries()) {
        writeFileSync(join(worktree.path, `change-${index}.txt`), 'changed\n')
        git(worktree.path, 'add', '.')
        git(worktree.path, 'commit', '-q', '-m', 'Change it')
      }
      const head = yield* queries.thread(task.threadId, { limit: 0 })
      assert.deepStrictEqual(
        head.task.files.map((file) => file.path),
        ['api/change-0.txt', 'web/change-1.txt'],
      )
      assert.strictEqual(head.task.commits, 2)
      const diff = yield* queries.fileDiff(task.taskId, 'web/change-1.txt')
      assert.strictEqual(diff.file.path, 'web/change-1.txt')
      assert.deepInclude(diff.lines, { kind: 'added', new: 1, text: 'changed' })
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('publishes each: a pull request where its host is connected, its branch where it has no host', () => {
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    const folder = folderOf('api', 'web')
    git(join(folder, 'api'), 'remote', 'add', 'origin', `${HOST}/meridian/api.git`)
    const bare = mkdtempSync(join(tmpdir(), 'althar-remote-'))
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: bare })
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
      const opened = yield* open(folder)
      const projects = yield* Projects
      const plans = yield* Plans
      const queries = yield* Queries
      const sql = yield* SqlClient.SqlClient
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: opened.projectId,
        title: 'Share the retry',
        description: '[lead:finish]',
        draft: true,
        repositories: ['api', 'web'],
      })
      for (const worktree of yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${task.taskId}`) {
        writeFileSync(join(worktree.path, 'retry.txt'), 'retry\n')
        git(worktree.path, 'add', '.')
        git(worktree.path, 'commit', '-q', '-m', 'Retry')
      }
      const planId = yield* plans.propose({
        projectId: opened.projectId as Parameters<typeof plans.propose>[0]['projectId'],
        taskId: task.taskId,
        steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
        reason: null,
        actorId: instance.personId,
      })
      yield* plans.start(planId, instance.personId)
      const [published] = yield* until(
        Effect.map(queries.thread(task.threadId, { limit: 50 }), (thread) =>
          thread.items.flatMap((item) => (item.kind === 'step_result' && item.content.step === 'publish' ? [item.content.summary] : [])),
        ),
        (found) => found.length === 1,
      )
      assert.strictEqual(
        published,
        "api: Opened draft pull request #1.\nweb: It isn't on a code host Althar knows, so it ends on its branch.",
      )
      assert.lengthOf(github.changes, 1)
      assert.include(git(bare, 'log', '--format=%s', task.branch), 'Retry')

      // web, on its branch, merges here beside api's pull request; the task is done once both are merged.
      const changes = yield* Changes
      const [card] = yield* until(
        Effect.map(queries.board(opened.projectId), (board) =>
          board.tasks.filter((one) => one.taskId === task.taskId && one.phase === 'ready'),
        ),
        (found) => found.length === 1,
      )
      assert.deepStrictEqual(
        card?.here.map((one) => one.repository),
        ['web'],
      )
      const heads = (card?.here ?? []).flatMap((one) => (one.head === null ? [] : [{ repository: one.repository, head: one.head }]))
      assert.deepStrictEqual(
        (yield* changes.mergeHere(task.taskId, heads)).map((one) => one.repository),
        ['web'],
      )
      assert.include(git(join(folder, 'web'), 'log', '--format=%s', 'main'), 'Retry')
      assert.notInclude(git(join(folder, 'api'), 'log', '--format=%s', 'main'), 'Retry')
      assert.deepStrictEqual((yield* notices(task.threadId)).map((notice) => notice.title).slice(-2), [
        'Merged here: web into main.',
        `Not done yet: PR #${github.changes[0]?.number ?? 0} in api is still open.`,
      ])
      assert.deepStrictEqual((yield* queries.thread(task.threadId, { limit: 0 })).task.here, [])
      const state = sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${task.taskId}`
      assert.strictEqual((yield* state)[0]?.state, 'open')
      // Asked again, it's merged already.
      assert.deepStrictEqual(
        (yield* changes.mergeHere(task.taskId, heads)).map((one) => one.already),
        [true],
      )
      github.mergeByHand(github.changes[0]?.number ?? 0)
      yield* changes.refresh(task.taskId)
      yield* until(state, (rows) => rows[0]?.state === 'done')
    }).pipe(Effect.provide(withQueries(':memory:', {}, { connectors: fakeConnectors({ github }) })))
  })

  it.live("ends each task by the repositories it changes, not by the project's first, and tells its lead where the others are", () => {
    const github = makeFakeService()
    github.addRepository(['meridian', 'api'])
    github.addRepository(['meridian', 'web'])
    // In one, the first repository is on no host and the second on GitHub; in the other, the other way about.
    const localFirst = folderOf('api', 'web')
    git(join(localFirst, 'web'), 'remote', 'add', 'origin', `${HOST}/meridian/web.git`)
    const hostedFirst = folderOf('api', 'web')
    git(join(hostedFirst, 'api'), 'remote', 'add', 'origin', `${HOST}/meridian/api.git`)
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const changes = yield* Changes
      const sessions = yield* Sessions
      yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
      const one = yield* open(localFirst)
      const onWeb = yield* createTask(one.projectId, ['web'])
      assert.strictEqual(yield* changes.endFor(one.projectId, onWeb.taskId), 'draft')
      const two = yield* open(hostedFirst)
      const alsoOnWeb = yield* createTask(two.projectId, ['web'])
      assert.strictEqual(yield* changes.endFor(two.projectId, alsoOnWeb.taskId), null)
      // Before a task says which, any of the project's on a connected host is enough.
      assert.strictEqual(yield* changes.endFor(two.projectId), 'draft')

      // The lead is told where the ones it doesn't change are.
      yield* sessions.start({ threadId: onWeb.threadId, agentId: 'codex' })
      assert.strictEqual(launches.at(-1)?.cwd, onWeb.worktree)
      const [brief] = yield* until(turns(onWeb.threadId), (rows) => rows.length > 0)
      assert.include(brief?.prompt ?? '', `The project's other repositories, to read but not change`)
      assert.include(brief?.prompt ?? '', `api at ${join(localFirst, 'api')}.`)
    }).pipe(Effect.provide(runtime(':memory:', {}, { connectors: fakeConnectors({ github }) })))
  })

  it.live('lets the coordinator name the ones a task changes, and says which there are', () =>
    Effect.gen(function* () {
      const opened = yield* open(folderOf('api', 'web'))
      const coordinator = { role: 'coordinator' as const, projectId: opened.projectId, threadId: 't', sessionId: 'c', taskId: null }
      assert.match(
        yield* callTool(coordinator, 'draft_task', { title: 'Share it' }),
        /Say which of the project's repositories the task changes, as repositories: api, web\./,
      )
      assert.match(
        yield* callTool(coordinator, 'draft_task', { title: 'Share it', repositories: ['mobile'] }),
        /no repository called mobile/,
      )
      assert.match(yield* callTool(coordinator, 'draft_task', { title: 'Share it', repositories: ['api', 'web'] }), /^Drafted share-it/)
      assert.match(
        yield* callTool(coordinator, 'read_task', { task: 'share-it' }),
        /api: branch althar\/share-it, in .*\nweb: branch althar\/share-it/,
      )
    }).pipe(Effect.provide(runtime())),
  )

  it.live('reviews and opens a pull request for each, and acts on the one named', () => {
    const bares: Record<string, string> = {}
    for (const name of ['api', 'web']) {
      bares[name] = mkdtempSync(join(tmpdir(), 'althar-remote-'))
      execFileSync('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: bares[name] })
    }
    const github = makeFakeService({ pushUrl: (path) => bares[path.at(-1) ?? ''] ?? '' })
    github.addRepository(['meridian', 'api'])
    github.addRepository(['meridian', 'web'])
    const folder = folderOf('api', 'web')
    for (const name of ['api', 'web']) git(join(folder, name), 'remote', 'add', 'origin', `${HOST}/meridian/${name}.git`)
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
      const opened = yield* open(folder)
      const projects = yield* Projects
      const plans = yield* Plans
      const queries = yield* Queries
      const changes = yield* Changes
      const sql = yield* SqlClient.SqlClient
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: opened.projectId,
        title: 'Share the retry',
        description: '[lead:finish] [review:pass]',
        draft: true,
        repositories: ['api', 'web'],
      })
      const worktrees = yield* sql<{ path: string }>`
        SELECT w.path FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id WHERE w.task_id = ${task.taskId} ORDER BY b.created_at, b.rowid`
      for (const worktree of worktrees) {
        writeFileSync(join(worktree.path, 'retry.txt'), 'retry\n')
        git(worktree.path, 'add', '.')
        git(worktree.path, 'commit', '-q', '-m', 'Retry')
      }
      const planId = yield* plans.propose({
        projectId: opened.projectId as Parameters<typeof plans.propose>[0]['projectId'],
        taskId: task.taskId,
        steps: [
          { key: 'implement', agentId: 'codex', model: null, skipped: false },
          { key: 'review', agentId: 'claude-code', model: null, skipped: false },
        ],
        reason: null,
        actorId: instance.personId,
      })
      yield* plans.start(planId, instance.personId)
      const [published] = yield* until(
        Effect.map(queries.thread(task.threadId, { limit: 50 }), (thread) =>
          thread.items.flatMap((item) => (item.kind === 'step_result' && item.content.step === 'publish' ? [item.content.summary] : [])),
        ),
        (found) => found.length === 1,
        Duration.seconds(20),
      )
      assert.match(published ?? '', /^api: Opened draft pull request #\d+\.\nweb: Opened draft pull request #\d+\.$/)
      // The reviewer read a copy of each.
      const [review] = yield* sql<{ prompt: string }>`
        SELECT d.prompt FROM turn_deliveries d JOIN threads t ON t.id = d.thread_id WHERE t.task_id = ${task.taskId} AND t.kind = 'step'
        ORDER BY d.requested_at LIMIT 1`
      assert.include(review?.prompt ?? '', 'The change spans several repositories')
      // Its copies are beside the task's folder, not in it, where the lead starts and could change them.
      const taskFolder = dirname(worktrees[0]?.path ?? '')
      assert.deepStrictEqual(readdirSync(taskFolder).toSorted(), ['api', 'web'])
      assert.include(review?.prompt ?? '', join(dirname(taskFolder), '.review', basename(taskFolder), 'web'))

      // Each repository opened its own, not the first one's again.
      assert.lengthOf(github.changes, 2)
      assert.match(
        published ?? '',
        new RegExp(
          `^api: Opened draft pull request #${github.changes[0]?.number ?? 0}\\.\\nweb: Opened draft pull request #${github.changes[1]?.number ?? 0}\\.$`,
        ),
      )
      const [api, web] = github.changes
      const lead = { role: 'lead' as const, projectId: opened.projectId, threadId: task.threadId, sessionId: 'none', taskId: task.taskId }
      const read = yield* callTool(lead, 'read_pull_request', {})
      assert.include(read, `PR #${api?.number ?? 0}`)
      assert.include(read, `PR #${web?.number ?? 0}`)
      // Numbers repeat across repositories, so the lead names one by its repository too.
      assert.include(read, `web#${web?.number ?? 0}: `)
      assert.include(
        yield* callTool(lead, 'reply_on_pull_request', { body: 'Done.' }),
        `This task has several pull requests: api#${api?.number ?? 0}, web#${web?.number ?? 0}.`,
      )
      assert.include(
        yield* callTool(lead, 'reply_on_pull_request', { body: 'Done.', pull_request: `mobile#${web?.number ?? 0}` }),
        'Say which with pull_request',
      )
      assert.strictEqual(
        yield* callTool(lead, 'reply_on_pull_request', { body: 'Done.', pull_request: `web#${web?.number ?? 0}` }),
        `Replied on PR #${web?.number ?? 0}.`,
      )
      assert.lengthOf(github.commentsOn(web?.number ?? 0), 1)
      assert.lengthOf(github.commentsOn(api?.number ?? 0), 0)
      // The person marks one ready, and pushes what the lead committed in the other.
      yield* changes.markReady(task.taskId, web?.url ?? '')
      assert.deepStrictEqual(
        github.changes.map((one) => one.draft),
        [true, false],
      )
      git(worktrees[0]?.path ?? '', 'commit', '-q', '--allow-empty', '-m', 'More')
      yield* changes.push(task.taskId, git(worktrees[0]?.path ?? '', 'rev-parse', 'HEAD'), api?.url ?? '')
      assert.include(git(bares.api ?? '', 'log', '--format=%s', task.branch), 'More')
      assert.notInclude(git(bares.web ?? '', 'log', '--format=%s', task.branch), 'More')

      // One merged isn't the task done: it says which is still open, and is done once that one is merged too.
      const state = sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${task.taskId}`
      const notices = Effect.map(queries.thread(task.threadId, { limit: 100 }), (thread) =>
        thread.items.flatMap((item) =>
          item.kind === 'notice' && item.content.title.startsWith('Not done yet') ? [item.content.title] : [],
        ),
      )
      github.mergeByHand(api?.number ?? 0)
      yield* changes.refresh(task.taskId)
      const [notDone] = yield* until(notices, (found) => found.length === 1)
      assert.strictEqual(notDone, `Not done yet: PR #${web?.number ?? 0} in web is still open.`)
      assert.strictEqual((yield* state)[0]?.state, 'open')
      github.mergeByHand(web?.number ?? 0)
      yield* changes.refresh(task.taskId)
      yield* until(state, (rows) => rows[0]?.state === 'done')
    }).pipe(Effect.provide(withQueries(':memory:', {}, { connectors: fakeConnectors({ github }) })))
  })
})
