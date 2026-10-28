import { execFileSync } from 'node:child_process'
import { appendFileSync, chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Deferred, Effect, Fiber, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { attachmentsIn } from '../src/attachments'
import { bringBack, folderOf, KEPT } from '../src/bringBack'
import { FolderCleanup, goneWords, ownedBytes, sizeWords, waitDays } from '../src/FolderCleanup'
import { Instance } from '../src/Instance'
import { Launches } from '../src/Launches'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Sessions } from '../src/Sessions'
import * as Runtime from '../src/Runtime'
import { Setups } from '../src/Setups'
import { Tasks } from '../src/Tasks'
import { repository, ROOMY_DISK, runtime, until } from './support'

/*
 * Finished tasks' folders (ADR-056): one goes once its wait is up, keeping
 * its branch and the commit it was at, and its task still reads what it
 * changed; one with work only in it is held back, and goes by hand; Clean
 * up takes what nothing holds, whatever its wait; the person's choice of
 * wait is kept; and a folder that went comes back as its task reopens.
 */

const withCleanup = () => Queries.layer.pipe(Layer.provideMerge(runtime()))

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd })
    .toString()
    .trim()

const commit = (cwd: string, file: string, text: string) => {
  writeFileSync(join(cwd, file), text)
  git(cwd, 'add', '.')
  git(cwd, 'commit', '-q', '-m', `Write ${file}`)
  return git(cwd, 'rev-parse', 'HEAD')
}

const DAY = 86_400_000

const windows = process.platform === 'win32'

/** A run that keeps running until it is stopped. */
const LONG = `node -e "setTimeout(() => {}, 60000)"`

const person = Effect.map(Instance, (instance) => instance.personId)

/** A task in a new repository, with a file committed on its branch, settled `days` ago as `state`; `before` changes the repository first. */
const finished = (state: 'done' | 'abandoned', days: number, title = 'Add a retry', before?: (root: string) => void) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const sql = yield* SqlClient.SqlClient
    const root = repository()
    before?.(root)
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: root })
    const task = yield* projects.createTask({ envelope: yield* Runtime.envelope('task.create', {}), projectId: project.projectId, title })
    const [workspace] = yield* sql<{ id: string; path: string; branch: string }>`
      SELECT id, path, branch FROM workspaces WHERE task_id = ${task.taskId}`
    const worktree = workspace?.path ?? ''
    const head = commit(worktree, 'retry.ts', 'retry\n')
    const at = new Date(Date.now() - days * DAY).toISOString()
    yield* sql`UPDATE workspaces SET branched_at = ${at} WHERE task_id = ${task.taskId}`
    yield* sql`UPDATE tasks SET state = ${state}, settled_at = ${at} WHERE id = ${task.taskId}`
    return {
      root,
      projectId: project.projectId,
      taskId: task.taskId,
      threadId: task.threadId,
      worktree,
      workspaceId: workspace?.id ?? '',
      branch: workspace?.branch ?? '',
      head,
    }
  })

const stateOf = (workspaceId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{
      state: string
      cleanedAt: string | null
    }>`SELECT state, cleaned_at FROM workspaces WHERE id = ${workspaceId}`
    return row
  })

const folderLines = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{
      content: string
    }>`SELECT content FROM thread_items WHERE thread_id = ${threadId} AND kind = 'notice' ORDER BY sequence`
    return rows.map((row) => JSON.parse(row.content) as { title: string; role?: string }).filter((notice) => notice.role === 'folder')
  })

/** The folders, once every size and hold is measured. */
const measured = Effect.gen(function* () {
  const cleanup = yield* FolderCleanup
  yield* cleanup.list
  const [listed] = yield* until(
    Effect.map(cleanup.list, (one) => [one]),
    ([one]) => one !== undefined && !one.measuring,
  )
  return listed!
})

