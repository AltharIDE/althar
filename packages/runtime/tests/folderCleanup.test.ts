import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { KEPT } from '../src/bringBack'
import { FolderCleanup, goneWords, sizeWords, waitDays } from '../src/FolderCleanup'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Sessions } from '../src/Sessions'
import * as Runtime from '../src/Runtime'
import { Tasks } from '../src/Tasks'
import { repository, runtime, until } from './support'

/*
 * Finished tasks' folders (ADR-055): one goes once its wait is up, keeping
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

/** A task in a new repository, with a file committed on its branch, settled `days` ago as `state`. */
const finished = (state: 'done' | 'abandoned', days: number, title = 'Add a retry') =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const sql = yield* SqlClient.SqlClient
    const root = repository()
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
      yield* (yield* FolderCleanup).sweep
      assert.isFalse(existsSync(task.worktree))
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
      yield* cleanup.remove(task.taskId, yield* Effect.map(Instance, (instance) => instance.personId))
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
      assert.match((yield* folderLines(older.threadId))[0]?.title ?? '', /^Folder removed when this Mac ran low on space/)
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
      yield* cleanup.remove(task.taskId, person)
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
    assert.strictEqual(goneWords('low', 7, null), 'Folder removed when this Mac ran low on space')
    assert.strictEqual(sizeWords(10 * 1024 ** 3), '10 GB')
  })
})
