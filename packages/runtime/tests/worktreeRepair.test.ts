import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer, Logger } from 'effect'
import { SqlClient } from 'effect/sql'

import { git as runtimeGit, repairWorktree } from '../src/git'
import { Projects } from '../src/Projects'
import { reviewCopyOf } from '../src/reviewCopy'
import * as Runtime from '../src/Runtime'
import { linkBroke, linkOf, takenFrom } from '../src/worktreeLinks'
import { takenWords, unrepairedWords, WorktreeRepair } from '../src/WorktreeRepair'
import { Queries } from '../src/Queries'
import { repository, runtime } from './support'

/*
 * Worktrees whose link to their repository broke (decisions: workspaces-and-runs, A worktree whose link broke): a `.git` file
 * naming a place that isn't there, one naming where the repository was
 * before it moved, a repository whose record of a worktree names another
 * place, and the same with relative paths. Git can't open the first ones;
 * `git worktree repair` from the main checkout puts each right, and git
 * works there again. In the runtime, the first git command that fails so in
 * a task's worktree has it repaired and runs once more, and the thread, the
 * record and the log say so; at startup every worktree it keeps is looked at.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    .toString()
    .trim()

/** What git says in a folder, and whether it worked. */
const tried = (cwd: string, ...args: Array<string>) => {
  const ran = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return { ok: ran.status === 0, stderr: ran.stderr.trim(), stdout: ran.stdout.trim() }
}

/** A repository with a commit, in a folder of its own, and `names` worktrees beside it. */
const fixture = (names: ReadonlyArray<string>, relative = false) => {
  const at = mkdtempSync(join(tmpdir(), 'althar-links-'))
  const main = join(at, 'main')
  execFileSync('git', ['init', '-q', '-b', 'main', main])
  git(main, 'commit', '-q', '--allow-empty', '-m', 'init')
  for (const name of names)
    git(main, ...(relative ? ['-c', 'worktree.useRelativePaths=true'] : []), 'worktree', 'add', '-q', join(at, name), '-b', name)
  return { at, main }
}

/** Whether this git writes relative worktree paths (2.48 and later). */
const relativeWorktrees = (() => {
  const [major = 0, minor = 0] = (/(\d+)\.(\d+)/.exec(execFileSync('git', ['--version']).toString()) ?? []).slice(1).map(Number)
  return major > 2 || (major === 2 && minor >= 48)
})()

const repaired = (main: string, folder: string) => Effect.runPromise(repairWorktree(main, folder))

/**
 * Rewrites a link file as a move would leave it. Git for Windows hides a worktree's `.git`, and Windows won't let
 * a hidden file be opened to be replaced, so it goes first.
 */
const relink = (file: string, text: string) => {
  rmSync(file, { force: true })
  writeFileSync(file, text)
}

/** A path as git writes it into a link: with forward slashes, on Windows too. */
const asGitWrites = (path: string) => path.replaceAll('\\', '/')