describe('finished tasks’ folders', () => {
  it.live('removes a merged task’s folder once its wait is up, keeping its branch and its last commit, and says so', () =>
    Effect.gen(function* () {
      const task = yield* finished('done', 4)
      // Files the person sent its lead go with it: in its worktree, and in the folder that holds a task's several.
      attachmentsIn(task.worktree)
      writeFileSync(join(attachmentsIn(dirname(task.worktree)), 'spec.pdf'), '%PDF')
      yield* (yield* FolderCleanup).sweep
      assert.isFalse(existsSync(task.worktree))
      assert.isFalse(existsSync(dirname(task.worktree)))
      assert.strictEqual((yield* stateOf(task.workspaceId))?.state, 'cleaned')
      assert.strictEqual(git(task.root, 'rev-parse', `refs/heads/${task.branch}`), task.head)
      assert.strictEqual(git(task.root, 'rev-parse', `${KEPT}${task.workspaceId}`), task.head)
      const [line] = yield* folderLines(task.threadId)
      assert.match(line?.title ?? '', /^Folder removed 3 days after the task finished/)
      // What it changed still reads, from its repository.
      const queries = yield* Queries
      const snapshot = yield* queries.thread(task.threadId, {})
      assert.strictEqual(snapshot.task.folder, 'removed')
      assert.deepStrictEqual(
        snapshot.task.files.map((file) => [file.path, file.status]),
        [['retry.ts', 'added']],
      )
      assert.strictEqual(snapshot.task.commits, 1)
      const diff = yield* queries.fileDiff(task.taskId, 'retry.ts')
      assert.deepStrictEqual(
        diff.lines.filter((line) => line.kind === 'added').map((line) => line.text),
        ['retry'],
      )
    }).pipe(Effect.provide(withCleanup())),
  )

  it.live('leaves a folder whose wait isn’t up, and Clean up takes it', () =>
    Effect.gen(function* () {
      const task = yield* finished('done', 1)
      const cleanup = yield* FolderCleanup
      yield* cleanup.sweep
      assert.isTrue(existsSync(task.worktree))
      const listed = yield* measured
      assert.deepStrictEqual(
        listed.folders.map((folder) => [folder.taskId, folder.kind, folder.held]),
        [[task.taskId, 'merged', null]],
      )
      assert.isTrue((listed.folders[0]?.bytes ?? 0) > 0)
      const freed = yield* cleanup.cleanUp(yield* Effect.map(Instance, (instance) => instance.personId))
      assert.strictEqual(freed.failed, 0)
      assert.isFalse(existsSync(task.worktree))
      assert.match((yield* folderLines(task.threadId))[0]?.title ?? '', /^Folder removed when you cleaned up/)
      assert.deepStrictEqual((yield* cleanup.list).folders, [])
    }).pipe(Effect.provide(withCleanup())),
  )

  it.live('measures what removing a folder frees, not installs it shares with a store outside it, and says it freed what went', () =>
    Effect.gen(function* () {
      const MB = 1024 ** 2
      const store = realpathSync(mkdtempSync(join(tmpdir(), 'althar-store-')))
      writeFileSync(join(store, 'cloned.node'), Buffer.alloc(8 * MB, 1))
      writeFileSync(join(store, 'linked.node'), Buffer.alloc(8 * MB, 2))
      writeFileSync(join(store, 'edited.node'), Buffer.alloc(8 * MB, 5))
      const task = yield* finished('done', 1, 'Add a retry', (root) => {
        writeFileSync(join(root, '.gitignore'), 'node_modules\n')
        git(root, 'add', '.')
        git(root, 'commit', '-q', '-m', 'Install')
      })
      // Installs from the store: a clone where the disk has them, a hardlink; and what a package built, which is the folder's own.
      const modules = join(task.worktree, 'node_modules', 'pkg')
      mkdirSync(modules, { recursive: true })
      if (process.platform === 'darwin') execFileSync('cp', ['-c', join(store, 'cloned.node'), join(modules, 'cloned.node')])
      linkSync(join(store, 'linked.node'), join(modules, 'linked.node'))
      writeFileSync(join(modules, 'built.node'), Buffer.alloc(8 * MB, 3))
      // A clone from the store edited after: it holds its new block, not the ones it still shares with the store.
      if (process.platform === 'darwin') {
        execFileSync('cp', ['-c', join(store, 'edited.node'), join(modules, 'edited.node')])
        appendFileSync(join(modules, 'edited.node'), 'patched')
      }
      const listed = yield* measured
      const bytes = listed.folders[0]?.bytes ?? null
      assert.isNotNull(bytes)
      assert.isAbove(bytes!, 8 * MB)
      assert.isBelow(bytes!, 9 * MB)
      // Built after it was listed: what it freed is what went, measured as it went.
      writeFileSync(join(modules, 'later.node'), Buffer.alloc(4 * MB, 4))
      const freed = yield* (yield* FolderCleanup).cleanUp(yield* person)
      assert.strictEqual(freed.failed, 0)
      assert.isAbove(freed.freed, bytes! + 4 * MB - 1)
      assert.isBelow(freed.freed, bytes! + 5 * MB)
      assert.isFalse(existsSync(task.worktree))
      rmSync(store, { recursive: true, force: true })
    }).pipe(Effect.provide(withCleanup())),
  )

  it.live("lists a folder part of which can't be read as of a size not known, not as what the rest takes", () =>
    Effect.gen(function* () {
      const task = yield* finished('done', 1, 'Add a retry', (root) => {
        writeFileSync(join(root, '.gitignore'), 'cache\n')
        git(root, 'add', '.')
        git(root, 'commit', '-q', '-m', 'Ignore')
      })
      const locked = join(task.worktree, 'cache')
      mkdirSync(locked)
      writeFileSync(join(locked, 'big'), Buffer.alloc(1024 ** 2, 1))
      chmodSync(locked, 0o000)
      const listed = yield* measured.pipe(Effect.ensuring(Effect.sync(() => chmodSync(locked, 0o755))))
      assert.strictEqual(listed.folders.length, 1)
      assert.isNull(listed.folders[0]?.bytes)
    }).pipe(Effect.provide(withCleanup())),
  )

  it.live('holds back a folder with changes not committed, which goes by hand', () =>
    Effect.gen(function* () {
      const task = yield* finished('done', 10)
      writeFileSync(join(task.worktree, 'draft.ts'), 'draft\n')
      const cleanup = yield* FolderCleanup
      yield* cleanup.sweep
      assert.isTrue(existsSync(task.worktree))
      const listed = yield* measured
      assert.deepStrictEqual(listed.folders[0]?.held, { why: 'uncommitted', count: 1 })
      yield* cleanup.cleanUp(yield* Effect.map(Instance, (instance) => instance.personId))
      assert.isTrue(existsSync(task.worktree))
      yield* cleanup.remove(task.taskId, { why: 'uncommitted', count: 1 }, yield* person)
      assert.isFalse(existsSync(task.worktree))
      assert.strictEqual((yield* folderLines(task.threadId))[0]?.title.startsWith('You removed its folder'), true)
    }).pipe(Effect.provide(withCleanup())),
  )

  it.live('holds back an abandoned change whose commits were pushed nowhere', () =>
    Effect.gen(function* () {
      const task = yield* finished('abandoned', 20)
      yield* (yield* FolderCleanup).sweep
      assert.isTrue(existsSync(task.worktree))
      const listed = yield* measured
      assert.deepStrictEqual(
        listed.folders.map((folder) => [folder.kind, folder.held]),
        [['abandoned', { why: 'unpushed', count: 1 }]],
      )
    }).pipe(Effect.provide(withCleanup())),
  )

  it.live('keeps the folder of a task still at work, and of one kept for later', () =>
    Effect.gen(function* () {
      const task = yield* finished('done', 30)
      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE tasks SET state = 'open', settled_at = NULL, kept_at = ${new Date().toISOString()} WHERE id = ${task.taskId}`
      const cleanup = yield* FolderCleanup
      yield* cleanup.sweep
      assert.isTrue(existsSync(task.worktree))
      assert.deepStrictEqual((yield* cleanup.list).folders, [])
    }).pipe(Effect.provide(withCleanup())),
  )

  it.live('makes room when the disk runs low, the oldest finished folder first, whatever its wait, until there is enough', () => {
    // 5% free until the older folder goes, then half.
    let watched: string | null = null
    const disk = () =>
      Effect.sync(() => {
        const free = watched !== null && !existsSync(watched) ? 0.5 : 0.05
        return { total: 1000, free: 1000 * free, used: 1000 * (1 - free) }
      })
    return Effect.gen(function* () {
      const older = yield* finished('done', 2, 'Older')
      const newer = yield* finished('done', 1, 'Newer')
      watched = older.worktree
      yield* (yield* FolderCleanup).sweep
      assert.isFalse(existsSync(older.worktree))
      assert.isTrue(existsSync(newer.worktree))
      assert.match((yield* folderLines(older.threadId))[0]?.title ?? '', /^Folder removed when this computer ran low on space/)
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { disk })))))
  })

  it.live('keeps the person’s choice of wait, and with Only when I clean up removes nothing by itself', () =>
    Effect.gen(function* () {
      const task = yield* finished('done', 40)
      const cleanup = yield* FolderCleanup
      assert.strictEqual(yield* cleanup.wait, 'smart')
      yield* cleanup.setWait('never')
      assert.strictEqual(yield* cleanup.wait, 'never')
      yield* cleanup.sweep
      assert.isTrue(existsSync(task.worktree))
      yield* cleanup.setWait('smart')
      const sql = yield* SqlClient.SqlClient
      assert.deepStrictEqual(yield* sql`SELECT key FROM settings WHERE key = 'folder_wait'`, [])
    }).pipe(Effect.provide(withCleanup())),
  )

  it.live('brings a removed folder back on its branch as its task reopens, and says so', () =>
    Effect.gen(function* () {
      const task = yield* finished('abandoned', 3)
      const cleanup = yield* FolderCleanup
      const person = yield* Effect.map(Instance, (instance) => instance.personId)
      // Its commit pushed nowhere holds it back; by hand it goes.
      yield* cleanup.remove(task.taskId, { why: 'unpushed', count: 1 }, person)
      assert.isFalse(existsSync(task.worktree))
      yield* (yield* Tasks).reopen({ envelope: yield* Runtime.envelope('task.reopen', {}), taskId: task.taskId })
      assert.isTrue(existsSync(join(task.worktree, 'retry.ts')))
      assert.strictEqual(git(task.worktree, 'rev-parse', 'HEAD'), task.head)
      assert.strictEqual((yield* stateOf(task.workspaceId))?.state, 'ready')
      assert.deepStrictEqual(
        (yield* folderLines(task.threadId)).map((line) => line.title.split(' · ')[0]),
        ['You removed its folder', 'Folder back from its branch'],
      )
    }).pipe(Effect.provide(withCleanup())),
  )
})

describe('a folder going, asked again as it goes', () => {
  it.live('keeps one changed, opened or run from after it was chosen to go', () => {
    // What happens between choosing the folders and removing them, as the disk is read before they go.
    let between: Effect.Effect<void> = Effect.void
    const disk = () =>
      Effect.suspend(() => {
        const now = between
        between = Effect.void
        return Effect.as(now, ROOMY_DISK)
      })
    return Effect.gen(function* () {
      const changed = yield* finished('done', 10, 'Changed')
      const opened = yield* finished('done', 10, 'Opened')
      const run = yield* finished('done', 10, 'Run')
      const sql = yield* SqlClient.SqlClient
      const launches = yield* Launches
      yield* launches.keep({ projectId: run.projectId, run: { command: LONG, setup: null }, actorId: yield* person })
      const at = new Date().toISOString()
      let started = ''
      between = Effect.gen(function* () {
        writeFileSync(join(changed.worktree, 'draft.ts'), 'draft\n')
        yield* sql`UPDATE tasks SET opened_at = ${at} WHERE id = ${opened.taskId}`
        started = (yield* launches.start({ projectId: run.projectId, taskId: run.taskId, threadId: null })).id
      }).pipe(Effect.orDie)
      yield* (yield* FolderCleanup).sweep
      for (const task of [changed, opened, run]) assert.isTrue(existsSync(join(task.worktree, 'retry.ts')))
      for (const task of [changed, opened, run]) assert.deepStrictEqual(yield* folderLines(task.threadId), [])
      const listed = yield* measured
      assert.deepStrictEqual(
        listed.folders.toSorted((a, b) => a.title.localeCompare(b.title)).map((folder) => [folder.title, folder.held?.why]),
        [
          ['Changed', 'uncommitted'],
          ['Opened', 'opened'],
          ['Run', 'running'],
        ],
      )
      yield* launches.stop(started)
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { disk })))))
  })

  it.live('holds a folder opened today and changed for its changes, and by hand removes it only as far as the person was told', () =>
    Effect.gen(function* () {
      const task = yield* finished('done', 10)
      const sql = yield* SqlClient.SqlClient
      const cleanup = yield* FolderCleanup
      yield* sql`UPDATE tasks SET opened_at = ${new Date().toISOString()} WHERE id = ${task.taskId}`
      writeFileSync(join(task.worktree, 'draft.ts'), 'draft\n')
      // What would be lost with it comes before its being opened.
      assert.deepStrictEqual((yield* measured).folders[0]?.held, { why: 'uncommitted', count: 1 })
      // Told only that it was opened, the person didn't choose to lose its changes.
      assert.deepInclude(yield* Effect.flip(cleanup.remove(task.taskId, { why: 'opened', count: null }, yield* person)), {
        _tag: 'ChangedSinceSeen',
        what: 'folder',
      })
      // Nor, told of one file not committed, two.
      writeFileSync(join(task.worktree, 'more.ts'), 'more\n')
      assert.deepInclude(yield* Effect.flip(cleanup.remove(task.taskId, { why: 'uncommitted', count: 1 }, yield* person)), {
        _tag: 'ChangedSinceSeen',
      })
      // While something runs from it, it stays, whatever they were told.
      const launches = yield* Launches
      yield* launches.keep({ projectId: task.projectId, run: { command: LONG, setup: null }, actorId: yield* person })
      const started = yield* launches.start({ projectId: task.projectId, taskId: task.taskId, threadId: null })
      assert.deepInclude(yield* Effect.flip(cleanup.remove(task.taskId, { why: 'uncommitted', count: 2 }, yield* person)), {
        _tag: 'TaskRefused',
        why: 'folder_in_use',
      })
      yield* launches.stop(started.id)
      assert.isTrue(existsSync(join(task.worktree, 'more.ts')))
      yield* cleanup.remove(task.taskId, { why: 'uncommitted', count: 2 }, yield* person)
      assert.isFalse(existsSync(task.worktree))
    }).pipe(Effect.provide(withCleanup())),
  )

  it.live('keeps a folder whose last commit can’t be kept, counted as one that couldn’t go', () =>
    Effect.gen(function* () {
      const task = yield* finished('done', 4)
      const cleanup = yield* FolderCleanup
      // Another git holds the ref it would be kept under.
      const refs = join(task.root, '.git', 'refs', 'althar', 'kept')
      mkdirSync(refs, { recursive: true })
      const lock = join(refs, `${task.workspaceId}.lock`)
      writeFileSync(lock, '')
      assert.strictEqual((yield* cleanup.cleanUp(yield* person)).failed, 1)
      assert.isTrue(existsSync(join(task.worktree, 'retry.ts')))
      assert.strictEqual((yield* stateOf(task.workspaceId))?.state, 'ready')
      assert.deepStrictEqual(yield* folderLines(task.threadId), [])
      rmSync(lock)
      yield* cleanup.sweep
      assert.isFalse(existsSync(task.worktree))
      assert.strictEqual(git(task.root, 'rev-parse', `${KEPT}${task.workspaceId}`), task.head)
    }).pipe(Effect.provide(withCleanup())),
  )

  it.live.skipIf(windows || process.getuid?.() === 0)(
    'keeps a folder it can’t delete marked as here, and never takes something else in its place for it',
    () =>
      Effect.gen(function* () {
        const task = yield* finished('done', 4)
        const cleanup = yield* FolderCleanup
        const locked = join(task.worktree, 'locked')
        mkdirSync(locked)
        commit(task.worktree, 'locked/kept.txt', 'kept\n')
        chmodSync(locked, 0o555)
        const freed = yield* cleanup.cleanUp(yield* person).pipe(Effect.ensuring(Effect.sync(() => chmodSync(locked, 0o755))))
        assert.strictEqual(freed.failed, 1)
        assert.isTrue(existsSync(join(locked, 'kept.txt')))
        assert.strictEqual((yield* stateOf(task.workspaceId))?.state, 'ready')
        assert.deepStrictEqual(yield* folderLines(task.threadId), [])
        // Still listed, as whatever is left of it: removed by hand, it goes.
        const [left] = (yield* measured).folders
        yield* cleanup.remove(task.taskId, left?.held ?? null, yield* person)
        assert.isFalse(existsSync(task.worktree))
        assert.strictEqual((yield* stateOf(task.workspaceId))?.state, 'cleaned')
        // Something else where its folder goes isn't taken for it, nor removed.
        mkdirSync(task.worktree, { recursive: true })
        writeFileSync(join(task.worktree, 'mine.txt'), 'mine\n')
        assert.deepInclude(yield* Effect.flip(bringBack(task.taskId, yield* person)), { _tag: 'TaskRefused', why: 'folder_in_way' })
        assert.isTrue(existsSync(join(task.worktree, 'mine.txt')))
        assert.strictEqual((yield* stateOf(task.workspaceId))?.state, 'cleaned')
      }).pipe(Effect.provide(withCleanup())),
  )
})

describe('a task whose folder was removed', () => {
  it.live('still reads a document its agent committed, from the commit kept as its folder went', () =>
    Effect.gen(function* () {
      const task = yield* finished('done', 4)
      commit(task.worktree, 'NOTES.md', '# Notes\n\nRetry three times.\n')
      yield* (yield* FolderCleanup).sweep
      assert.isFalse(existsSync(task.worktree))
      const queries = yield* Queries
      const document = yield* queries.document(task.threadId, 'NOTES.md')
      assert.deepStrictEqual([document.body, document.lines], ['# Notes\n\nRetry three times.\n', 3])
      assert.strictEqual((yield* queries.document(task.threadId, join(task.worktree, 'NOTES.md'))).bytes, document.bytes)
      assert.strictEqual((yield* Effect.flip(queries.document(task.threadId, 'GONE.md')))._tag, 'NotFound')
      assert.strictEqual((yield* Effect.flip(queries.document(task.threadId, '../outside.md')))._tag, 'DocumentRefused')
      assert.strictEqual((yield* Effect.flip(queries.document(task.threadId, 'retry.ts')))._tag, 'DocumentRefused')
    }).pipe(Effect.provide(withCleanup())),
  )
})

describe('a task of several repositories whose folders were removed', () => {
  it.live('reads a document from the repository it is in, removed or not', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const sql = yield* SqlClient.SqlClient
      const queries = yield* Queries
      // Two repositories, api and web, in one folder.
      const folder = realpathSync(mkdtempSync(join(tmpdir(), 'althar-two-')))
      for (const name of ['api', 'web']) {
        mkdirSync(join(folder, name))
        git(join(folder, name), 'init', '-q', '-b', 'main')
        commit(join(folder, name), 'README.md', `# ${name}\n`)
      }
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: folder })
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Notes',
        repositories: ['api', 'web'],
      })
      const [api, web] = yield* sql<{ id: string; path: string }>`
        SELECT w.id, w.path FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id WHERE w.task_id = ${task.taskId} ORDER BY b.created_at, b.rowid`
      commit(web?.path ?? '', 'NOTES.md', '# Web notes\n')
      const at = new Date(Date.now() - 4 * DAY).toISOString()
      yield* sql`UPDATE tasks SET state = 'done', settled_at = ${at} WHERE id = ${task.taskId}`
      yield* (yield* FolderCleanup).sweep
      assert.isFalse(existsSync(web?.path ?? ''))
      // Web's, by where it was, from web's kept commit; a relative path is the first repository's, which has none.
      assert.strictEqual((yield* queries.document(task.threadId, join(web?.path ?? '', 'NOTES.md'))).body, '# Web notes\n')
      assert.strictEqual((yield* Effect.flip(queries.document(task.threadId, 'NOTES.md')))._tag, 'NotFound')
      // Api's folder back by itself: its documents read from it, web's still from its kept commit.
      git(join(folder, 'api'), 'worktree', 'add', '-q', '--detach', api?.path ?? '', `${KEPT}${api?.id ?? ''}`)
      yield* sql`UPDATE workspaces SET state = 'ready' WHERE id = ${api?.id ?? ''}`
      writeFileSync(join(api?.path ?? '', 'PLAN.md'), '# Api plan\n')
      assert.strictEqual((yield* queries.document(task.threadId, 'PLAN.md')).body, '# Api plan\n')
      assert.strictEqual((yield* queries.document(task.threadId, join(api?.path ?? '', 'README.md'))).body, '# api\n')
      assert.strictEqual((yield* queries.document(task.threadId, join(web?.path ?? '', 'NOTES.md'))).body, '# Web notes\n')
      assert.strictEqual((yield* queries.document(task.threadId, join(web?.path ?? '', 'README.md'))).body, '# web\n')
    }).pipe(Effect.provide(withCleanup())),
  )
})

