import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Coordinator } from '../src/Coordinator'
import { coordinatorNews, modelNamer } from '../src/coordinatorNews'
import { CantMerge, NoChangeToOpen } from '../src/errors'
import { branchOnFirstWrite, scratchOf } from '../src/firstWrite'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { findTasks } from '../src/Search'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, notices, repository, runtime, until } from './support'

/*
 * A plain task (DEV-96, ADR-035): what the coordinator starts with
 * start_task works in a worktree with no branch, set up as any task's, with
 * a scratch folder git ignores. Where its lead first changes the repository,
 * as its turn ends or as it calls finish_step, Althar makes the task's branch
 * right there, with that work on it, and the task is a change from then: in
 * the same folder, with the same lead.
 */

const withQueries = (database?: string) => Queries.layer.pipe(Layer.provideMerge(runtime(database)))

/** A project of a fresh repository, and its coordinator's thread. */
const opened = Effect.gen(function* () {
  const projects = yield* Projects
  const coordinator = yield* Coordinator
  const path = repository()
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
  return { path, projectId: project.projectId, threadId: yield* coordinator.thread(project.projectId) }
})

/** Starts a task as the coordinator does with start_task, its lead told what `description` says: the task, as the store has it. */
const started = (place: { readonly projectId: string; readonly threadId: string }, title: string, description: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const access: ToolAccess = { role: 'coordinator', ...place, sessionId: 'none', taskId: null }
    assert.match(yield* callTool(access, 'start_task', { title, description, lead: { agent: 'claude-code' } }), /^Started /)
    const [task] = yield* sql<{ id: string; slug: string; threadId: string }>`
      SELECT k.id, k.slug, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
      WHERE k.project_id = ${place.projectId} AND k.title = ${title}`
    return task ?? assert.fail('no task')
  })

/** The task's one worktree, as the store has it. */
const worktreeOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [workspace] = yield* sql<{ path: string; branch: string; branchedAt: string | null; baseCommit: string; state: string }>`
      SELECT path, branch, branched_at, base_commit, state FROM workspaces WHERE task_id = ${taskId}`
    return workspace ?? assert.fail('no worktree')
  })

/** Git in a folder, as the person would run it; null where it fails. */
const gitIn = (cwd: string, ...args: ReadonlyArray<string>) => {
  try {
    return execFileSync('git', [...args], { cwd, stdio: 'pipe' })
      .toString()
      .trim()
  } catch {
    return null
  }
}

/** The task's card once `check` holds of it. */
const cardOnce = (taskId: string, check: (card: { readonly phase: string; readonly kind: string }) => boolean, limit = 20) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const [card] = yield* until(
      Effect.map(queries.card(taskId), (one) => [one]),
      ([one]) => one !== undefined && check(one),
      Duration.seconds(limit),
    )
    return card ?? assert.fail('no card')
  })

/** Waits until the task's worktree has its branch, or doesn't, as `branched` says. */
const branchedOnce = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* until(
      sql<{ branchedAt: string | null }>`SELECT branched_at FROM workspaces WHERE task_id = ${taskId}`,
      (rows) => rows[0]?.branchedAt != null,
      Duration.seconds(20),
    )
    return yield* worktreeOf(taskId)
  })

/** What the person says to a task's lead. */
const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { threadId, body }), threadId, body })
  })