describe('a worktree whose link broke', () => {
  it('says no secret a folder, a repository or a branch is named with', () => {
    const token = 'ghp_' + 'abcdefghijklmnopqrstuvwxyz0123456789'
    const folder = `/work/${token}/app`
    const root = `/repos/${token}`
    const branch = `althar/${token}`
    const all = [
      unrepairedWords(folder, false, root, branch, `fatal: not a git repository: ${folder}/.git`),
      unrepairedWords(folder, true, root, null, 'fatal: nope'),
      takenWords(folder, false, root, branch, { folder: `/old/${token}/app` }),
      takenWords(folder, false, root, branch, { branch: `other/${token}` }),
    ]
    for (const words of all) {
      const text = `${words.title} ${words.description}`
      assert.notInclude(text, token)
      assert.include(text, '[redacted]')
    }
  })

  it('is told by git’s own fatal or error line, not by a host’s or a hook’s that says the same', () => {
    assert.isTrue(linkBroke('fatal: gitfile does not point to a valid repository: /x/.git\n'))
    assert.isTrue(linkBroke('warning: something\nfatal: not a git repository: /x/.git/worktrees/y\n'))
    assert.isFalse(linkBroke('remote: fatal: not a git repository\nfatal: the remote end hung up unexpectedly\n'))
    assert.isFalse(linkBroke('pre-commit: not a git repository, skipping\n'))
  })

  it('whose .git names a place that isn’t there: git fails before, and works after the repair', async () => {
    const { at, main } = fixture(['bogus'])
    const folder = join(at, 'bogus')
    relink(join(folder, '.git'), 'gitdir: /nowhere/althar/worktrees/orchy/.git/worktrees/bogus\n')
    const before = tried(folder, 'rev-parse', 'HEAD')
    assert.isFalse(before.ok)
    assert.isTrue(linkBroke(before.stderr))
    assert.match(before.stderr, /gitfile does not point to a valid repository/)
    assert.deepInclude(linkOf(folder), { state: 'broken', why: 'gitdir' })
    await repaired(main, folder)
    assert.deepStrictEqual(linkOf(folder), { state: 'fine' })
    assert.strictEqual(tried(folder, 'rev-parse', '--abbrev-ref', 'HEAD').stdout, 'bogus')
  })

  it('whose repository moved, so its .git names a git directory that no longer exists', async () => {
    const { at, main } = fixture(['moved'])
    const folder = join(at, 'moved')
    const now = join(at, 'main-now')
    renameSync(main, now)
    assert.isFalse(tried(folder, 'status').ok)
    assert.deepInclude(linkOf(folder), { state: 'broken', why: 'gitdir' })
    const said = await repaired(now, folder)
    assert.match(said, /repair/)
    assert.deepStrictEqual(linkOf(folder), { state: 'fine' })
    assert.isTrue(tried(folder, 'status').ok)
    assert.include(readFileSync(join(folder, '.git'), 'utf8'), asGitWrites(now))
  })

  it('whose repository’s record names another place, which git would prune', async () => {
    const { at, main } = fixture(['elsewhere'])
    const folder = join(at, 'elsewhere')
    relink(join(main, '.git', 'worktrees', 'elsewhere', 'gitdir'), `${join(at, 'gone', 'elsewhere', '.git')}\n`)
    assert.include(tried(main, 'worktree', 'list').stdout, 'prunable')
    assert.deepInclude(linkOf(folder), { state: 'broken', why: 'back_link' })
    await repaired(main, folder)
    assert.deepStrictEqual(linkOf(folder), { state: 'fine' })
    assert.notInclude(tried(main, 'worktree', 'list').stdout, 'prunable')
  })

  it.skipIf(!relativeWorktrees)('made with relative paths, moved on its own', async () => {
    const { at, main } = fixture(['relative'], true)
    const folder = join(at, 'relative')
    assert.notInclude(readFileSync(join(folder, '.git'), 'utf8'), asGitWrites(at))
    assert.deepStrictEqual(linkOf(folder), { state: 'fine' })
    mkdirSync(join(at, 'deeper'))
    const now = join(at, 'deeper', 'relative')
    renameSync(folder, now)
    assert.isFalse(tried(now, 'status').ok)
    assert.deepInclude(linkOf(now), { state: 'broken', why: 'gitdir' })
    await repaired(main, now)
    assert.deepStrictEqual(linkOf(now), { state: 'fine' })
    assert.isTrue(tried(now, 'status').ok)
  })

  it('is left as it is where git can’t repair it, and says why', async () => {
    const { at, main } = fixture(['lost'])
    const folder = join(at, 'lost')
    rmSync(join(main, '.git', 'worktrees', 'lost'), { recursive: true })
    const before = readFileSync(join(folder, '.git'), 'utf8')
    const failed = await Effect.runPromise(Effect.flip(repairWorktree(main, folder)))
    assert.match(failed.message, /^git worktree: unable to locate repository/)
    assert.strictEqual(readFileSync(join(folder, '.git'), 'utf8'), before)
  })

  it('whose .git names another live worktree’s record: git’s own repair would take that record from it', async () => {
    const { at, main } = fixture(['a', 'd'])
    const [a, d] = [join(at, 'a'), join(at, 'd')]
    // As a prune leaves it: a's record gone, and its .git naming the record another worktree has now.
    rmSync(join(main, '.git', 'worktrees', 'a'), { recursive: true })
    relink(join(a, '.git'), `gitdir: ${join(main, '.git', 'worktrees', 'd')}\n`)
    assert.deepInclude(linkOf(a), { state: 'broken', why: 'back_link' })
    assert.deepStrictEqual(linkOf(d), { state: 'fine' })
    await repaired(main, a)
    assert.deepStrictEqual(linkOf(a), { state: 'fine' })
    assert.notDeepEqual(linkOf(d), { state: 'fine' })
  })

  it('is another’s to repair where the record it would be joined to names a worktree that is there', () => {
    const { at, main } = fixture(['a', 'd'])
    const [a, d] = [join(at, 'a'), join(at, 'd')]
    rmSync(join(main, '.git', 'worktrees', 'a'), { recursive: true })
    const records = join(main, '.git', 'worktrees')
    const before = readFileSync(join(records, 'd', 'gitdir'), 'utf8')
    // Its .git naming the other's record where it is, or, from before the repository moved, by its name.
    for (const named of [join(records, 'd'), '/nowhere/old-profile/.git/worktrees/d']) {
      relink(join(a, '.git'), `gitdir: ${named}\n`)
      assert.deepStrictEqual(takenFrom(a, linkOf(a), main, 'a'), { folder: d })
    }
    assert.strictEqual(readFileSync(join(records, 'd', 'gitdir'), 'utf8'), before)
    assert.deepStrictEqual(linkOf(d), { state: 'fine' })
  })

  it('is another’s to repair where the record names a detached copy whose folder is there without its .git', async () => {
    const at = mkdtempSync(join(tmpdir(), 'althar-links-'))
    const main = join(at, 'main')
    execFileSync('git', ['init', '-q', '-b', 'main', main])
    git(main, 'commit', '-q', '--allow-empty', '-m', 'init')
    const [a, d] = [join(at, 'a'), join(at, 'd')]
    for (const copy of [a, d]) git(main, 'worktree', 'add', '-q', '--detach', copy)
    const records = join(main, '.git', 'worktrees')
    rmSync(join(records, 'a'), { recursive: true })
    rmSync(join(d, '.git'))
    relink(join(a, '.git'), `gitdir: ${join(records, 'd')}\n`)
    const before = readFileSync(join(records, 'd', 'gitdir'), 'utf8')
    // Detached, the record names no branch to tell it by: its folder being there is what says it is another's.
    assert.deepStrictEqual(takenFrom(a, linkOf(a), main, false), { folder: d })
    // Git's own repair would take it.
    await repaired(main, a)
    assert.notStrictEqual(readFileSync(join(records, 'd', 'gitdir'), 'utf8'), before)
  })

  it('is another’s to repair where that record is on another branch, though its folder is gone', () => {
    const { at, main } = fixture(['a', 'e'])
    const a = join(at, 'a')
    rmSync(join(main, '.git', 'worktrees', 'a'), { recursive: true })
    rmSync(join(at, 'e'), { recursive: true })
    relink(join(a, '.git'), 'gitdir: /nowhere/old-profile/.git/worktrees/e\n')
    assert.deepStrictEqual(takenFrom(a, linkOf(a), main, 'a'), { branch: 'e' })
    // A review's copy is never on a branch.
    assert.deepStrictEqual(takenFrom(a, linkOf(a), main, false), { branch: 'e' })
    assert.isNull(takenFrom(a, linkOf(a), main, 'e'))
  })

  it('is its own to repair where the repository’s record of it names it, whatever its .git names', () => {
    const { at, main } = fixture(['a', 'd'])
    const a = join(at, 'a')
    relink(join(a, '.git'), 'gitdir: /nowhere/old-profile/.git/worktrees/d\n')
    assert.isNull(takenFrom(a, linkOf(a), main, 'a'))
  })

  it('isn’t one where its folder isn’t there, or where it is a repository’s own checkout', () => {
    const { at, main } = fixture([])
    assert.deepStrictEqual(linkOf(join(at, 'nothing')), { state: 'missing' })
    assert.deepStrictEqual(linkOf(main), { state: 'not_linked' })
  })
})

