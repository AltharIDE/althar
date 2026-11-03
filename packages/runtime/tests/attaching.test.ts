import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { type AttachInput, Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import type { ToolAccess } from '../src/ToolServer'
import * as Runtime from '../src/Runtime'
import { callTool, fakeConnectors, HOST, hosted, notices, runtime, until } from './support'

/*
 * Attaching a task to a pull request it didn't open (ADR-052), beyond the
 * way it usually goes (attach.test.ts): what is refused, and in what words,
 * with the task's branch left as it was; a pull request on the repository
 * itself rather than from a fork; one followed again, or in place of
 * another; a project of several repositories; and what the coordinator is
 * told starting over keeps.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Nine', '-c', 'user.email=nine@althar.test', ...args], { cwd })
    .toString()
    .trim()

/** Where a branch is on a bare repository, as the host reads it. */
const tipOf = (bare: string, branch: string) => {
  try {
    return git(bare, 'rev-parse', `refs/heads/${branch}`)
  } catch {
    return null
  }
}

/** A commit on a branch, in a worktree: its file says what. */
const commit = (cwd: string, file: string, text: string) => {
  writeFileSync(join(cwd, file), text)
  git(cwd, 'add', file)
  git(cwd, 'commit', '-q', '-m', `Write ${file}`)
  return git(cwd, 'rev-parse', 'HEAD')
}

/** A branch from `main` with one commit, pushed to the bare repository and not kept in the working one: its commit. */
const pushed = (working: string, bare: string, branch: string, file: string) => {
  git(working, 'checkout', '-q', '-b', branch, 'main')
  const head = commit(working, file, `export const ${branch.replace(/-/g, '')} = 1\n`)
  git(working, 'push', '-q', bare, branch)
  git(working, 'checkout', '-q', 'main')
  git(working, 'branch', '-q', '-D', branch)
  return head
}

/**
 * A fork (you/api) and the repository it came from (meridian/api), both on
 * the fake host, and a pull request into the second from the fork's
 * `fix-send-back`; as attach.test.ts has it.
 */
const forked = (options: { readonly fork?: ReadonlyArray<string> } = {}) => {
  const { working, bare } = hosted(['you', 'api'])
  git(working, 'remote', 'add', 'upstream', `${HOST}/meridian/api.git`)
  const head = pushed(working, bare, 'fix-send-back', 'send.ts')
  const github: FakeService = makeFakeService({
    pushUrl: () => bare,
    headOf: (number) => (number === 1 ? tipOf(bare, 'fix-send-back') : null),
  })
  github.addRepository(['you', 'api'])
  github.addRepository(['meridian', 'api'])
  const pull = github.addPullRequest({
    path: ['meridian', 'api'],
    title: 'Send back won’t restart a dead lead',
    author: 'you',
    source: 'fix-send-back',
    headSha: head,
    fork: options.fork ?? ['you', 'api'],
  })
  return { working, bare, github, pull, head }
}

/** A repository on the fake host, not a fork, and a pull request opened by hand on it from its own branch `fix-retry`, a draft. */
const own = () => {
  const { working, bare } = hosted(['meridian', 'api'])
  const head = pushed(working, bare, 'fix-retry', 'retry.ts')
  const github = makeFakeService({ pushUrl: () => bare })
  github.addRepository(['meridian', 'api'])
  const pull = github.addPullRequest({
    path: ['meridian', 'api'],
    title: 'Retry checkout three times',
    author: 'dana',
    source: 'fix-retry',
    headSha: head,
    draft: true,
  })
  return { working, bare, github, pull, head }
}

const withQueries = (github: FakeService, listenEvery?: Duration.Duration) =>
  Queries.layer.pipe(
    Layer.provideMerge(
      runtime(':memory:', {}, { connectors: fakeConnectors({ github }), ...(listenEvery === undefined ? {} : { listenEvery }) }),
    ),
  )

/**
 * A project of the repository at `path`, sending its pull requests upstream
 * where it is a fork; GitHub connected unless `connect` says not; a task in
 * it, changing the repositories named where there are several; and the
 * coordinator's tools.
 */
const project = (
  path: string,
  options: { readonly upstream?: boolean; readonly connect?: boolean; readonly repositories?: ReadonlyArray<string> } = {},
) =>
  Effect.gen(function* () {
    const instance = yield* Instance
    if (options.connect !== false)
      yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const projects = yield* Projects
    const opened = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
    if (options.upstream !== false) {
      const [repository] = yield* projects.repositories(opened.projectId)
      yield* projects.setRepository({ projectId: opened.projectId, repositoryId: repository?.id ?? '', changeTarget: 'upstream' })
    }
    const task = yield* newTask(opened.projectId, 'Answer the review', options.repositories)
    const coordinator: ToolAccess = {
      role: 'coordinator',
      projectId: opened.projectId,
      threadId: yield* (yield* Coordinator).thread(opened.projectId),
      sessionId: 'coordinator-session',
      taskId: null,
    }
    return { projectId: opened.projectId as ProjectId, task, coordinator, personId: instance.personId }
  })

const newTask = (projectId: string, title: string, repositories?: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    return yield* (yield* Projects).createTask({
      envelope: yield* Runtime.envelope('task.create', { title }),
      projectId,
      title,
      ...(repositories === undefined ? {} : { repositories: [...repositories] }),
    })
  })