describe('a removed folder coming back', () => {
  it.live('comes back on its branch before an agent starts on its task, and is set up again', () =>
    Effect.gen(function* () {
      const task = yield* finished('done', 4)
      yield* (yield* FolderCleanup).sweep
      assert.isFalse(existsSync(task.worktree))
      const sessions = yield* Sessions
      yield* sessions.start({ threadId: task.threadId, agentId: 'codex' })
      assert.isTrue(existsSync(join(task.worktree, 'retry.ts')))
      assert.strictEqual(git(task.worktree, 'rev-parse', 'HEAD'), task.head)
      assert.deepStrictEqual(
        (yield* folderLines(task.threadId)).map((line) => line.title.split(' · ')[0]),
        ['Folder removed 3 days after the task finished', 'Folder back from its branch'],
      )
      yield* sessions.stop(task.threadId)
    }).pipe(Effect.provide(withCleanup())),
  )
})

describe('a removed folder set up again', () => {
  it.live('runs only once it is set up, whichever brought it back, and nothing removes it meanwhile', () =>
    Effect.gen(function* () {
      const task = yield* finished('done', 4)
      const cleanup = yield* FolderCleanup
      const launches = yield* Launches
      const setups = yield* Setups
      const sql = yield* SqlClient.SqlClient
      // Its first setup, begun as it was made, done before the one kept below: one reading it late would wait in the
      // folder, which Windows won't remove while a process works in it.
      yield* setups.ready(task.taskId)
      // Its setup waits until the test says.
      const go = join(realpathSync(mkdtempSync(join(tmpdir(), 'althar-go-'))), 'go')
      yield* launches.keep({
        projectId: task.projectId,
        // In Node, which both a POSIX shell and cmd.exe run, and by a path with /, which Node takes on Windows too.
        run: {
          command: LONG,
          setup: `node -e "const fs = require('fs'); const wait = () => fs.existsSync('${go.replaceAll('\\', '/')}') || setTimeout(wait, 50); wait()"`,
        },
        actorId: yield* person,
      })
      yield* cleanup.sweep
      assert.isFalse(existsSync(task.worktree))
      // Open in brings it back and begins its setup, without waiting; Run, pressed meanwhile, waits for it.
      assert.isTrue(yield* bringBack(task.taskId, yield* person))
      yield* setups.begin(task.taskId)
      const ran = yield* Deferred.make<void>()
      const running = yield* Effect.forkChild(
        launches
          .start({ projectId: task.projectId, taskId: task.taskId, threadId: null })
          .pipe(Effect.ensuring(Deferred.succeed(ran, undefined))),
      )
      yield* Effect.sleep('1 second')
      assert.isFalse(yield* Deferred.isDone(ran))
      assert.isTrue(yield* launches.using(task.taskId))
      assert.strictEqual(yield* folderOf(task.taskId), 'returning')
      assert.strictEqual((yield* cleanup.cleanUp(yield* person)).failed, 0)
      assert.isTrue(existsSync(join(task.worktree, 'retry.ts')))
      writeFileSync(go, '')
      const started = yield* Fiber.join(running)
      const [setUp] = yield* sql<{ setup: string }>`SELECT setup FROM workspaces WHERE id = ${task.workspaceId}`
      const [launched] = yield* sql<{ launchedAt: string }>`SELECT launched_at FROM processes WHERE id = ${started.id}`
      assert.isTrue((JSON.parse(setUp?.setup ?? '{}') as { at: string }).at <= (launched?.launchedAt ?? ''))
      assert.isUndefined(yield* folderOf(task.taskId))
      yield* launches.stop(started.id)
    }).pipe(Effect.provide(withCleanup())),
  )

  it.live('says how a task whose folder went runs, from its repository, and runs it in its folder brought back', () =>
    Effect.gen(function* () {
      const task = yield* finished('done', 4, 'Serve', (root) =>
        commit(root, 'package.json', JSON.stringify({ name: 'serve', private: true, scripts: { dev: LONG } })),
      )
      const launches = yield* Launches
      yield* (yield* FolderCleanup).sweep
      assert.isFalse(existsSync(task.worktree))
      assert.deepStrictEqual(
        (yield* launches.runnables(task.projectId, task.taskId)).map((one) => one.command),
        ['npm run dev'],
      )
      const started = yield* launches.start({ projectId: task.projectId, taskId: task.taskId, threadId: null })
      assert.isTrue(existsSync(join(task.worktree, 'package.json')))
      assert.strictEqual(started.command, 'npm run dev')
      yield* launches.stop(started.id)
    }).pipe(Effect.provide(withCleanup())),
  )

  it.live('sets up an abandoned task’s folder that came back, so it isn’t said to be coming back for ever', () =>
    Effect.gen(function* () {
      const task = yield* finished('abandoned', 3)
      const cleanup = yield* FolderCleanup
      yield* cleanup.remove(task.taskId, { why: 'unpushed', count: 1 }, yield* person)
      assert.isTrue(yield* bringBack(task.taskId, yield* person))
      assert.strictEqual(yield* folderOf(task.taskId), 'returning')
      yield* (yield* Setups).ready(task.taskId)
      assert.isUndefined(yield* folderOf(task.taskId))
      assert.deepStrictEqual((yield* measured).folders[0]?.held, { why: 'unpushed', count: 1 })
    }).pipe(Effect.provide(withCleanup())),
  )
})

