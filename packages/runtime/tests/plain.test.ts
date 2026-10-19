import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { coordinatorNews, modelNamer } from '../src/coordinatorNews'
import { CantMerge, NoChangeToOpen } from '../src/errors'
import { branchOnFirstWrite, scratchOf } from '../src/firstWrite'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { findTasks } from '../src/Search'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, listTools, notices, repository, runtime, until } from './support'

/*
 * A plain task (DEV-96, ADR-035): what the coordinator starts with
 * start_task, a quick task, works in a worktree with no branch, set up as any
 * task's, with a scratch folder git ignores. Where its lead first changes the
 * repository, as its turn ends or as it calls finish_step, Althar makes the
 * task's branch right there, with that work on it, so nothing is lost: in the
 * same folder, with the same lead. The task stays plain, and the branch on
 * this Mac, until the person asks its lead to make it a change.
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
      // Its lead was told it has no branch, where to throw things away, that writing in the repository makes one on this Mac, and
      // how it becomes a change.
      const [first] = yield* sql<{ prompt: string | null }>`
        SELECT prompt FROM turn_deliveries WHERE thread_id = ${task.threadId} ORDER BY requested_at LIMIT 1`
      assert.include(first?.prompt, `${worktree.path}, with no branch yet, at main at ${worktree.baseCommit.slice(0, 12)}`)
      assert.include(first?.prompt, `its scratch folder, ${scratchOf(worktree.path)}`)
      assert.include(first?.prompt, `on a branch of its own, ${worktree.branch}, when your turn ends`)
      assert.include(first?.prompt, 'Nothing of it leaves this computer')
      assert.include(first?.prompt, 'call make_it_a_change')
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

  it.live('tells a lead whose turn on a follow-up did nothing to carry on with what it was asked, and asks no report of it', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const tasks = yield* Tasks
      const place = yield* opened
      const task = yield* started(place, 'Check the partners', 'Look. [lead:finish] [lead:terse]')
      yield* cardOnce(task.id, (one) => one.phase === 'ready')
      assert.isTrue(yield* tasks.markDone({ envelope: yield* Runtime.envelope('task.mark_done', { taskId: task.id }), taskId: task.id }))
      const state = Effect.map(sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${task.id}`, (rows) => rows)
      yield* until(state, (rows) => rows[0]?.state === 'done')
      // A question, whose first turn does nothing: told to carry on, the lead answers it, and the task is finished again.
      yield* say(task.threadId, 'And the v2 ones?')
      const [told] = yield* until(
        sql<{ body: string }>`SELECT body FROM user_inputs WHERE thread_id = ${task.threadId} AND body LIKE 'Your last turn%'`,
        (rows) => rows.length === 1,
      )
      assert.strictEqual(told?.body, 'Your last turn ended before you could do anything. Carry on with what you were last asked.')
      yield* until(
        sql<{ n: number }>`SELECT count(*) AS n FROM runs WHERE task_id = ${task.id} AND plan_id IS NULL AND state <> 'running'`,
        (rows) => (rows[0]?.n ?? 0) === 1,
        Duration.seconds(20),
      )
      // Opened again by the question, it waits for the person to settle it.
      yield* cardOnce(task.id, (one) => one.phase === 'ready')
      assert.isTrue(yield* tasks.markDone({ envelope: yield* Runtime.envelope('task.mark_done', { taskId: task.id }), taskId: task.id }))
      yield* until(state, (rows) => rows[0]?.state === 'done')
    }).pipe(
      Effect.provide(
        Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', { blank: [2] }, { idle: { blank: Duration.millis(100) } }))),
      ),
    ),
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

  it.live('puts its work on a branch of its own as its lead first writes, in the same folder with the same lead, and stays plain', () =>
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
      // Its branch, where its worktree was, with what the lead wrote still there, not committed: still plain, its branch shown.
      assert.isNotNull(worktree.branchedAt)
      assert.strictEqual(gitIn(worktree.path, 'symbolic-ref', '--short', 'HEAD'), worktree.branch)
      assert.strictEqual(gitIn(worktree.path, 'rev-parse', 'HEAD'), worktree.baseCommit)
      assert.strictEqual(gitIn(worktree.path, 'status', '--porcelain'), '?? draft.md')
      assert.deepInclude(card, { kind: 'plain', branch: worktree.branch })
      assert.deepInclude((yield* queries.board(place.projectId)).tasks.find((one) => one.taskId === task.id)?.changed, { files: 1 })
      // Said in its thread, and recorded.
      assert.deepInclude(
        (yield* notices(task.threadId)).map((notice) => [notice.title, notice.role]),
        [`This task’s work is on a branch of its own now, ${worktree.branch}, which stays on this computer.`, 'aside'],
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
      // The coordinator hears only that it started: nothing of its branch, as the task is as it was. It can still retitle it.
      const news = (yield* coordinatorNews(place.threadId, place.projectId, yield* modelNamer)) ?? ''
      assert.include(news, `- ${task.slug} (Try a first draft): It has started.`)
      assert.notInclude(news, worktree.branch)
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

  it.live('keeps what a turn committed on its worktree on its branch as the turn ends, and stays plain', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const place = yield* opened
      const task = yield* started(place, 'Bump the version', 'Bump it. [lead:commit]')
      const worktree = yield* branchedOnce(task.id)
      assert.strictEqual(gitIn(worktree.path, 'symbolic-ref', '--short', 'HEAD'), worktree.branch)
      assert.strictEqual(gitIn(worktree.path, 'log', '-1', '--format=%s', worktree.branch), 'Change it')
      assert.strictEqual(gitIn(worktree.path, 'rev-parse', `${worktree.branch}^`), worktree.baseCommit)
      assert.strictEqual(gitIn(worktree.path, 'status', '--porcelain'), '')
      assert.strictEqual((yield* cardOnce(task.id, () => true)).kind, 'plain')
      yield* sessions.stop(task.threadId)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live(
    'done, goes back to work as a follow-up in the same folder, and waits in Needs you after: one that writes nothing has no branch, one that writes has one, and both stay plain',
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const tasks = yield* Tasks
        const sessions = yield* Sessions
        const place = yield* opened
        const task = yield* started(place, 'Check the partners', 'Look. [lead:finish] [lead:terse]')
        yield* cardOnce(task.id, (one) => one.phase === 'ready')
        assert.isTrue(yield* tasks.markDone({ envelope: yield* Runtime.envelope('task.mark_done', { taskId: task.id }), taskId: task.id }))
        const state = Effect.map(sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${task.id}`, (rows) => rows)
        yield* until(state, (rows) => rows[0]?.state === 'done')
        // A question: the follow-up changes nothing, and it waits in Needs you, not settled again, still with no branch.
        yield* say(task.threadId, 'And the v2 ones?')
        yield* until(
          sql<{ n: number }>`SELECT count(*) AS n FROM runs WHERE task_id = ${task.id} AND plan_id IS NULL AND state <> 'running'`,
          (rows) => (rows[0]?.n ?? 0) === 1,
          Duration.seconds(20),
        )
        assert.strictEqual((yield* state)[0]?.state, 'open')
        assert.strictEqual((yield* cardOnce(task.id, (one) => one.phase === 'ready')).kind, 'plain')
        assert.isNull((yield* worktreeOf(task.id)).branchedAt)
        // Asked to write: as its turn ends, its branch is made with what it wrote, and it is open again.
        yield* say(task.threadId, 'Write it down. [lead:write]')
        const worktree = yield* branchedOnce(task.id)
        assert.strictEqual(gitIn(worktree.path, 'symbolic-ref', '--short', 'HEAD'), worktree.branch)
        assert.strictEqual(gitIn(worktree.path, 'status', '--porcelain'), '?? draft.md')
        yield* until(state, (rows) => rows[0]?.state === 'open')
        assert.strictEqual((yield* cardOnce(task.id, () => true)).kind, 'plain')
        yield* sessions.stop(task.threadId)
      }).pipe(Effect.provide(withQueries())),
  )

  it.live(
    'keeps what it committed on this Mac where the project is on a host: plain, Finished then Done, with no push or pull request',
    () => {
      const { working, bare } = hosted()
      const github = makeFakeService({ pushUrl: () => bare })
      github.addRepository(['meridian', 'api'])
      return Effect.gen(function* () {
        const connections = yield* Connections
        const instance = yield* Instance
        yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
        const projects = yield* Projects
        const coordinator = yield* Coordinator
        const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
        const place = { projectId: project.projectId, threadId: yield* coordinator.thread(project.projectId) }
        const task = yield* started(place, 'Sketch the settings', 'Sketch it. [lead:commit] [lead:finish]')
        // Its lead commits: its work is on its branch, and it is Finished, plain, with its branch shown.
        const card = yield* cardOnce(task.id, (one) => one.phase === 'ready')
        const worktree = yield* worktreeOf(task.id)
        assert.isNotNull(worktree.branchedAt)
        assert.deepStrictEqual([card.kind, card.change, card.branch], ['plain', null, worktree.branch])
        assert.deepStrictEqual([...(yield* (yield* Queries).kept)], [])
        // Nothing went to the host: no push, no pull request, and nothing in its thread says it ends on its branch.
        assert.lengthOf(github.changes, 0)
        assert.isNull(gitIn(bare, 'rev-parse', '--verify', '--quiet', `refs/heads/${worktree.branch}`))
        assert.notInclude((yield* notices(task.threadId)).map((notice) => notice.title).join('\n'), 'ends on its branch')
        const sql = yield* SqlClient.SqlClient
        const [plan] = yield* sql<{ parameters: string }>`SELECT parameters FROM task_plans WHERE task_id = ${task.id}`
        assert.include(plan?.parameters, '"here":true')
        // Marked done, it settles, its branch kept.
        const tasks = yield* Tasks
        assert.isTrue(yield* tasks.markDone({ envelope: yield* Runtime.envelope('task.mark_done', { taskId: task.id }), taskId: task.id }))
        assert.deepInclude(yield* cardOnce(task.id, (one) => one.phase === 'settled'), { kind: 'plain', branch: worktree.branch })
        // Asked for more, it commits again in a round of its own, Finished again: nothing offers a pull request for it.
        yield* say(task.threadId, 'One more thing. [lead:commit] [lead:finish]')
        yield* until(
          sql<{ n: number }>`SELECT count(*) AS n FROM runs WHERE task_id = ${task.id} AND plan_id IS NULL AND state = 'succeeded'`,
          (rows) => rows[0]?.n === 1,
          Duration.seconds(20),
        )
        assert.deepInclude(yield* cardOnce(task.id, (one) => one.phase === 'ready'), { kind: 'plain', unshipped: null })
        assert.notInclude((yield* notices(task.threadId)).map((notice) => notice.title).join('\n'), 'pull request')
        assert.lengthOf(github.changes, 0)
      }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(undefined, {}, { connectors: fakeConnectors({ github }) })))))
    },
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
        `This task’s work is on branches of its own now, ${api.branch}, ${web.branch}-2, which stay on this computer.`,
      )
      // Once made, nothing more happens.
      assert.deepStrictEqual(yield* branchOnFirstWrite(created.taskId), [])
      const access: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, sessionId: 'none', taskId: null }
      const read = yield* callTool(access, 'read_task', { task: created.slug })
      assert.include(read, `api: branch ${api.branch}, in ${api.path}.`)
      assert.include(read, `web: branch ${web.branch}-2, in ${web.path}.`)
      // The coordinator hears nothing of it: the task is as it was.
      assert.isNull(yield* coordinatorNews(threadId, project.projectId, yield* modelNamer))
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('gives the rest their branch once one has its own, trying again where git couldn’t, and says so in its thread', () =>
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
      const news = Effect.map(
        Effect.flatMap(modelNamer, (namer) => coordinatorNews(threadId, project.projectId, namer)),
        (said) => said ?? '',
      )
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Share the header',
        repositories: ['api', 'web'],
        plain: true,
      })
      const [api, web] = yield* sql<{ id: string; path: string; branch: string }>`
        SELECT w.id, w.path, w.branch FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
        WHERE w.task_id = ${created.taskId} ORDER BY b.created_at, b.rowid`
      if (api === undefined || web === undefined) return assert.fail('no worktrees')
      const said = Effect.map(notices(created.threadId), (all) => all.map((notice) => notice.title))
      // Git won't take web's name; its lead writes in api only. The task is a change, and its thread says web has no branch yet.
      yield* sql`UPDATE workspaces SET branch = 'althar/no..dots' WHERE id = ${web.id}`
      writeFileSync(join(api.path, 'header.md'), 'A header.\n')
      assert.deepStrictEqual(yield* branchOnFirstWrite(created.taskId), [api.branch])
      assert.include(
        yield* said,
        `This task’s work is on a branch of its own now, ${api.branch}, which stays on this computer. Althar couldn’t make its branch in web yet, and tries again as its lead’s turn ends.`,
      )
      // Tried again at the next check, though nothing is written in web; still refused, it isn't said twice.
      const before = (yield* said).length
      assert.deepStrictEqual(yield* branchOnFirstWrite(created.taskId), [])
      assert.lengthOf(yield* said, before)
      assert.isNull(gitIn(web.path, 'symbolic-ref', '-q', 'HEAD'))
      // Once git takes a name, web gets its branch, and the thread says so.
      yield* sql`UPDATE workspaces SET branch = ${`${web.branch}-web`} WHERE id = ${web.id}`
      assert.deepStrictEqual(yield* branchOnFirstWrite(created.taskId), [])
      assert.strictEqual(gitIn(web.path, 'symbolic-ref', '--short', 'HEAD'), `${web.branch}-web`)
      assert.include(yield* said, `This task’s work is on its branch ${web.branch}-web in web too now.`)
      const [left] = yield* sql<{ n: number }>`
        SELECT count(*) AS n FROM workspaces WHERE task_id = ${created.taskId} AND branched_at IS NULL`
      assert.strictEqual(left?.n, 0)
      // The coordinator hears nothing of it: the task is as it was.
      assert.notInclude(yield* news, created.slug)
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

/** A project on the fake GitHub, connected, and its coordinator's thread, once the coordinator has spoken: what follows is its news. */
const onHost = (github: ReturnType<typeof makeFakeService>, working: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const coordinator = yield* Coordinator
    const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const threadId = yield* coordinator.thread(project.projectId)
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', {}), threadId, body: 'Hello.', disposition: 'after_current' })
    yield* until(
      sql<{ state: string }>`SELECT state FROM turn_deliveries WHERE thread_id = ${threadId}`,
      (rows) => rows.length > 0 && rows.every((row) => row.state !== 'pending' && row.state !== 'delivered'),
    )
    return { projectId: project.projectId, threadId }
  })