describe('a plain task', () => {
  it.live('starts with no branch, set up as any task, and a lead that changed nothing finishes with only its summary', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const queries = yield* Queries
      const runs = yield* Runs
      const changes = yield* Changes
      const place = yield* opened
      const task = yield* started(place, 'Which partners still call v1?', 'Look, and say. [lead:finish] [lead:terse]')
      const card = yield* cardOnce(task.id, (one) => one.phase === 'ready')
      // Finished, plain, and showing no branch: it never had one.
      assert.deepInclude(card, { kind: 'plain', branch: null, summary: 'Did the task.' })
      const worktree = yield* worktreeOf(task.id)
      assert.isNull(worktree.branchedAt)
      assert.strictEqual(worktree.branch, `althar/${task.slug}`)
      assert.isNull(gitIn(worktree.path, 'symbolic-ref', '-q', 'HEAD'))
      assert.isNull(gitIn(place.path, 'rev-parse', '--verify', '-q', `refs/heads/${worktree.branch}`))
      assert.strictEqual(gitIn(worktree.path, 'rev-parse', 'HEAD'), worktree.baseCommit)
      // Set up as any worktree is, so the project's tools work for its lead; its scratch folder is there, and git sees nothing.
      const [setUp] = yield* sql<{ setup: string | null }>`SELECT setup FROM workspaces WHERE task_id = ${task.id}`
      assert.isNotNull(setUp?.setup)
      assert.isTrue(existsSync(join(scratchOf(worktree.path), '.gitignore')))
      assert.strictEqual(gitIn(worktree.path, 'status', '--porcelain', '--untracked-files=all'), '')
      // Its lead was told it has no branch, where to throw things away, and that writing in the repository makes one.
      const [first] = yield* sql<{ prompt: string | null }>`
        SELECT prompt FROM turn_deliveries WHERE thread_id = ${task.threadId} ORDER BY requested_at LIMIT 1`
      assert.include(first?.prompt, `${worktree.path}, with no branch yet, at main at ${worktree.baseCommit.slice(0, 12)}`)
      assert.include(first?.prompt, `its scratch folder, ${scratchOf(worktree.path)}`)
      assert.include(first?.prompt, `a change on a branch of its own, ${worktree.branch}`)
      assert.notInclude(first?.prompt, `The branch ${worktree.branch}`)
      // Its report has no word of what it built, and needn't.
      const [report] = yield* sql<{ content: string }>`
        SELECT content FROM thread_items WHERE thread_id = ${task.threadId} AND kind = 'step_result'`
      assert.notProperty(JSON.parse(report?.content ?? '{}'), 'built')
      // Nothing says it ends on a branch: it has none.
      assert.notInclude((yield* notices(task.threadId)).map((notice) => notice.title).join('\n'), 'branch')
      // Its screen shows no branch, nothing changed and nothing to merge; the board nothing of a size.
      const thread = yield* queries.thread(task.threadId, {})
      assert.deepInclude(thread.task, { branch: null, files: [], commits: 0, here: [] })
      assert.isNotNull(thread.task.worktree)
      assert.isNull((yield* queries.board(place.projectId)).tasks.find((one) => one.taskId === task.id)?.changed)
      // There is nothing to open a pull request for, to merge here or to push.
      const refused = yield* Effect.flip(runs.publish(task.id))
      assert.instanceOf(refused, NoChangeToOpen)
      assert.strictEqual((refused as NoChangeToOpen).why, 'nothing')
      const merging = yield* Effect.flip(changes.mergeHere(task.id, [{ repository: 'x', head: worktree.baseCommit }]))
      assert.instanceOf(merging, CantMerge)
      assert.strictEqual((merging as CantMerge).why, 'changed')
      assert.include(yield* Effect.flip(changes.pushBranch(task.id, [])), { _tag: 'NotFound' })
      assert.deepStrictEqual(yield* changes.pushHere(task.id), [])
      const [run] = yield* sql<{ id: string }>`SELECT id FROM runs WHERE task_id = ${task.id}`
      const published = yield* changes.publish({
        projectId: place.projectId as ProjectId,
        taskId: task.id,
        runId: run?.id ?? '',
        end: 'draft',
      })
      assert.deepStrictEqual(
        published.map((one) => [one.kind, one.left]),
        [['nothing', []]],
      )
      // The coordinator reads it as a task with no branch.
      const access: ToolAccess = { role: 'coordinator', ...place, sessionId: 'none', taskId: null }
      assert.include(
        yield* callTool(access, 'list_tasks', {}),
        `${task.slug}: Which partners still call v1? (ready, led by Fake claude-code) — no branch`,
      )
      assert.include(
        yield* callTool(access, 'read_task', { task: task.slug }),
        'No branch yet: its lead has changed nothing in the repository',
      )
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('stays plain for what its lead throws away and the pictures it hands back', () =>
    Effect.gen(function* () {
      const place = yield* opened
      const task = yield* started(place, 'Sketch the empty state', 'Sketch it. [lead:sketch] [lead:evidence] [lead:finish] [lead:terse]')
      const card = yield* cardOnce(task.id, (one) => one.phase === 'ready')
      assert.strictEqual(card.kind, 'plain')
      assert.deepStrictEqual(
        card.handed?.pictures.map((picture) => picture.name),
        ['retry.png'],
      )
      const worktree = yield* worktreeOf(task.id)
      assert.isNull(worktree.branchedAt)
      assert.strictEqual(readFileSync(join(scratchOf(worktree.path), 'sketch.html'), 'utf8'), '<p>A sketch.</p>\n')
      assert.isNull(gitIn(worktree.path, 'symbolic-ref', '-q', 'HEAD'))
    }).pipe(Effect.provide(withQueries())),
  )

  it.live(
    'becomes a change on its branch as its lead first writes, in the same folder with the same lead, and the coordinator hears so',
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const queries = yield* Queries
        const coordinator = yield* Coordinator
        const place = yield* opened
        // The coordinator starts it, as the person asked: it hears what became of it at its next turn.
        yield* coordinator.say({
          envelope: yield* Runtime.envelope('thread.send', {}),
          threadId: place.threadId,
          body: 'Try a first draft. [coordinator:start] [lead:write] [lead:finish]',
          disposition: 'after_current',
        })
        const [task] = yield* until(
          sql<{ id: string; slug: string; threadId: string }>`
          SELECT k.id, k.slug, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'`,
          (rows) => rows.length === 1,
        )
        if (task === undefined) return assert.fail('no task')
        const card = yield* cardOnce(task.id, (one) => one.phase === 'ready')
        const worktree = yield* worktreeOf(task.id)
        // Its branch, where its worktree was, with what the lead wrote still there, not committed: a change, though it has no commits.
        assert.isNotNull(worktree.branchedAt)
        assert.strictEqual(gitIn(worktree.path, 'symbolic-ref', '--short', 'HEAD'), worktree.branch)
        assert.strictEqual(gitIn(worktree.path, 'rev-parse', 'HEAD'), worktree.baseCommit)
        assert.strictEqual(gitIn(worktree.path, 'status', '--porcelain'), '?? draft.md')
        assert.deepInclude(card, { kind: 'change', branch: worktree.branch })
        assert.deepInclude((yield* queries.board(place.projectId)).tasks.find((one) => one.taskId === task.id)?.changed, { files: 1 })
        // Said in its thread, and recorded.
        assert.include(
          (yield* notices(task.threadId)).map((notice) => notice.title),
          `This task changes files now, on its branch ${worktree.branch}.`,
        )
        const [fact] = yield* sql<{ payload: string }>`SELECT payload FROM record_events WHERE type = 'workspace.branched'`
        assert.deepStrictEqual(JSON.parse(fact?.payload ?? '{}'), { from: null, to: worktree.branch })
        // The same lead, in the same folder: no other session took it over.
        const leads = yield* sql<{ id: string }>`SELECT id FROM provider_sessions WHERE thread_id = ${task.threadId}`
        assert.lengthOf(leads, 1)
        // Found by its branch now.
        const found = yield* findTasks({ projectId: place.projectId, text: worktree.branch.split('/').at(-1) ?? '' }, new Set())
        assert.include(
          found.map((one) => one.taskId),
          task.id,
        )
        // The coordinator hears it at its next turn, and can retitle it.
        const news = (yield* coordinatorNews(place.threadId, place.projectId, yield* modelNamer)) ?? ''
        assert.include(
          news,
          `- ${task.slug} (Try a first draft): its lead started changing the repository, so it is a change now, on its branch ${worktree.branch}. If its title no longer says what it does, rename it with rename_task`,
        )
        const access: ToolAccess = { role: 'coordinator', ...place, sessionId: 'none', taskId: null }
        assert.match(yield* callTool(access, 'rename_task', { task_id: task.slug, title: 'Draft the welcome page' }), /^Renamed /)
        assert.strictEqual((yield* cardOnce(task.id, () => true)).title, 'Draft the welcome page')
        assert.include(
          (yield* findTasks({ projectId: place.projectId, text: 'welcome' }, new Set())).map((one) => one.taskId),
          task.id,
        )
        assert.include(yield* callTool(access, 'read_task', { task: task.slug }), `Branch ${worktree.branch}, in ${worktree.path}.`)
      }).pipe(Effect.provide(withQueries())),
  )

  it.live('becomes a change as a turn that committed on its worktree ends, with that commit on its branch', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const place = yield* opened
      const task = yield* started(place, 'Bump the version', 'Bump it. [lead:commit]')
      const worktree = yield* branchedOnce(task.id)
      assert.strictEqual(gitIn(worktree.path, 'symbolic-ref', '--short', 'HEAD'), worktree.branch)
      assert.strictEqual(gitIn(worktree.path, 'log', '-1', '--format=%s', worktree.branch), 'Change it')
      assert.strictEqual(gitIn(worktree.path, 'rev-parse', `${worktree.branch}^`), worktree.baseCommit)
      assert.strictEqual(gitIn(worktree.path, 'status', '--porcelain'), '')
      assert.strictEqual((yield* cardOnce(task.id, () => true)).kind, 'change')
      yield* sessions.stop(task.threadId)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live(
    'done, goes back to work as a follow-up in the same folder: one that writes nothing stays plain, one that writes branches it',
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const tasks = yield* Tasks
        const sessions = yield* Sessions
        const place = yield* opened
        const task = yield* started(place, 'Check the partners', 'Look. [lead:finish] [lead:terse]')
        yield* cardOnce(task.id, (one) => one.phase === 'ready')
        yield* tasks.see({ taskId: task.id, finished: true })
        const state = Effect.map(sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${task.id}`, (rows) => rows)
        yield* until(state, (rows) => rows[0]?.state === 'done')
        // A question: the follow-up changes nothing, and it is done again, still with no branch.
        yield* say(task.threadId, 'And the v2 ones?')
        yield* until(
          sql<{ n: number }>`SELECT count(*) AS n FROM runs WHERE task_id = ${task.id} AND plan_id IS NULL AND state <> 'running'`,
          (rows) => (rows[0]?.n ?? 0) === 1,
          Duration.seconds(20),
        )
        yield* until(state, (rows) => rows[0]?.state === 'done')
        assert.isNull((yield* worktreeOf(task.id)).branchedAt)
        // Asked to write: as its turn ends, its branch is made with what it wrote, and it is open again.
        yield* say(task.threadId, 'Write it down. [lead:write]')
        const worktree = yield* branchedOnce(task.id)
        assert.strictEqual(gitIn(worktree.path, 'symbolic-ref', '--short', 'HEAD'), worktree.branch)
        assert.strictEqual(gitIn(worktree.path, 'status', '--porcelain'), '?? draft.md')
        assert.strictEqual((yield* cardOnce(task.id, (one) => one.kind === 'change')).kind, 'change')
        yield* until(state, (rows) => rows[0]?.state === 'open')
        yield* sessions.stop(task.threadId)
      }).pipe(Effect.provide(withQueries())),
  )

  it.live('is put back with no branch where its worktree went, unless it had one by then', () =>
    Effect.gen(function* () {
      const tasks = yield* Tasks
      const place = yield* opened
      const quiet = yield* started(place, 'Look around', 'Look. [lead:finish] [lead:terse]')
      const wrote = yield* started(place, 'Write a note', 'Write. [lead:write] [lead:finish]')
      yield* cardOnce(quiet.id, (one) => one.phase === 'ready')
      yield* cardOnce(wrote.id, (one) => one.phase === 'ready')
      for (const task of [quiet, wrote]) {
        yield* tasks.abandon({ envelope: yield* Runtime.envelope('task.abandon', { task }), taskId: task.id })
        const worktree = yield* worktreeOf(task.id)
        rmSync(worktree.path, { recursive: true, force: true })
        yield* tasks.reopen({ envelope: yield* Runtime.envelope('task.reopen', { task }), taskId: task.id })
      }
      const plain = yield* worktreeOf(quiet.id)
      assert.isNull(gitIn(plain.path, 'symbolic-ref', '-q', 'HEAD'))
      assert.strictEqual(gitIn(plain.path, 'rev-parse', 'HEAD'), plain.baseCommit)
      assert.isTrue(existsSync(join(scratchOf(plain.path), '.gitignore')))
      assert.isNull(gitIn(place.path, 'rev-parse', '--verify', '-q', `refs/heads/${plain.branch}`))
      const branched = yield* worktreeOf(wrote.id)
      assert.strictEqual(gitIn(branched.path, 'symbolic-ref', '--short', 'HEAD'), branched.branch)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('made by hand with no plan, finishes with its summary alone while it has no branch', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const place = yield* opened
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: place.projectId,
        title: 'Read the logs',
        plain: true,
      })
      assert.strictEqual(created.branch, `althar/${created.slug}`)
      const lead: ToolAccess = {
        role: 'lead',
        projectId: place.projectId,
        threadId: created.threadId,
        sessionId: 'none',
        taskId: created.taskId,
      }
      assert.strictEqual(yield* callTool(lead, 'finish_step', { summary: 'Read them.' }), 'Althar has your summary.')
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('whose worktree a restart interrupted is ready once git had made it, with no branch', () =>
    Effect.gen(function* () {
      const file = join(mkdtempSync(join(tmpdir(), 'althar-plain-')), 'profile.sqlite')
      const made = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const projects = yield* Projects
        const place = yield* opened
        const created = yield* projects.createTask({
          envelope: yield* Runtime.envelope('task.create', {}),
          projectId: place.projectId,
          title: 'Read the logs',
          plain: true,
        })
        yield* sql`UPDATE workspaces SET state = 'preparing' WHERE task_id = ${created.taskId}`
        return created.taskId
      }).pipe(Effect.provide(withQueries(file)))
      const state = yield* Effect.map(worktreeOf(made), (worktree) => worktree.state).pipe(Effect.provide(withQueries(file)))
      assert.strictEqual(state, 'ready')
    }),
  )
})

describe('the coordinator renaming a task', () => {
  it.live('gives it another title, as the person can, and refuses one it can’t take', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const place = yield* opened
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: place.projectId,
        title: 'Try the double jump',
        draft: true,
      })
      const access: ToolAccess = { role: 'coordinator', ...place, sessionId: 'none', taskId: null }
      assert.match(yield* callTool(access, 'rename_task', { task_id: 'nothing', title: 'X' }), /no task nothing/)
      assert.match(yield* callTool(access, 'rename_task', { task_id: created.slug }), /couldn't read that/)
      assert.strictEqual(
        yield* callTool(access, 'rename_task', { task_id: created.slug, title: '  ' }),
        'Give it a title: what the task does, in a few words.',
      )
      assert.match(
        yield* callTool(access, 'rename_task', {
          task_id: created.slug,
          title: 'Jump twice from the hall stairs and land the second jump softly',
        }),
        /^That title is 63 characters\. Keep it to 60/,
      )
      assert.strictEqual(
        yield* callTool(access, 'rename_task', { task_id: created.taskId, title: 'Try the double jump' }),
        `${created.slug} is called that already.`,
      )
      assert.strictEqual(
        yield* callTool(access, 'rename_task', { task_id: created.slug, title: 'Add the double jump' }),
        `Renamed ${created.slug} to “Add the double jump”. Its slug and branch stay as they were; the person sees the new title on its card.`,
      )
      const queries = yield* Queries
      assert.strictEqual((yield* queries.card(created.taskId))?.title, 'Add the double jump')
    }).pipe(Effect.provide(withQueries())),
  )
})

/** A folder holding a repository for each name, opened as one project of several. */
const folderOf = (...names: ReadonlyArray<string>) => {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'althar-folder-')))
  for (const name of names) {
    const path = join(folder, name)
    mkdirSync(path)
    gitIn(path, 'init', '-q', '-b', 'main')
    writeFileSync(join(path, 'README.md'), `# ${name}\n`)
    gitIn(path, 'add', '.')
    gitIn(path, '-c', 'user.name=T', '-c', 'user.email=t@t.test', 'commit', '-q', '-m', 'Start')
  }
  return folder
}

describe('a plain task of several repositories', () => {
  it.live('gets a branch in each as its lead first writes in one, the next free name where its own is taken', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const projects = yield* Projects
      const coordinator = yield* Coordinator
      const folder = folderOf('api', 'web')
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: folder })
      const threadId = yield* coordinator.thread(project.projectId)
      // The coordinator has spoken: what follows is its news.
      yield* coordinator.say({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId,
        body: 'Hello.',
        disposition: 'after_current',
      })
      yield* until(
        sql<{ state: string }>`SELECT state FROM turn_deliveries WHERE thread_id = ${threadId}`,
        (rows) => rows.length > 0 && rows.every((row) => row.state !== 'pending' && row.state !== 'delivered'),
      )
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Try the shared header',
        repositories: ['api', 'web'],
        plain: true,
      })
      const worktrees = yield* sql<{ path: string; branch: string }>`
        SELECT w.path, w.branch FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
        WHERE w.task_id = ${created.taskId} ORDER BY b.created_at, b.rowid`
      const [api, web] = worktrees
      if (api === undefined || web === undefined) return assert.fail('no worktrees')
      // Nothing written: nothing made.
      assert.deepStrictEqual(yield* branchOnFirstWrite(created.taskId), [])
      // Its branch's name is taken in web meanwhile; its lead writes in api only.
      gitIn(join(folder, 'web'), 'branch', web.branch)
      writeFileSync(join(api.path, 'header.md'), 'A header.\n')
      const made = yield* branchOnFirstWrite(created.taskId)
      assert.deepStrictEqual(made, [api.branch, `${web.branch}-2`])
      assert.strictEqual(gitIn(web.path, 'symbolic-ref', '--short', 'HEAD'), `${web.branch}-2`)
      assert.include(
        (yield* notices(created.threadId)).map((notice) => notice.title),
        `This task changes files now, on its branches ${api.branch}, ${web.branch}-2.`,
      )
      // Once made, nothing more happens.
      assert.deepStrictEqual(yield* branchOnFirstWrite(created.taskId), [])
      const access: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, sessionId: 'none', taskId: null }
      const read = yield* callTool(access, 'read_task', { task: created.slug })
      assert.include(read, `api: branch ${api.branch}, in ${api.path}.`)
      assert.include(read, `web: branch ${web.branch}-2, in ${web.path}.`)
      const news = (yield* coordinatorNews(threadId, project.projectId, yield* modelNamer)) ?? ''
      assert.strictEqual(
        news,
        `Since you last spoke, in Althar:\n- ${created.slug} (Try the shared header): its lead started changing the repository, so it is a change now, on its branches ${api.branch}, ${web.branch}-2. If its title no longer says what it does, rename it with rename_task, keeping what the person asked in its thread.`,
      )
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('says each repository has no branch yet, and stays so where git can’t make one', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const projects = yield* Projects
      const coordinator = yield* Coordinator
      const folder = folderOf('api', 'web')
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: folder })
      const threadId = yield* coordinator.thread(project.projectId)
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Look at both',
        repositories: ['api', 'web'],
        plain: true,
      })
      const access: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, sessionId: 'none', taskId: null }
      assert.include(
        yield* callTool(access, 'read_task', { task: created.slug }),
        'api: no branch yet: its lead has changed nothing in the repository',
      )
      // A name git won't take: nothing is made, and it is tried again at the next turn's end.
      yield* sql`UPDATE workspaces SET branch = 'althar/no..dots' WHERE task_id = ${created.taskId}`
      const [worktree] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${created.taskId} LIMIT 1`
      writeFileSync(join(worktree?.path ?? '', 'notes.md'), 'Notes.\n')
      assert.deepStrictEqual(yield* branchOnFirstWrite(created.taskId), [])
      const [still] = yield* sql<{
        n: number
      }>`SELECT count(*) AS n FROM workspaces WHERE task_id = ${created.taskId} AND branched_at IS NULL`
      assert.strictEqual(still?.n, 2)
    }).pipe(Effect.provide(withQueries())),
  )
})