const withRepair = () => Queries.layer.pipe(Layer.provideMerge(runtime()))

/** Tasks in a new repository, each with its worktree. */
const tasks = (titles: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const sql = yield* SqlClient.SqlClient
    const root = repository()
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: root })
    const made: Array<{ root: string; taskId: string; threadId: string; workspaceId: string; worktree: string }> = []
    for (const title of titles) {
      const task = yield* projects.createTask({ envelope: yield* Runtime.envelope('task.create', {}), projectId: project.projectId, title })
      const [workspace] = yield* sql<{ id: string; path: string }>`SELECT id, path FROM workspaces WHERE task_id = ${task.taskId}`
      made.push({ root, taskId: task.taskId, threadId: task.threadId, workspaceId: workspace?.id ?? '', worktree: workspace?.path ?? '' })
    }
    return made
  })

/** A task in a new repository, with its worktree. */
const aTask = Effect.map(tasks(['Fix the login']), ([task]) => task!)

const folderLines = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{
      content: string
    }>`SELECT content FROM thread_items WHERE thread_id = ${threadId} AND kind = 'notice' ORDER BY sequence`
    return rows
      .map((row) => JSON.parse(row.content) as { title: string; severity: string; description: string | null; role?: string })
      .filter((notice) => /link to the repository|link repaired|is linked to another/.test(notice.title))
  })