/** A runtime whose GitHub is the fake one given. */
const withGitHub = (github: ReturnType<typeof makeFakeService>) =>
  Queries.layer.pipe(Layer.provideMerge(runtime(undefined, {}, { connectors: fakeConnectors({ github }) })))

/** What the steps of the task's runs reported, in order. */
const stepsReported = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ step: string }>`
      SELECT json_extract(content, '$.step') AS step FROM thread_items WHERE thread_id = ${threadId} AND kind = 'step_result' ORDER BY sequence`
    return rows.map((row) => row.step)
  })

describe('making a quick task a change', () => {
  it.live('is the person’s to ask its lead: renamed, reviewed and ending in a draft pull request, which opens after the review', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const place = yield* onHost(github, working)
      const task = yield* started(place, 'Sketch the settings', 'Sketch it. [lead:commit] [lead:finish] [review:pass]')
      yield* cardOnce(task.id, (one) => one.phase === 'ready' && one.kind === 'plain')
      const worktree = yield* worktreeOf(task.id)
      assert.lengthOf(github.changes, 0)
      // The person likes it, and asks its lead to make it a real thing: it does, then reports, and the review comes first.
      yield* say(task.threadId, 'I really like it: can we make it a real thing? [lead:make-change] [lead:finish]')
      const card = yield* cardOnce(task.id, (one) => one.phase === 'ready' && one.kind === 'change', 40)
      assert.deepStrictEqual(yield* stepsReported(task.threadId), ['implement', 'implement', 'review', 'publish'])
      // Renamed for what it does, with its review and its ending in its plan, and nothing of staying here.
      assert.strictEqual(card.title, 'Make the sketch real')
      assert.deepStrictEqual(
        card.plan?.steps.map((step) => [step.key, step.agentId]),
        [
          ['implement', 'claude-code'],
          ['review', 'codex'],
        ],
      )
      assert.strictEqual(card.plan?.end, 'draft')
      const [plan] = yield* sql<{ parameters: string }>`SELECT parameters FROM task_plans WHERE task_id = ${task.id}`
      assert.notInclude(plan?.parameters, '"here"')
      // Its draft pull request, on the host, from the branch its quick work was on, with what that work committed.
      assert.deepStrictEqual(
        github.changes.map((change) => [change.title, change.draft, change.source]),
        [['Make the sketch real', true, worktree.branch]],
      )
      assert.strictEqual(card.change?.number, 1)
      assert.strictEqual(gitIn(bare, 'rev-parse', `refs/heads/${worktree.branch}`), gitIn(worktree.path, 'rev-parse', 'HEAD'))
      assert.strictEqual(gitIn(bare, 'log', '-1', '--format=%s', worktree.branch), 'Change it')
      // Said in its thread, found by its new title, and told to the coordinator.
      assert.include(
        (yield* notices(task.threadId)).map((notice) => notice.title),
        "This task is a change now: reviewed by Fake codex's default model, it opens a draft pull request when it’s done.",
      )
      assert.include(
        (yield* findTasks({ projectId: place.projectId, text: 'real' }, new Set())).map((one) => one.taskId),
        task.id,
      )
      assert.include(
        (yield* coordinatorNews(place.threadId, place.projectId, yield* modelNamer)) ?? '',
        `- ${task.slug} (Make the sketch real) (it was “Sketch the settings”): the person asked its lead to make this quick task a change, and it is one now: Fake codex's default model reviews it, and it ends as a draft pull request.`,
      )
      // Made once, it isn't made again.
      const lead: ToolAccess = { role: 'lead', ...place, threadId: task.threadId, sessionId: 'none', taskId: task.id }
      assert.match(
        yield* callTool(lead, 'make_it_a_change', { title: 'Again', review: null, output: 'draft' }),
        /^This task is a change already/,
      )
      assert.notInclude(yield* listTools(lead), 'make_it_a_change')
    }).pipe(Effect.provide(withGitHub(github)))
  })

  it.live('after its last run ended with no round under way, opens a round with its new ending, which publishes after the review', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const place = yield* onHost(github, working)
      const task = yield* started(place, 'Sketch the settings', 'Sketch it. [lead:commit] [lead:finish] [review:pass]')
      yield* cardOnce(task.id, (one) => one.phase === 'ready' && one.kind === 'plain')
      const [session] = yield* sql<{ id: string }>`SELECT id FROM provider_sessions WHERE thread_id = ${task.threadId}`
      const lead: ToolAccess = { role: 'lead', ...place, threadId: task.threadId, sessionId: session?.id ?? '', taskId: task.id }
      assert.include(yield* listTools(lead), 'make_it_a_change')
      // Asked where the person's words opened no round, as the coordinator passing them on would.
      assert.strictEqual(
        yield* callTool(lead, 'make_it_a_change', { title: 'Settings, for real', review: { agent: 'codex' }, output: 'ready' }),
        "The task is a change now, called “Settings, for real”. Commit your work, and call finish_step when it's ready, with what it built, your evidence and its pull request's description. Fake codex's default model reviews it next, then Althar opens its pull request, ready for review. Don't push or open it yourself.",
      )
      const [round] = yield* sql<{ state: string; parameters: string }>`
        SELECT state, parameters FROM runs WHERE task_id = ${task.id} AND plan_id IS NULL`
      assert.strictEqual(round?.state, 'running')
      assert.deepInclude(JSON.parse(round?.parameters ?? '{}'), { end: 'ready', publishes: true })
      assert.isTrue((yield* cardOnce(task.id, (one) => one.phase === 'running')).followUp)
      // Its lead reports: all the quick task committed is the round's, so the review comes next, then its pull request.
      const finished = { summary: 'Made it real.', built: 'The settings page.' }
      // Its pull request is to open, so the lead is asked for its description first.
      assert.match(yield* callTool(lead, 'finish_step', finished), /^Write the description of the task's pull request before you finish\. /)
      assert.match(
        yield* callTool(lead, 'finish_step', { ...finished, descriptions: [{ text: 'Settings were a sketch; this makes them real.' }] }),
        /A review starts now/,
      )
      yield* until(
        Effect.sync(() => github.changes),
        (changes) => changes.length === 1,
        Duration.seconds(20),
      )
      assert.deepStrictEqual(
        github.changes.map((change) => [change.title, change.draft]),
        [['Settings, for real', false]],
      )
      assert.isTrue(github.changes[0]?.body.startsWith('Settings were a sketch; this makes them real.'))
      yield* cardOnce(task.id, (one) => one.phase === 'ready' && one.kind === 'change')
    }).pipe(Effect.provide(withGitHub(github)))
  })

  it.live('gives a quick task with no branch its branch, and with no host Althar knows, an ending on it', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const tasks = yield* Tasks
      const place = yield* opened
      const task = yield* started(place, 'Look around', 'Look. [lead:finish] [lead:terse]')
      yield* cardOnce(task.id, (one) => one.phase === 'ready')
      assert.isNull((yield* worktreeOf(task.id)).branchedAt)
      // The person asks for it with no review: its branch is made where it is, though it holds nothing new.
      yield* say(task.threadId, 'Keep it as it is, no review needed. [lead:make-change-alone]')
      const worktree = yield* branchedOnce(task.id)
      assert.strictEqual(gitIn(worktree.path, 'symbolic-ref', '--short', 'HEAD'), worktree.branch)
      const card = yield* cardOnce(task.id, (one) => one.kind === 'change' && one.phase === 'ready')
      assert.deepInclude(card, { title: 'Make the sketch real', branch: worktree.branch })
      assert.deepStrictEqual(
        card.plan?.steps.map((step) => step.key),
        ['implement'],
      )
      assert.isNull(card.plan?.end)
      const said = yield* notices(task.threadId)
      assert.deepInclude(said, {
        source: 'runtime',
        severity: 'info',
        title: 'This task is a change now: with no review, it ends on its branch, as its repository isn’t on a code host Althar knows.',
        description: `Its work is on its branch ${worktree.branch}.`,
        // Althar's own housekeeping, kept with the lead's work.
        role: 'aside',
      })
      // Its thread says nothing of a branch that stays here.
      assert.notInclude(said.map((notice) => notice.title).join('\n'), 'stays on this computer')
      const [branched] = yield* sql<{ payload: string }>`SELECT payload FROM record_events WHERE type = 'workspace.branched'`
      assert.deepStrictEqual(JSON.parse(branched?.payload ?? '{}'), { from: null, to: worktree.branch, made: true })
      // A change now, Done doesn't settle it: it waits to be accepted.
      assert.isFalse(yield* tasks.markDone({ envelope: yield* Runtime.envelope('task.mark_done', { taskId: task.id }), taskId: task.id }))
      const [still] = yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${task.id}`
      assert.strictEqual(still?.state, 'open')
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('while its first run is under way, gives that run the review and the ending: reviewed, it ends on its branch with no host', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const place = yield* opened
      // Its lead commits, and is asked at once, in the words its task was given.
      const task = yield* started(place, 'Sketch the settings', 'Sketch it. [lead:commit] [lead:make-change] [lead:finish] [review:pass]')
      const card = yield* cardOnce(task.id, (one) => one.phase === 'ready' && one.kind === 'change', 40)
      assert.strictEqual(card.title, 'Make the sketch real')
      assert.deepStrictEqual(yield* stepsReported(task.threadId), ['implement', 'review'])
      // One run, its plan's, with the review and no more of staying here; its graph patched with the review.
      const runs = yield* sql<{
        planId: string | null
        parameters: string
      }>`SELECT plan_id, parameters FROM runs WHERE task_id = ${task.id}`
      assert.lengthOf(runs, 1)
      assert.isNotNull(runs[0]?.planId)
      const parameters = JSON.parse(runs[0]?.parameters ?? '{}') as { steps: ReadonlyArray<{ key: string }> }
      assert.deepStrictEqual(
        parameters.steps.map((step) => step.key),
        ['implement', 'review'],
      )
      assert.notProperty(parameters, 'here')
      assert.notProperty(parameters, 'publishes')
      const [patched] = yield* sql<{ graph: string }>`
        SELECT g.graph FROM execution_graph_revisions g JOIN workflow_executions e ON e.id = g.execution_id
        JOIN runs r ON r.id = e.run_id WHERE r.task_id = ${task.id} AND g.cause = 'patch'`
      assert.include(patched?.graph, '"review"')
      // With no host Althar knows, it ends on its branch, and says so.
      const said = (yield* notices(task.threadId)).map((notice) => notice.title)
      assert.include(
        said,
        "This task is a change now: reviewed by Fake codex's default model, it ends on its branch, as its repository isn’t on a code host Althar knows.",
      )
      assert.include(said, 'The task ends on its branch.')
      assert.strictEqual(gitIn((yield* worktreeOf(task.id)).path, 'log', '-1', '--format=%s'), 'Change it')
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('is refused on a planned task, on a review, and for a model Althar can’t use or a title too long', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const projects = yield* Projects
      const plans = yield* Plans
      const instance = yield* Instance
      const place = yield* opened
      const lead = (taskId: string, threadId: string): ToolAccess => ({ role: 'lead', ...place, threadId, sessionId: 'none', taskId })
      const asked = { title: 'Make it real', review: { agent: 'codex' }, output: 'draft' }
      // A planned task: not offered to its lead, and refused, saying why.
      const planned = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: place.projectId,
        title: 'Retry the checkout',
        draft: true,
      })
      yield* plans.propose({
        projectId: place.projectId as ProjectId,
        taskId: planned.taskId,
        steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
        reason: null,
        actorId: instance.personId,
        startsIn: Duration.hours(1),
      })
      const plannedLead = lead(planned.taskId, planned.threadId)
      assert.notInclude(yield* listTools(plannedLead), 'make_it_a_change')
      assert.match(yield* callTool(plannedLead, 'make_it_a_change', asked), /^This task was planned as a change from its start/)
      // A review of someone else's pull request.
      const reviewing = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: place.projectId,
        title: 'Review the retry',
        draft: true,
      })
      const at = new Date().toISOString()
      yield* sql`INSERT INTO external_links ${sql.insert({
        id: `xlink_${'a'.repeat(32)}`,
        projectId: place.projectId,
        taskId: reviewing.taskId,
        product: 'github',
        kind: 'review',
        externalId: '12',
        ref: 'meridian/api#12',
        key: '#12',
        url: 'https://github.test/meridian/api/pull/12',
        createdAt: at,
        updatedAt: at,
      })}`
      assert.match(
        yield* callTool(lead(reviewing.taskId, reviewing.threadId), 'make_it_a_change', asked),
        /^This task reviews someone else’s pull request/,
      )
      // A quick task: what it is asked is read, and a model it can't use, or a title too long, are refused, saying what it can.
      const quick = yield* started(place, 'Look around', 'Look. [lead:finish] [lead:terse]')
      yield* cardOnce(quick.id, (one) => one.phase === 'ready')
      const quickLead = lead(quick.id, quick.threadId)
      assert.match(yield* callTool(quickLead, 'make_it_a_change', { title: 'Make it real' }), /couldn't read that/)
      const unknown = yield* callTool(quickLead, 'make_it_a_change', { ...asked, review: { model: 'nothing' } })
      assert.include(unknown, 'No model called nothing can be used now.')
      assert.include(unknown, "for make_it_a_change's review")
      assert.strictEqual(
        yield* callTool(quickLead, 'make_it_a_change', { ...asked, review: {} }),
        "Name the model, for make_it_a_change's review.",
      )
      assert.match(
        yield* callTool(quickLead, 'make_it_a_change', { ...asked, title: 'x'.repeat(61) }),
        /^That title is 61 characters\. Keep it to 60/,
      )
      assert.strictEqual(
        yield* callTool(quickLead, 'make_it_a_change', { ...asked, title: '  ' }),
        'Give it a title: what the change does, in a few words.',
      )
      // None of it changed the task: it is still plain.
      assert.strictEqual((yield* cardOnce(quick.id, () => true)).kind, 'plain')
      // With a pull request of its own, it is a change already.
      yield* sql`INSERT INTO external_links ${sql.insert({
        id: `xlink_${'b'.repeat(32)}`,
        projectId: place.projectId,
        taskId: quick.id,
        product: 'github',
        kind: 'change',
        externalId: '13',
        ref: 'meridian/api#13',
        key: '#13',
        url: 'https://github.test/meridian/api/pull/13',
        createdAt: at,
        updatedAt: at,
      })}`
      assert.strictEqual(
        yield* callTool(quickLead, 'make_it_a_change', asked),
        'This task has a pull request already, so it is a change: there is nothing to make.',
      )
      // And only a task's lead makes its task one.
      const none: ToolAccess = { role: 'lead', ...place, sessionId: 'none', taskId: null }
      assert.notInclude(yield* listTools(none), 'make_it_a_change')
      assert.strictEqual(
        yield* callTool(none, 'make_it_a_change', asked),
        'Only the lead of one of the project’s tasks makes its task a change.',
      )
    }).pipe(Effect.provide(withQueries())),
  )
})