describe('the words for a folder going', () => {
  it('says how long it waited, by how the task ended and the choice', () => {
    assert.deepStrictEqual(
      (['review', 'merged', 'done', 'abandoned'] as const).map((kind) => waitDays('smart', kind)),
      [0, 3, 7, 14],
    )
    assert.strictEqual(waitDays('month', 'review'), 30)
    assert.strictEqual(waitDays('never', 'merged'), Infinity)
    assert.strictEqual(goneWords('wait', 0, null), 'Folder removed as the task finished')
    assert.strictEqual(goneWords('wait', 14, 2.3 * 1024 ** 3), 'Folder removed 2 weeks after the task finished · 2.3 GB')
    assert.strictEqual(goneWords('wait', 1, 0), 'Folder removed a day after the task finished')
    assert.strictEqual(goneWords('wait', 30, 14 * 1024 ** 3), 'Folder removed a month after the task finished · 14 GB')
    assert.strictEqual(goneWords('wait', 3, 640 * 1024 ** 2), 'Folder removed 3 days after the task finished · 640 MB')
    assert.strictEqual(goneWords('low', 7, null), 'Folder removed when this computer ran low on space')
    assert.strictEqual(sizeWords(10 * 1024 ** 3), '10 GB')
    assert.strictEqual(sizeWords(300 * 1024), 'under 1 MB')
    assert.strictEqual(sizeWords(0), '0 MB')
    assert.strictEqual(goneWords('hand', 7, 300 * 1024), 'You removed its folder · under 1 MB')
  })

  it('counts a file hardlinked from outside folders as nothing, and one linked only inside them once, across them', async () => {
    const MB = 1024 ** 2
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'althar-owned-')))
    const folder = join(root, 'folder')
    mkdirSync(folder)
    writeFileSync(join(root, 'outside'), Buffer.alloc(2 * MB, 1))
    linkSync(join(root, 'outside'), join(folder, 'shared'))
    writeFileSync(join(folder, 'own'), Buffer.alloc(MB, 2))
    linkSync(join(folder, 'own'), join(folder, 'own-again'))
    const next = join(root, 'next')
    mkdirSync(next)
    linkSync(join(folder, 'own'), join(next, 'own-there'))
    const bytes = await ownedBytes([folder, next])
    rmSync(root, { recursive: true, force: true })
    assert.isAtLeast(bytes, MB)
    assert.isBelow(bytes, MB + 64 * 1024)
  })

  it("can't say what a folder holds where part of it can't be read", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'althar-owned-')))
    const locked = join(root, 'locked')
    mkdirSync(locked)
    writeFileSync(join(locked, 'big'), Buffer.alloc(1024 ** 2, 1))
    chmodSync(locked, 0o000)
    const failed = await ownedBytes([root]).then(
      () => false,
      () => true,
    )
    chmodSync(locked, 0o755)
    rmSync(root, { recursive: true, force: true })
    assert.isTrue(failed)
  })
})