/** What attaching says where it is refused, starting over if it would: its message, for the person and the coordinator alike. */
const refusal = (input: Omit<AttachInput, 'start'>) =>
  Effect.gen(function* () {
    const refused = yield* Effect.flip((yield* Changes).attach({ ...input, start: true }))
    assert.strictEqual((refused as { _tag?: string })._tag, 'AttachRefused')
    return (refused as { message?: string }).message
  })

describe('attaching a task to a pull request it didn’t open', () => {
  it.live('refuses, in words, a link or a number it can’t follow, and follows nothing', () => {
    const { github, working } = forked()
    return Effect.gen(function* () {
      const { task, personId } = yield* project(working)
      const changes = yield* Changes
      const asked = (pullRequest: string) => refusal({ taskId: task.taskId, pullRequest, actorId: personId })
      assert.strictEqual(
        yield* asked('https://gitea.test/meridian/api/pull/1'),
        'Althar isn’t connected to where that link points. Connect its host in Settings, then attach it.',
      )
      assert.strictEqual(yield* asked(`${HOST}/meridian/api/issues/1`), 'That link isn’t to a pull request.')
      assert.strictEqual(yield* asked('the one dana opened'), 'Give the pull request’s link, or its number: #123.')
      assert.strictEqual(yield* asked('#9'), 'That pull request isn’t there, or Althar’s sign-in can’t see it.')
      github.failNext('change', 'unreachable')
      assert.strictEqual(yield* asked('#1'), 'The host said: The fake change failed (unreachable)')
      // Nothing was followed, and its branch is where it started.
      assert.lengthOf(yield* changes.ofTask(task.taskId), 0)
      assert.strictEqual(git(task.worktree, 'rev-parse', 'HEAD'), git(working, 'rev-parse', 'main'))
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('follows nothing for a task that isn’t there, is done, or was abandoned', () => {
    const { github, working } = forked()
    return Effect.gen(function* () {
      const { projectId, task, personId } = yield* project(working)
      const changes = yield* Changes
      const gone = yield* Effect.flip(changes.attach({ taskId: 'task_gone', pullRequest: '#1', start: true, actorId: personId }))
      assert.deepInclude(gone as object, { _tag: 'NotFound', kind: 'task', id: 'task_gone' })

      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE tasks SET state = 'done' WHERE id = ${task.taskId}`
      assert.strictEqual(
        yield* refusal({ taskId: task.taskId, pullRequest: '#1', actorId: personId }),
        'The task is done: only an open one follows a pull request.',
      )

      const other = yield* newTask(projectId, 'Answer it again')
      yield* (yield* Tasks).abandon({ envelope: yield* Runtime.envelope('task.abandon', { taskId: other.taskId }), taskId: other.taskId })
      assert.strictEqual(
        yield* refusal({ taskId: other.taskId, pullRequest: '#1', actorId: personId }),
        'The task is abandoned: only an open one follows a pull request.',
      )
      assert.lengthOf(yield* changes.ofTask(task.taskId), 0)
      assert.lengthOf(yield* changes.ofTask(other.taskId), 0)
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('refuses a pull request whose fork is gone, or whose branch it can’t fetch', () => {
    const gone = forked({ fork: [] })
    return Effect.gen(function* () {
      const { task, personId } = yield* project(gone.working)
      assert.strictEqual(
        yield* refusal({ taskId: task.taskId, pullRequest: '#1', actorId: personId }),
        'PR #1’s branch was on a fork that is gone.',
      )
      // One from the fork whose branch was never pushed there.
      gone.github.addPullRequest({ path: ['meridian', 'api'], title: 'Nowhere', author: 'you', source: 'not-pushed', fork: ['you', 'api'] })
      assert.strictEqual(
        yield* refusal({ taskId: task.taskId, pullRequest: '#2', actorId: personId }),
        'Althar couldn’t fetch PR #2’s branch, not-pushed, from you/api.',
      )
      assert.lengthOf(yield* (yield* Changes).ofTask(task.taskId), 0)
    }).pipe(Effect.provide(withQueries(gone.github)))
  })

  it.live('takes a number only where the task’s repository is on a connected host and its worktree is there', () => {
    const { github, working } = forked()
    return Effect.gen(function* () {
      const { task, personId } = yield* project(working, { connect: false })
      const unconnected = 'The task’s repository isn’t on a code host Althar is connected to. Connect it in Settings.'
      assert.strictEqual(yield* refusal({ taskId: task.taskId, pullRequest: '#1', actorId: personId }), unconnected)
      yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: personId, webUrl: HOST })
      // Connected, but its worktree is gone from this computer: there is nothing here to attach.
      rmSync(task.worktree, { recursive: true, force: true })
      assert.strictEqual(yield* refusal({ taskId: task.taskId, pullRequest: '#1', actorId: personId }), unconnected)
      assert.lengthOf(
        github.calls.filter((call) => call === 'change'),
        0,
      )
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('starts nothing over what isn’t committed, a lead at work, or a branch left from before', () => {
    const { github, working } = forked()
    return Effect.gen(function* () {
      const { task, personId } = yield* project(working)
      const changes = yield* Changes
      const before = git(task.worktree, 'rev-parse', 'HEAD')
      const attaching = { taskId: task.taskId, pullRequest: '#1', actorId: personId }

      writeFileSync(join(task.worktree, 'notes.md'), 'Ask dana.\n')
      assert.strictEqual(
        yield* refusal(attaching),
        'What isn’t committed in its worktree would be lost: notes.md. Commit it or drop it, then attach PR #1.',
      )
      rmSync(join(task.worktree, 'notes.md'))

      // Its lead in its worktree: asking what starting over keeps is fine, starting over isn't.
      const sessions = yield* Sessions
      yield* sessions.start({ threadId: task.threadId, agentId: 'codex' })
      assert.deepInclude(yield* changes.attach(attaching), { kind: 'start', own: 0 })
      assert.strictEqual(
        yield* refusal(attaching),
        'Its lead is at work in its worktree. Stop it, or wait for its turn to end, then attach PR #1.',
      )
      yield* sessions.stop(task.threadId)

      // A worktree with no branch yet, off the head, where one of its branch's name is left from before.
      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE workspaces SET branched_at = NULL WHERE task_id = ${task.taskId}`
      assert.strictEqual(
        yield* refusal(attaching),
        `A branch called ${task.branch} is in its repository already, from before. Delete or rename it, then attach PR #1.`,
      )
      assert.strictEqual(git(task.worktree, 'rev-parse', 'HEAD'), before)
      assert.strictEqual(git(task.worktree, 'branch', '--show-current'), task.branch)
      assert.lengthOf(yield* changes.ofTask(task.taskId), 0)
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('puts the branch back where the task’s own commits conflict with the head, or leaves none where it had none', () => {
    const { github, working } = forked()
    return Effect.gen(function* () {
      const { projectId, task, personId } = yield* project(working)
      const changes = yield* Changes
      const conflicts = 'The task’s own commits conflict with PR #1’s head in send.ts, so its branch stays as it was.'
      const mine = commit(task.worktree, 'send.ts', 'export const sendBack = () => 2\n')
      assert.strictEqual(yield* refusal({ taskId: task.taskId, pullRequest: '#1', actorId: personId }), conflicts)
      assert.strictEqual(git(task.worktree, 'rev-parse', 'HEAD'), mine)
      assert.strictEqual(git(task.worktree, 'branch', '--show-current'), task.branch)
      assert.strictEqual(git(task.worktree, 'status', '--porcelain'), '')

      // Another, whose worktree has no branch of its own yet: none is left behind for it.
      const other = yield* newTask(projectId, 'Answer it again')
      git(other.worktree, 'checkout', '-q', '--detach')
      git(other.worktree, 'branch', '-q', '-D', other.branch)
      const detached = commit(other.worktree, 'send.ts', 'export const sendBack = () => 3\n')
      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE workspaces SET branched_at = NULL WHERE task_id = ${other.taskId}`
      assert.strictEqual(yield* refusal({ taskId: other.taskId, pullRequest: '#1', actorId: personId }), conflicts)
      assert.strictEqual(git(other.worktree, 'rev-parse', 'HEAD'), detached)
      assert.strictEqual(git(other.worktree, 'branch', '--show-current'), '')
      assert.strictEqual(git(other.worktree, 'branch', '--list', other.branch), '')
      assert.lengthOf(yield* changes.ofTask(other.taskId), 0)
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('gives a worktree with no branch yet, on the head already, the task’s branch there', () => {
    const { bare, github, head, working } = forked()
    return Effect.gen(function* () {
      const { task, personId } = yield* project(working)
      const sql = yield* SqlClient.SqlClient
      git(task.worktree, 'fetch', '-q', bare, 'fix-send-back')
      git(task.worktree, 'checkout', '-q', '--detach', 'FETCH_HEAD')
      git(task.worktree, 'branch', '-q', '-D', task.branch)
      yield* sql`UPDATE workspaces SET branched_at = NULL WHERE task_id = ${task.taskId}`
      // On the head, nothing is asked first: there is nothing to start over.
      const attached = yield* (yield* Changes).attach({ taskId: task.taskId, pullRequest: '#1', actorId: personId })
      assert.deepInclude(attached, { kind: 'attached', started: false, kept: 0 })
      assert.strictEqual(git(task.worktree, 'branch', '--show-current'), task.branch)
      assert.strictEqual(git(task.worktree, 'rev-parse', 'HEAD'), head)
      const [workspace] = yield* sql<{ branchedAt: string | null }>`SELECT branched_at FROM workspaces WHERE task_id = ${task.taskId}`
      assert.isNotNull(workspace?.branchedAt)
      const [said] = (yield* notices(task.threadId)).filter((notice) => notice.title?.startsWith('Following PR #1'))
      assert.deepInclude(said, {
        title: 'Following PR #1: Send back won’t restart a dead lead',
      })
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('starts a worktree with no base recorded from the head, keeping only its own commits', () => {
    const { github, head, working } = forked()
    return Effect.gen(function* () {
      const { task, personId } = yield* project(working)
      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE workspaces SET base_commit = NULL WHERE task_id = ${task.taskId}`
      commit(task.worktree, 'mine.md', 'Mine.\n')
      const attached = yield* (yield* Changes).attach({ taskId: task.taskId, pullRequest: '#1', start: true, actorId: personId })
      assert.deepInclude(attached, { kind: 'attached', started: true, kept: 1 })
      assert.strictEqual(git(task.worktree, 'rev-parse', 'HEAD~1'), head)
      // Its change starts at the head it started from.
      const [workspace] = yield* sql<{ baseCommit: string | null }>`SELECT base_commit FROM workspaces WHERE task_id = ${task.taskId}`
      assert.strictEqual(workspace?.baseCommit, head)
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('follows a draft opened by hand on the repository itself, and publishing pushes onto its branch', () => {
    const { bare, github, head, working } = own()
    return Effect.gen(function* () {
      const { projectId, task, personId } = yield* project(working, { upstream: false })
      const changes = yield* Changes
      // By its number, on the repository itself: it isn't a fork.
      const attached = yield* changes.attach({ taskId: task.taskId, pullRequest: '1', start: true, actorId: personId })
      assert.deepInclude(attached, { kind: 'attached', started: true, kept: 0 })
      assert.strictEqual(git(task.worktree, 'rev-parse', 'HEAD'), head)
      const [change] = yield* changes.ofTask(task.taskId)
      assert.deepInclude(change, { url: 'https://github.com/meridian/api/pull/1', draft: true, attached: true, source: 'fix-retry' })
      const sql = yield* SqlClient.SqlClient
      const [recorded] = yield* sql<{ pullRequestState: string; branch: string }>`
        SELECT c.pull_request_state, c.branch FROM repository_changes c JOIN workspaces w ON w.id = c.workspace_id
        WHERE w.task_id = ${task.taskId}`
      assert.deepStrictEqual(recorded, { pullRequestState: 'draft', branch: task.branch })
      const [said] = (yield* notices(task.threadId)).filter((notice) => notice.title?.startsWith('Following PR #1'))
      assert.deepInclude(said, {
        title: 'Following PR #1: Retry checkout three times',
      })

      // Its own branch's commits go onto the pull request's branch on the repository itself.
      const mine = commit(task.worktree, 'why.md', 'Three is enough.\n')
      const [published] = yield* changes.publish({ projectId, taskId: task.taskId, runId: 'run_none', end: 'draft' })
      assert.isTrue(published?.kind === 'opened' && published.attached === true)
      assert.strictEqual(tipOf(bare, 'fix-retry'), mine)
      assert.isNull(tipOf(bare, task.branch))
      assert.lengthOf(github.changes, 1)
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('stops listening once publishing finds the pull request closed on its host', () => {
    const { bare, github, pull, working } = forked()
    return Effect.gen(function* () {
      const { projectId, task, personId } = yield* project(working)
      const changes = yield* Changes
      yield* changes.attach({ taskId: task.taskId, pullRequest: '#1', start: true, actorId: personId })
      // Once Althar has listened to it as it attached, it is closed on the host, which Althar doesn't hear before it publishes.
      const read = () => github.calls.filter((call) => call === 'change').length
      const attached = read()
      yield* until(
        Effect.sync(() => (read() > attached ? [read()] : [])),
        (rows) => rows.length > 0,
      )
      github.close(pull.number)
      const mine = commit(task.worktree, 'why.md', 'It restarts.\n')
      const [published] = yield* changes.publish({ projectId, taskId: task.taskId, runId: 'run_none', end: 'draft' })
      assert.isTrue(published?.kind === 'opened' && published.attached === true)
      assert.deepInclude(published?.kind === 'opened' ? published.change : {}, { state: 'closed', listening: false })
      assert.strictEqual(tipOf(bare, 'fix-send-back'), mine)
      const [change] = yield* changes.ofTask(task.taskId)
      assert.deepInclude(change, { state: 'closed', listening: false })
    }).pipe(Effect.provide(withQueries(github, Duration.minutes(10))))
  })

  it.live('listens again to a pull request it followed before, on the same link, its branch left on the head', () => {
    const { github, head, pull, working } = forked()
    return Effect.gen(function* () {
      const { task, coordinator, personId } = yield* project(working)
      const changes = yield* Changes
      yield* changes.attach({ taskId: task.taskId, pullRequest: '#1', start: true, actorId: personId })
      yield* changes.stopListening(task.taskId, pull.url)
      assert.deepInclude((yield* changes.ofTask(task.taskId))[0], { listening: false })

      // On its head already, nothing starts over: the coordinator hears it follows it, with no word of its branch.
      assert.strictEqual(
        yield* callTool(coordinator, 'attach_pull_request', { task: task.slug, pull_request: '#1' }),
        `${task.slug} follows PR #1 now: its reviews, comments, checks and conflicts are heard, its lead's pull request tools act on it, and its work goes to that pull request's branch, with no new pull request. The person sees it on the task.`,
      )
      assert.strictEqual(git(task.worktree, 'rev-parse', 'HEAD'), head)
      const followed = yield* changes.ofTask(task.taskId)
      assert.lengthOf(followed, 1)
      assert.deepInclude(followed[0], { url: pull.url, listening: true, attached: true })
      // The same link, listened to again; not a second one.
      const sql = yield* SqlClient.SqlClient
      const [links] = yield* sql<{ n: number }>`SELECT count(*) AS n FROM external_links WHERE task_id = ${task.taskId} AND kind = 'change'`
      assert.strictEqual(links?.n, 1)
      const said = (yield* notices(task.threadId)).filter((notice) => notice.title?.startsWith('Following PR #1'))
      assert.lengthOf(said, 2)
      assert.notInclude(said[1]?.description ?? '', 'starts from')
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('follows another pull request in place of the first, and tells the coordinator what starting over keeps', () => {
    const { bare, github, head, working } = forked()
    const other = pushed(working, bare, 'fix-other', 'other.ts')
    github.addPullRequest({
      path: ['meridian', 'api'],
      title: 'Say why it restarts',
      author: 'you',
      source: 'fix-other',
      headSha: other,
      fork: ['you', 'api'],
    })
    return Effect.gen(function* () {
      const { projectId, task, coordinator, personId } = yield* project(working)
      const changes = yield* Changes
      yield* changes.attach({ taskId: task.taskId, pullRequest: '#1', start: true, actorId: personId })

      // A refusal reaches the coordinator in the same words.
      assert.strictEqual(
        yield* callTool(coordinator, 'attach_pull_request', { task: task.slug, pull_request: 'the other one' }),
        'Give the pull request’s link, or its number: #123.',
      )
      // PR #1's commit is its own, as far as PR #2 goes: starting over keeps it.
      const asked = yield* callTool(coordinator, 'attach_pull_request', { task: task.slug, pull_request: '#2' })
      assert.include(asked, `Nothing changed yet: ${task.slug}'s branch isn't based on PR #2's head.`)
      assert.include(asked, 'Starting it from there keeps its one commit of its own, on top of the head.')
      assert.strictEqual(
        yield* callTool(coordinator, 'attach_pull_request', { task: task.slug, pull_request: '#2', start_from_head: true }),
        `${task.slug} follows PR #2 now, its branch started from its head with its one commit on top: its reviews, comments, checks and conflicts are heard, its lead's pull request tools act on it, and its work goes to that pull request's branch, with no new pull request. The person sees it on the task.`,
      )
      assert.strictEqual(git(task.worktree, 'rev-parse', 'HEAD~1'), other)
      assert.include(git(task.worktree, 'ls-tree', '--name-only', 'HEAD'), 'send.ts')
      // It follows the second now, not the first.
      const followed = yield* changes.ofTask(task.taskId)
      assert.deepStrictEqual(
        followed.toSorted((a, b) => a.number - b.number).map((one) => [one.number, one.listening]),
        [
          [1, false],
          [2, true],
        ],
      )

      // So the first is another task's to attach: one with two commits of its own keeps both on top of its head.
      const second = yield* newTask(projectId, 'Answer the first again')
      commit(second.worktree, 'a.md', 'A.\n')
      commit(second.worktree, 'b.md', 'B.\n')
      assert.include(
        yield* callTool(coordinator, 'attach_pull_request', { task: second.slug, pull_request: '#1' }),
        'Starting it from there keeps its 2 commits of its own, on top of the head.',
      )
      assert.include(
        yield* callTool(coordinator, 'attach_pull_request', { task: second.slug, pull_request: '#1', start_from_head: true }),
        `${second.slug} follows PR #1 now, its branch started from its head with its 2 commits on top:`,
      )
      assert.strictEqual(git(second.worktree, 'rev-parse', 'HEAD~2'), head)
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('asks for the link where the task changes several repositories, says which it follows, and lists each', () => {
    const folder = realpathSync(mkdtempSync(join(tmpdir(), 'althar-folder-')))
    const bares = new Map<string, string>()
    for (const name of ['api', 'web']) {
      const root = join(folder, name)
      mkdirSync(root)
      git(root, 'init', '-q', '-b', 'main')
      commit(root, 'README.md', `# ${name}\n`)
      git(root, 'remote', 'add', 'origin', `${HOST}/meridian/${name}.git`)
      const bare = mkdtempSync(join(tmpdir(), 'althar-remote-'))
      git(bare, 'init', '-q', '--bare', '-b', 'main')
      git(root, 'push', '-q', bare, 'main')
      bares.set(name, bare)
    }
    const web = join(folder, 'web')
    const webBare = bares.get('web') ?? ''
    const head = pushed(web, webBare, 'fix-layout', 'layout.ts')
    const github = makeFakeService({ pushUrl: (path) => bares.get(path.at(-1) ?? '') ?? '' })
    github.addRepository(['meridian', 'api'])
    github.addRepository(['meridian', 'web'])
    github.addPullRequest({ path: ['meridian', 'web'], title: 'Fix the layout', author: 'dana', source: 'fix-layout', headSha: head })
    return Effect.gen(function* () {
      const { task, coordinator, personId } = yield* project(folder, { upstream: false, repositories: ['api', 'web'] })
      assert.strictEqual(
        yield* refusal({ taskId: task.taskId, pullRequest: '#1', actorId: personId }),
        'The task changes several repositories (api, web): give the pull request’s link.',
      )
      const attached = yield* (yield* Changes).attach({
        taskId: task.taskId,
        pullRequest: `${HOST}/meridian/web/pull/1`,
        start: true,
        actorId: personId,
      })
      assert.deepInclude(attached, { kind: 'attached', started: true })
      const said = (yield* notices(task.threadId)).filter((notice) => notice.title?.startsWith('Following PR #1'))
      assert.strictEqual(said[0]?.title, 'Following PR #1 in web: Fix the layout')
      const sql = yield* SqlClient.SqlClient
      const [worktree] = yield* sql<{ path: string }>`
        SELECT w.path FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
        WHERE w.task_id = ${task.taskId} AND b.display_name = 'web'`
      assert.strictEqual(git(worktree?.path ?? '', 'rev-parse', 'HEAD'), head)

      // Each repository is listed under its own name, with the task that follows the pull request in web.
      const found = yield* callTool(coordinator, 'find_pull_requests', {})
      assert.include(found, 'Open pull requests in web (meridian/web), newest change first:')
      assert.include(found, `task ${task.slug} follows it`)
      assert.include(found, 'api (meridian/api): no open pull requests match.')
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('lists a task still a draft as following the pull request it was drafted for', () => {
    const { github, working } = forked()
    return Effect.gen(function* () {
      const { projectId, coordinator } = yield* project(working)
      yield* callTool(coordinator, 'draft_task', { title: 'Answer the review on #1', pull_request: '#1' })
      const sql = yield* SqlClient.SqlClient
      const [drafted] = yield* sql<{ slug: string; state: string }>`
        SELECT slug, state FROM tasks WHERE project_id = ${projectId} AND title = 'Answer the review on #1'`
      assert.strictEqual(drafted?.state, 'draft')
      assert.include(yield* callTool(coordinator, 'find_pull_requests', {}), `task ${drafted?.slug ?? ''} follows it`)
    }).pipe(Effect.provide(withQueries(github)))
  })
})