const factsOf = (workspaceId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ type: string; payload: string }>`
      SELECT type, payload FROM record_events WHERE aggregate_id = ${workspaceId} AND type LIKE 'workspace.repair%' ORDER BY rowid`
    return rows.map((row) => ({ type: row.type, payload: JSON.parse(row.payload) as Record<string, unknown> }))
  })

describe('a task’s worktree whose link broke, in the runtime', () => {
  it.live('is repaired the first time git fails in it, and the command runs again', () =>
    Effect.gen(function* () {
      const task = yield* aTask
      const head = git(task.worktree, 'rev-parse', 'HEAD')
      relink(join(task.worktree, '.git'), 'gitdir: /nowhere/flatpak/althar/worktrees/orchy/.git/worktrees/x\n')
      assert.isFalse(tried(task.worktree, 'rev-parse', 'HEAD').ok)
      assert.strictEqual(yield* runtimeGit(task.worktree, 'rev-parse', 'HEAD'), head)
      assert.deepStrictEqual(linkOf(task.worktree), { state: 'fine' })
      const [line] = yield* folderLines(task.threadId)
      assert.strictEqual(line?.title, 'Folder link repaired')
      assert.strictEqual(line?.severity, 'info')
      assert.strictEqual(line?.role, 'folder')
      const [recorded] = yield* factsOf(task.workspaceId)
      assert.strictEqual(recorded?.type, 'workspace.repaired')
      assert.deepInclude(recorded?.payload, { folder: task.worktree, copy: false, why: 'gitdir' })
    }).pipe(Effect.provide(withRepair())),
  )

  it.live('repairs, and records, its repository’s other broken worktrees with it, as git repairs them together', () =>
    Effect.gen(function* () {
      const [first, second] = yield* tasks(['Fix the login', 'Fix the logout'])
      for (const task of [first!, second!]) relink(join(task.worktree, '.git'), 'gitdir: /nowhere/old-profile/.git/worktrees/x\n')
      yield* runtimeGit(first!.worktree, 'status')
      assert.isTrue(tried(second!.worktree, 'status').ok)
      for (const task of [first!, second!]) {
        assert.deepStrictEqual(
          (yield* folderLines(task.threadId)).map((line) => line.title),
          ['Folder link repaired'],
        )
        assert.strictEqual((yield* factsOf(task.workspaceId))[0]?.type, 'workspace.repaired')
      }
    }).pipe(Effect.provide(withRepair())),
  )

  it.live('leaves alone, and runs nothing again for, a folder that isn’t there, isn’t broken or isn’t Althar’s', () =>
    Effect.gen(function* () {
      const task = yield* aTask
      const repair = yield* WorktreeRepair
      assert.isFalse(yield* repair.mend(join(tmpdir(), 'althar-nowhere', 'at-all')))
      assert.isFalse(yield* repair.mend(task.worktree))
      const stranger = mkdtempSync(join(tmpdir(), 'althar-stranger-'))
      writeFileSync(join(stranger, '.git'), 'gitdir: /nowhere/old/.git/worktrees/x\n')
      assert.isFalse(yield* repair.mend(stranger))
      assert.deepStrictEqual(linkOf(stranger), { state: 'broken', why: 'gitdir', gitdir: '/nowhere/old/.git/worktrees/x' })
      // Repaired since the command began: it runs again.
      relink(join(task.worktree, '.git'), 'gitdir: /nowhere/old-profile/.git/worktrees/x\n')
      assert.isTrue(yield* repair.mend(task.worktree, 0))
      assert.isTrue(yield* repair.mend(task.worktree, 0))
      assert.isFalse(yield* repair.mend(task.worktree, Number.MAX_SAFE_INTEGER))
    }).pipe(Effect.provide(withRepair())),
  )

  it.live('is looked at with the copy its reviews read, as at startup, and repaired', () =>
    Effect.gen(function* () {
      const task = yield* aTask
      const copy = reviewCopyOf(task.worktree)
      git(task.worktree, 'worktree', 'add', '-q', '--detach', copy)
      // The worktree's record in the repository names another place; the copy's .git names one that isn't there.
      const name = readFileSync(join(task.worktree, '.git'), 'utf8').trim().split('/').at(-1) ?? ''
      relink(join(task.root, '.git', 'worktrees', name, 'gitdir'), '/nowhere/else/.git\n')
      relink(join(copy, '.git'), 'gitdir: /nowhere/review/.git/worktrees/copy\n')
      const done = yield* (yield* WorktreeRepair).sweep
      assert.deepStrictEqual(
        done.map((one) => [one.copy, one.why, one.repaired]),
        [
          [false, 'back_link', true],
          [true, 'gitdir', true],
        ],
      )
      assert.deepStrictEqual(linkOf(task.worktree), { state: 'fine' })
      assert.deepStrictEqual(linkOf(copy), { state: 'fine' })
      assert.isTrue(tried(copy, 'status').ok)
      // One line for the two, said once.
      assert.deepStrictEqual(
        (yield* folderLines(task.threadId)).map((line) => [line.title, line.role]),
        [['Folder link repaired, and its review copy’s', 'folder']],
      )
      // Nothing more to repair the next time.
      assert.deepStrictEqual(yield* (yield* WorktreeRepair).sweep, [])
    }).pipe(Effect.provide(withRepair())),
  )

  it.live('where git can’t repair it, stays as it is, and git’s words reach the thread and the failure', () =>
    Effect.gen(function* () {
      const task = yield* aTask
      const name = readFileSync(join(task.worktree, '.git'), 'utf8').trim().split('/').at(-1) ?? ''
      rmSync(join(task.root, '.git', 'worktrees', name), { recursive: true })
      const before = readFileSync(join(task.worktree, '.git'), 'utf8')
      const failed = yield* Effect.flip(runtimeGit(task.worktree, 'rev-parse', 'HEAD'))
      assert.match(failed.message, /^git rev-parse: gitfile does not point to a valid repository/)
      assert.strictEqual(readFileSync(join(task.worktree, '.git'), 'utf8'), before)
      assert.isTrue(existsSync(task.worktree))
      const [line] = yield* folderLines(task.threadId)
      // The fact and the way out in the person's words, git's line after them, without its subcommand.
      assert.strictEqual(line?.title, 'This task’s folder lost its link to the repository, and Althar couldn’t restore it.')
      assert.match(line?.description ?? '', /^Its commits are safe on its branch, .+, and the folder is left as it is/)
      assert.match(
        line?.description ?? '',
        /move the folder aside and add it back with git worktree add .+ Git said: unable to locate repository/,
      )
      assert.notInclude(line?.description ?? '', 'git worktree:')
      // A warning of Althar's in the thread, not a line across it as a repaired folder is.
      assert.strictEqual(line?.severity, 'warning')
      assert.isUndefined(line?.role)
      assert.strictEqual((yield* factsOf(task.workspaceId))[0]?.type, 'workspace.repair_failed')
      // Not tried again on the next command that fails there.
      yield* Effect.flip(runtimeGit(task.worktree, 'status'))
      assert.lengthOf(yield* folderLines(task.threadId), 1)
    }).pipe(Effect.provide(withRepair())),
  )

  it.live('isn’t joined to another task’s record that a prune freed its name for, and that task’s folder is left as it was', () =>
    Effect.gen(function* () {
      const [moved, live] = yield* tasks(['Fix the login', 'Fix the logout'])
      const nameOf = (task: { worktree: string }) => readFileSync(join(task.worktree, '.git'), 'utf8').trim().split('/').at(-1) ?? ''
      const records = join(moved!.root, '.git', 'worktrees')
      rmSync(join(records, nameOf(moved!)), { recursive: true })
      const other = join(records, nameOf(live!))
      relink(join(moved!.worktree, '.git'), `gitdir: /nowhere/old-profile/.git/worktrees/${nameOf(live!)}\n`)
      const before = [readFileSync(join(other, 'gitdir'), 'utf8'), readFileSync(join(moved!.worktree, '.git'), 'utf8')]
      yield* Effect.flip(runtimeGit(moved!.worktree, 'status'))
      assert.deepStrictEqual([readFileSync(join(other, 'gitdir'), 'utf8'), readFileSync(join(moved!.worktree, '.git'), 'utf8')], before)
      assert.deepStrictEqual(linkOf(live!.worktree), { state: 'fine' })
      assert.isTrue(tried(live!.worktree, 'status').ok)
      const [line] = yield* folderLines(moved!.threadId)
      assert.match(line?.title ?? '', /^This task’s folder is linked to another copy, at .+, so Althar left both as they are\.$/)
      assert.strictEqual(line?.description, 'If that copy is from an old profile, remove it and restart Althar.')
      assert.strictEqual(line?.severity, 'warning')
      assert.strictEqual((yield* factsOf(moved!.workspaceId))[0]?.type, 'workspace.repair_failed')
      assert.lengthOf(yield* folderLines(live!.threadId), 0)
    }).pipe(Effect.provide(withRepair())),
  )

  it.live('leaves one whose .git names another live task’s record as it is, at startup too', () =>
    Effect.gen(function* () {
      const [moved, live] = yield* tasks(['Fix the login', 'Fix the logout'])
      const nameOf = (task: { worktree: string }) => readFileSync(join(task.worktree, '.git'), 'utf8').trim().split('/').at(-1) ?? ''
      const records = join(moved!.root, '.git', 'worktrees')
      rmSync(join(records, nameOf(moved!)), { recursive: true })
      const other = join(records, nameOf(live!))
      relink(join(moved!.worktree, '.git'), `gitdir: ${other}\n`)
      const before = readFileSync(join(other, 'gitdir'), 'utf8')
      const done = yield* (yield* WorktreeRepair).sweep
      assert.deepStrictEqual(
        done.map((one) => [one.folder, one.why, one.repaired]),
        [[moved!.worktree, 'back_link', false]],
      )
      assert.strictEqual(readFileSync(join(other, 'gitdir'), 'utf8'), before)
      assert.deepStrictEqual(linkOf(live!.worktree), { state: 'fine' })
      // Not looked at again.
      assert.deepStrictEqual(yield* (yield* WorktreeRepair).sweep, [])
    }).pipe(Effect.provide(withRepair())),
  )

  it.live('where git can’t repair it, says so once, not again at each start', () =>
    Effect.gen(function* () {
      const task = yield* aTask
      const name = readFileSync(join(task.worktree, '.git'), 'utf8').trim().split('/').at(-1) ?? ''
      rmSync(join(task.root, '.git', 'worktrees', name), { recursive: true })
      // Each start is a new service over the same record.
      const started = Effect.gen(function* () {
        return yield* (yield* WorktreeRepair).sweep
      }).pipe(Effect.provide(Layer.fresh(WorktreeRepair.layer)))
      const warned: Array<string> = []
      const logger = Logger.make(({ logLevel, message }) => {
        if (logLevel === 'Warn') warned.push(String(Array.isArray(message) ? message[0] : message))
      })
      // Its own sweep as it starts looks first: what this one is handed may be nothing.
      for (let start = 0; start < 3; start++) yield* started.pipe(Effect.provide(Logger.layer([logger])))
      assert.lengthOf(yield* folderLines(task.threadId), 1)
      // Nor warned of in the log again.
      assert.deepStrictEqual(
        warned.filter((line) => /repair a worktree/.test(line)),
        ['Could not repair a worktree’s link to its repository'],
      )
      assert.deepStrictEqual(
        (yield* factsOf(task.workspaceId)).map((one) => one.type),
        ['workspace.repair_failed'],
      )
    }).pipe(Effect.provide(withRepair())),
  )
})
