import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type FakeService, type FakeServiceOptions, makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Exit, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { NotFound } from '../src/errors'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import type { ToolAccess } from '../src/ToolServer'
import * as Runtime from '../src/Runtime'
import { callTool, fakeConnectors, HOST, hosted, items, runtime, until } from './support'

/*
 * A task attached to a pull request it didn't open (ADR-052): here, as in
 * Althar's own repository, a fork (you/api) whose pull requests open on the
 * repository it came from (meridian/api), and one open there from the fork's
 * branch `fix-send-back`, which no task's branch is called. Attached, the task
 * follows it as one Althar opened, and publishing pushes its branch onto that
 * one's, only as a fast-forward, and opens no other.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Nine', '-c', 'user.email=nine@althar.test', ...args], { cwd })
    .toString()
    .trim()

/** Where a branch is on the fork, as the host reads it. */
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

/**
 * The fork and the repository it came from, both on the fake host; and a
 * pull request into the second from the fork's `fix-send-back`, its commit
 * on the fork only.
 */
const forked = (
  options: {
    readonly fork?: ReadonlyArray<string>
    readonly state?: 'open' | 'closed'
    readonly host?: Pick<FakeServiceOptions, 'reviews' | 'saysHead'>
  } = {},
) => {
  const { working, bare } = hosted(['you', 'api'])
  git(working, 'remote', 'add', 'upstream', `${HOST}/meridian/api.git`)
  git(working, 'checkout', '-q', '-b', 'fix-send-back')
  const head = commit(working, 'send.ts', 'export const sendBack = () => 1\n')
  git(working, 'push', '-q', bare, 'fix-send-back')
  git(working, 'checkout', '-q', 'main')
  git(working, 'branch', '-q', '-D', 'fix-send-back')
  const github: FakeService = makeFakeService({
    pushUrl: () => bare,
    headOf: (number) => (number === 1 ? tipOf(bare, 'fix-send-back') : null),
    ...options.host,
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
    ...(options.state === undefined ? {} : { state: options.state }),
  })
  return { working, bare, github, pull, head }
}

const withQueries = (github: FakeService) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.millis(100) })),
  )

/** A connected GitHub, the fork opened as a project sending its pull requests upstream, a task in it, and the coordinator's tools. */
const project = (working: string) =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const projects = yield* Projects
    const opened = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const [repository] = yield* projects.repositories(opened.projectId)
    yield* projects.setRepository({ projectId: opened.projectId, repositoryId: repository?.id ?? '', changeTarget: 'upstream' })
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', { title: 'Answer the review' }),
      projectId: opened.projectId,
      title: 'Answer the review',
    })
    const coordinator: ToolAccess = {
      role: 'coordinator',
      projectId: opened.projectId,
      threadId: yield* (yield* Coordinator).thread(opened.projectId),
      sessionId: 'coordinator-session',
      taskId: null,
    }
    return { projectId: opened.projectId as ProjectId, task, coordinator, personId: instance.personId }
  })

const linkTo = (number: number) => `${HOST}/meridian/api/pull/${number}`

const cardOf = (projectId: string, taskId: string) =>
  Effect.gen(function* () {
    const snapshot = yield* Effect.orDie((yield* Queries).coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' && item.content.taskId === taskId ? [item.content] : []))
  })

describe('a task attached to a pull request it didn’t open', () => {
  it.live('follows an upstream pull request from the fork, and publishing updates its branch without opening another', () => {
    const { bare, github, pull, head, working } = forked()
    return Effect.gen(function* () {
      const { projectId, task, personId } = yield* project(working)
      const changes = yield* Changes

      // Its branch came from main, not the pull request's head: nothing changes until the person says to start it there.
      const asked = yield* changes.attach({ taskId: task.taskId, pullRequest: linkTo(pull.number), actorId: personId })
      assert.deepStrictEqual(asked, { kind: 'start', name: 'PR #1', source: 'fix-send-back', head, own: 0 })
      assert.lengthOf(yield* changes.ofTask(task.taskId), 0)

      const attached = yield* changes.attach({ taskId: task.taskId, pullRequest: linkTo(pull.number), start: true, actorId: personId })
      assert.strictEqual(attached.kind, 'attached')
      assert.strictEqual(git(task.worktree, 'rev-parse', 'HEAD'), head)
      // Its own branch keeps its name: the pull request's is another.
      assert.strictEqual(git(task.worktree, 'branch', '--show-current'), task.branch)
      assert.notStrictEqual(task.branch, 'fix-send-back')

      // Its card shows that pull request, which Althar listens to.
      const [card] = yield* until(cardOf(projectId, task.taskId), (all) => all[0]?.change != null)
      assert.strictEqual(card?.change?.url, 'https://github.com/meridian/api/pull/1')
      assert.isTrue(card?.change?.listening)

      // What a reviewer says on it arrives in the task's thread.
      github.commentAs(pull.number, 'dana', 'Say why it restarts.', { path: 'send.ts', line: 1 })
      const heard = yield* until(
        Effect.map(items(task.threadId), (all) => all.filter((item) => item.kind === 'arrival').map((item) => item.content)),
        (all) => all.some((arrival) => arrival.from === 'dana'),
      )
      assert.deepInclude(
        heard.find((arrival) => arrival.from === 'dana'),
        { kind: 'comment', where: 'PR #1', path: 'send.ts' },
      )

      // Its lead reads it and replies on it.
      assert.include(yield* changes.read(task.taskId), 'Say why it restarts.')
      yield* changes.reply(task.taskId, { body: 'It restarts the lead it sent back to.', threadId: null, by: null })
      assert.isTrue(github.commentsOn(pull.number).some((comment) => comment.body.startsWith('It restarts the lead')))

      // Publishing pushes its branch onto the pull request's, a fast-forward, and opens nothing else.
      commit(task.worktree, 'why.md', 'It restarts.\n')
      const [published] = yield* changes.publish({ projectId, taskId: task.taskId, runId: 'run_none', end: 'draft' })
      assert.strictEqual(published?.kind, 'opened')
      assert.isTrue(published?.kind === 'opened' && published.attached === true)
      assert.strictEqual(tipOf(bare, 'fix-send-back'), git(task.worktree, 'rev-parse', 'HEAD'))
      assert.isNull(tipOf(bare, task.branch))
      assert.lengthOf(github.changes, 1)

      // Again, with nothing new: still the one pull request, no `-2` branch.
      yield* changes.publish({ projectId, taskId: task.taskId, runId: 'run_none', end: 'draft' })
      assert.lengthOf(github.changes, 1)
      assert.strictEqual(git(task.worktree, 'branch', '--show-current'), task.branch)
      assert.notInclude(git(bare, 'branch', '--list'), `${task.branch}-2`)
      const sql = yield* SqlClient.SqlClient
      const opened = yield* sql<{ n: number }>`SELECT count(*) AS n FROM external_links WHERE task_id = ${task.taskId} AND kind = 'change'`
      assert.strictEqual(opened[0]?.n, 1)
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('says so, and forces nothing, where its branch wouldn’t fast-forward the pull request’s', () => {
    const { bare, github, pull, working } = forked()
    return Effect.gen(function* () {
      const { projectId, task, personId } = yield* project(working)
      const changes = yield* Changes
      yield* changes.attach({ taskId: task.taskId, pullRequest: `#${pull.number}`, start: true, actorId: personId })
      // Someone pushes to the pull request's branch from elsewhere; the task commits something else.
      const elsewhere = mkdtempSync(join(tmpdir(), 'althar-elsewhere-'))
      git(elsewhere, 'clone', '-q', '-b', 'fix-send-back', bare, '.')
      const theirs = commit(elsewhere, 'theirs.md', 'Theirs.\n')
      git(elsewhere, 'push', '-q', 'origin', 'fix-send-back')
      commit(task.worktree, 'mine.md', 'Mine.\n')
      const refused = yield* Effect.flip(changes.publish({ projectId, taskId: task.taskId, runId: 'run_none', end: 'draft' }))
      assert.strictEqual((refused as { _tag?: string })._tag, 'PushRefused')
      assert.strictEqual((refused as { why?: string }).why, 'behind')
      assert.strictEqual(tipOf(bare, 'fix-send-back'), theirs)
      assert.lengthOf(github.changes, 1)
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('asks the person to push to the pull request’s own branch when its lead asks, and their Push sends it there', () => {
    const { bare, github, pull, working } = forked()
    return Effect.gen(function* () {
      const { projectId, task, personId } = yield* project(working)
      const changes = yield* Changes
      yield* changes.attach({ taskId: task.taskId, pullRequest: linkTo(pull.number), start: true, actorId: personId })
      const lead: ToolAccess = { role: 'lead', projectId, threadId: task.threadId, sessionId: 'none', taskId: task.taskId }
      // Nothing new on it yet: the pull request's branch is read under its own name, not the task's.
      assert.strictEqual(
        yield* callTool(lead, 'push_to_pull_request', {}),
        "PR #1 already has every commit on the branch, so there's nothing new to push.",
      )
      const mine = commit(task.worktree, 'why.md', 'It restarts.\n')
      assert.include(yield* callTool(lead, 'push_to_pull_request', {}), 'Asked the person to push 1 commit to PR #1.')
      const [card] = yield* until(
        Effect.map(items(task.threadId), (all) => all.filter((item) => item.kind === 'push_request').map((item) => item.content)),
        (all) => all.length === 1,
      )
      assert.deepInclude(card, { where: 'PR #1', count: 1, head: mine })
      assert.strictEqual(tipOf(bare, 'fix-send-back'), git(task.worktree, 'rev-parse', 'HEAD~1'))

      // The person's Push sends it onto the pull request's branch; none of the task's name is made.
      yield* changes.push(task.taskId, mine, 'https://github.com/meridian/api/pull/1')
      assert.strictEqual(tipOf(bare, 'fix-send-back'), mine)
      assert.isNull(tipOf(bare, task.branch))
      assert.lengthOf(github.changes, 1)
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('leaves a pull request to the task whose work still goes to it, even once it stops listening', () => {
    const { github, pull, working } = forked()
    return Effect.gen(function* () {
      const { projectId, task, personId } = yield* project(working)
      const changes = yield* Changes
      yield* changes.attach({ taskId: task.taskId, pullRequest: `#${pull.number}`, start: true, actorId: personId })
      yield* changes.stopListening(task.taskId, 'https://github.com/meridian/api/pull/1')
      const other = yield* (yield* Projects).createTask({
        envelope: yield* Runtime.envelope('task.create', { title: 'Answer it again' }),
        projectId,
        title: 'Answer it again',
      })
      const refused = yield* Effect.flip(
        changes.attach({ taskId: other.taskId, pullRequest: `#${pull.number}`, start: true, actorId: personId }),
      )
      assert.strictEqual(
        (refused as { message?: string }).message,
        `Task ${task.slug}’s work goes to PR #1. Abandon it first, or leave PR #1 to it.`,
      )
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('lets another task attach a pull request reopened after the one attached to it saw it closed', () => {
    const { github, pull, working } = forked()
    return Effect.gen(function* () {
      const { projectId, task, personId } = yield* project(working)
      const changes = yield* Changes
      yield* changes.attach({ taskId: task.taskId, pullRequest: `#${pull.number}`, start: true, actorId: personId })
      // Closed, and seen closed: the first task publishes elsewhere from then on, so it doesn't keep it once it reopens.
      github.close(pull.number)
      yield* changes.refresh(task.taskId)
      yield* until(changes.ofTask(task.taskId), (all) => all.some((one) => one.state === 'closed' && !one.listening))
      github.reopen(pull.number)
      const other = yield* (yield* Projects).createTask({
        envelope: yield* Runtime.envelope('task.create', { title: 'Answer it again' }),
        projectId,
        title: 'Answer it again',
      })
      const done = yield* changes.attach({ taskId: other.taskId, pullRequest: `#${pull.number}`, start: true, actorId: personId })
      assert.strictEqual(done.kind, 'attached')
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('takes a link only on the host the task’s repository is on, not one of the same path on another', () => {
    const { github, pull, working } = forked()
    return Effect.gen(function* () {
      const { task, personId } = yield* project(working)
      yield* (yield* Connections).connectToken({ product: 'github', token: 't2', actorId: personId, webUrl: 'https://ghe.test' })
      const changes = yield* Changes
      const refused = yield* Effect.flip(
        changes.attach({
          taskId: task.taskId,
          pullRequest: `https://ghe.test/meridian/api/pull/${pull.number}`,
          start: true,
          actorId: personId,
        }),
      )
      assert.strictEqual(
        (refused as { message?: string }).message,
        'That pull request is on meridian/api, which isn’t one of the task’s repositories.',
      )
      assert.lengthOf(yield* changes.ofTask(task.taskId), 0)
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('keeps the task’s own commits on top of the head it starts from', () => {
    const { github, head, working } = forked()
    return Effect.gen(function* () {
      const { task, personId } = yield* project(working)
      const changes = yield* Changes
      const mine = commit(task.worktree, 'mine.md', 'Mine.\n')
      const asked = yield* changes.attach({ taskId: task.taskId, pullRequest: '#1', actorId: personId })
      assert.deepInclude(asked, { kind: 'start', own: 1 })
      const attached = yield* changes.attach({ taskId: task.taskId, pullRequest: '#1', start: true, actorId: personId })
      assert.deepInclude(attached, { kind: 'attached', started: true, kept: 1 })
      assert.strictEqual(git(task.worktree, 'rev-parse', 'HEAD~1'), head)
      assert.include(git(task.worktree, 'ls-tree', '--name-only', 'HEAD'), 'mine.md')
      // What it was on is kept.
      assert.strictEqual(git(task.worktree, 'rev-parse', `refs/althar/before-attach/${task.branch}`), mine)
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('refuses a closed pull request, and one whose branch is on someone else’s fork', () => {
    const closed = forked({ state: 'closed' })
    return Effect.gen(function* () {
      const { task, personId } = yield* project(closed.working)
      const changes = yield* Changes
      const refused = yield* Effect.flip(changes.attach({ taskId: task.taskId, pullRequest: '#1', start: true, actorId: personId }))
      assert.strictEqual((refused as { message?: string }).message, 'PR #1 is closed: only an open one can be attached.')
    })
      .pipe(Effect.provide(withQueries(closed.github)))
      .pipe(
        Effect.andThen(() => {
          const theirs = forked({ fork: ['dana', 'api'] })
          return Effect.gen(function* () {
            const { task, personId } = yield* project(theirs.working)
            const refused = yield* Effect.flip(
              (yield* Changes).attach({ taskId: task.taskId, pullRequest: '#1', start: true, actorId: personId }),
            )
            assert.include((refused as { message?: string }).message, 'is on dana/api, which this task doesn’t push to')
          }).pipe(Effect.provide(withQueries(theirs.github)))
        }),
      )
  })

  it.live('reads where the branch is on a host without reviews too, and refuses where the host doesn’t say', () => {
    // An outsider's fork's branch, on a host that reads no changes to review, as GitLab and Bitbucket don't.
    const theirs = forked({ fork: ['dana', 'api'], host: { reviews: false } })
    return Effect.gen(function* () {
      const { task, personId } = yield* project(theirs.working)
      const refused = yield* Effect.flip(
        (yield* Changes).attach({ taskId: task.taskId, pullRequest: '#1', start: true, actorId: personId }),
      )
      assert.include((refused as { message?: string }).message, 'is on dana/api, which this task doesn’t push to')
      assert.isNull(tipOf(theirs.bare, task.branch))
    })
      .pipe(Effect.provide(withQueries(theirs.github)))
      .pipe(
        Effect.andThen(() => {
          const unsaid = forked({ host: { reviews: false, saysHead: false } })
          return Effect.gen(function* () {
            const { task, personId } = yield* project(unsaid.working)
            const changes = yield* Changes
            const refused = yield* Effect.flip(changes.attach({ taskId: task.taskId, pullRequest: '#1', start: true, actorId: personId }))
            assert.strictEqual(
              (refused as { message?: string }).message,
              'The host doesn’t say where PR #1’s branch is, so Althar can’t tell it’s one this task pushes to.',
            )
            assert.lengthOf(yield* changes.ofTask(task.taskId), 0)
          }).pipe(Effect.provide(withQueries(unsaid.github)))
        }),
      )
  })

  it.live('gives a pull request two tasks attach at once to one of them only', () => {
    const { github, pull, working } = forked()
    return Effect.gen(function* () {
      const { projectId, task, personId } = yield* project(working)
      const changes = yield* Changes
      const other = yield* (yield* Projects).createTask({
        envelope: yield* Runtime.envelope('task.create', { title: 'Answer it again' }),
        projectId,
        title: 'Answer it again',
      })
      const both = yield* Effect.all(
        [task.taskId, other.taskId].map((taskId) =>
          Effect.exit(changes.attach({ taskId, pullRequest: `#${pull.number}`, start: true, actorId: personId })),
        ),
        { concurrency: 'unbounded' },
      )
      assert.lengthOf(both.filter(Exit.isSuccess), 1)
      const followed = [...(yield* changes.ofTask(task.taskId)), ...(yield* changes.ofTask(other.taskId))]
      assert.lengthOf(followed, 1)
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('refuses, saying why, where a worktree with no branch yet has one of the task’s branch’s name left from before', () => {
    const { bare, github, pull, working } = forked()
    return Effect.gen(function* () {
      const { task, personId } = yield* project(working)
      const sql = yield* SqlClient.SqlClient
      // On the head already, with no branch of its own yet; one of its name left there, elsewhere.
      const left = git(task.worktree, 'rev-parse', task.branch)
      git(task.worktree, 'fetch', '-q', bare, 'fix-send-back')
      git(task.worktree, 'checkout', '-q', '--detach', 'FETCH_HEAD')
      yield* sql`UPDATE workspaces SET branched_at = NULL WHERE task_id = ${task.taskId}`
      const changes = yield* Changes
      const refused = yield* Effect.flip(
        changes.attach({ taskId: task.taskId, pullRequest: `#${pull.number}`, start: true, actorId: personId }),
      )
      assert.strictEqual((refused as { _tag?: string })._tag, 'AttachRefused')
      assert.strictEqual(
        (refused as { message?: string }).message,
        `A branch called ${task.branch} is in its repository already, from before. Delete or rename it, then attach PR #1.`,
      )
      assert.strictEqual(git(task.worktree, 'rev-parse', task.branch), left)
      assert.lengthOf(yield* changes.ofTask(task.taskId), 0)
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('is the coordinator’s to do too, asking the person before it starts a branch over; and it finds upstream’s pull requests', () => {
    const { github, head, working } = forked()
    return Effect.gen(function* () {
      const { task, coordinator } = yield* project(working)
      // Upstream's pull requests are listed, first, beside the fork's.
      const found = yield* callTool(coordinator, 'find_pull_requests', {})
      assert.include(found, 'Open pull requests in meridian/api, newest change first:')
      assert.include(found, '#1 "Send back won’t restart a dead lead" by you')
      assert.include(found, 'you/api: no open pull requests match.')
      assert.isBelow(found.indexOf('meridian/api'), found.indexOf('you/api'))

      const asked = yield* callTool(coordinator, 'attach_pull_request', { task: task.slug, pull_request: '#1' })
      assert.include(asked, 'Nothing changed yet')
      assert.include(asked, 'start_from_head: true')
      const done = yield* callTool(coordinator, 'attach_pull_request', { task: task.slug, pull_request: '#1', start_from_head: true })
      assert.include(done, `${task.slug} follows PR #1 now`)
      assert.strictEqual(git(task.worktree, 'rev-parse', 'HEAD'), head)
      assert.include(yield* callTool(coordinator, 'find_pull_requests', {}), `task ${task.slug} follows it`)

      // Another task can't take it while this one follows it.
      const drafted = yield* callTool(coordinator, 'draft_task', { title: 'Answer it again', pull_request: '#1' })
      assert.include(drafted, `Task ${task.slug} follows PR #1 already`)
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('starts a task drafted for a pull request on its head', () => {
    const { github, head, working } = forked()
    return Effect.gen(function* () {
      const { projectId, coordinator } = yield* project(working)
      const drafted = yield* callTool(coordinator, 'draft_task', {
        title: 'Answer the review on #1',
        description: 'Answer what dana asked.',
        pull_request: linkTo(1),
      })
      assert.include(drafted, "on that pull request's head")
      const sql = yield* SqlClient.SqlClient
      const [workspace] = yield* sql<{ path: string; taskId: string }>`
        SELECT w.path, w.task_id FROM workspaces w JOIN tasks k ON k.id = w.task_id
        WHERE k.project_id = ${projectId} AND k.title = 'Answer the review on #1'`
      assert.strictEqual(git(workspace?.path ?? '', 'rev-parse', 'HEAD'), head)
      const [change] = yield* (yield* Changes).ofTask(workspace?.taskId ?? '')
      assert.strictEqual(change?.url, 'https://github.com/meridian/api/pull/1')
    }).pipe(Effect.provide(withQueries(github)))
  })
})

describe('attaching a task to a pull request, refused', () => {
  /** What attaching the task to the pull request named says, where it is refused. */
  const refusalOf = (taskId: string, pullRequest: string, personId: Parameters<Changes['Service']['attach']>[0]['actorId']) =>
    Effect.gen(function* () {
      const refused = yield* Effect.flip((yield* Changes).attach({ taskId, pullRequest, start: true, actorId: personId }))
      return (refused as { readonly message?: string }).message
    })

  it.live('says what it needs where the pull request named isn’t one it can find, and what the host said', () => {
    const { github, working } = forked()
    return Effect.gen(function* () {
      const { task, personId } = yield* project(working)
      const refused = (pullRequest: string) => refusalOf(task.taskId, pullRequest, personId)
      assert.strictEqual(yield* refused('the one Dana opened'), 'Give the pull request’s link, or its number: #123.')
      assert.strictEqual(yield* refused('#99'), 'That pull request isn’t there, or Althar’s sign-in can’t see it.')
      github.failNext('change', 'forbidden')
      assert.strictEqual(yield* refused('#1'), 'The host said: The fake change failed (forbidden)')
      assert.strictEqual(yield* refused(`${HOST}/meridian/api/issues/3`), 'That link isn’t to a pull request.')
      assert.strictEqual(
        yield* refused('https://gitlab.example/meridian/api/-/merge_requests/1'),
        'Althar isn’t connected to where that link points. Connect its host in Settings, then attach it.',
      )
      assert.strictEqual(
        yield* refused(`${HOST}/acme/tools/pull/4`),
        'That pull request is on acme/tools, which isn’t one of the task’s repositories.',
      )
      assert.lengthOf(yield* (yield* Changes).ofTask(task.taskId), 0)
      // A task there isn't, isn't found.
      assert.instanceOf(
        yield* Effect.flip((yield* Changes).attach({ taskId: 'task_none', pullRequest: '#1', start: true, actorId: personId })),
        NotFound,
      )
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('only for an open task whose repository is on a connected host', () => {
    const { github, working } = forked()
    return Effect.gen(function* () {
      const { projectId, task, personId } = yield* project(working)
      const tasks = yield* Tasks
      yield* tasks.abandon({ envelope: yield* Runtime.envelope('task.abandon', { taskId: task.taskId }), taskId: task.taskId })
      assert.strictEqual(yield* refusalOf(task.taskId, '#1', personId), 'The task is abandoned: only an open one follows a pull request.')
      const other = yield* (yield* Projects).createTask({
        envelope: yield* Runtime.envelope('task.create', { title: 'Answer it' }),
        projectId,
        title: 'Answer it',
      })
      const connections = yield* Connections
      const [connection] = yield* connections.list
      yield* connections.remove(connection?.id ?? '', personId)
      assert.strictEqual(
        yield* refusalOf(other.taskId, '#1', personId),
        'The task’s repository isn’t on a code host Althar is connected to. Connect it in Settings.',
      )
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('where its branch is on a fork that is gone, or can’t be fetched', () => {
    const gone = forked({ fork: [] })
    return Effect.gen(function* () {
      const { task, personId } = yield* project(gone.working)
      assert.strictEqual(yield* refusalOf(task.taskId, '#1', personId), 'PR #1’s branch was on a fork that is gone.')
    })
      .pipe(Effect.provide(withQueries(gone.github)))
      .pipe(
        Effect.andThen(() => {
          const away = forked()
          // Deleted on the fork since: there's nothing to fetch.
          git(away.bare, 'branch', '-q', '-D', 'fix-send-back')
          return Effect.gen(function* () {
            const { task, personId } = yield* project(away.working)
            assert.strictEqual(
              yield* refusalOf(task.taskId, '#1', personId),
              'Althar couldn’t fetch PR #1’s branch, fix-send-back, from you/api.',
            )
          }).pipe(Effect.provide(withQueries(away.github)))
        }),
      )
  })

  it.live('leaves the task’s branch as it was where starting it from the head would lose what isn’t committed, or conflict', () => {
    const { github, working } = forked()
    return Effect.gen(function* () {
      const { task, personId } = yield* project(working)
      const before = git(task.worktree, 'rev-parse', 'HEAD')
      writeFileSync(join(task.worktree, 'notes.md'), 'not committed\n')
      assert.strictEqual(
        yield* refusalOf(task.taskId, '#1', personId),
        'What isn’t committed in its worktree would be lost: notes.md. Commit it or drop it, then attach PR #1.',
      )
      assert.strictEqual(git(task.worktree, 'rev-parse', 'HEAD'), before)
      // Its own commit changes the head's file otherwise: they conflict.
      git(task.worktree, 'clean', '-q', '-f')
      const mine = commit(task.worktree, 'send.ts', 'export const sendBack = () => 2\n')
      assert.strictEqual(
        yield* refusalOf(task.taskId, '#1', personId),
        'The task’s own commits conflict with PR #1’s head in send.ts, so its branch stays as it was.',
      )
      assert.strictEqual(git(task.worktree, 'rev-parse', 'HEAD'), mine)
      assert.strictEqual(git(task.worktree, 'branch', '--show-current'), task.branch)
      assert.strictEqual(git(task.worktree, 'status', '--porcelain'), '')
      assert.lengthOf(yield* (yield* Changes).ofTask(task.taskId), 0)
    }).pipe(Effect.provide(withQueries(github)))
  })
})

describe('attaching a task to a pull request its branch can follow as it is', () => {
  it.live('follows one its worktree has already, a draft too, starting its branch there where it had none', () => {
    const { bare, github, head, working } = forked()
    // A draft from the same branch, as the person opened it to say it isn't ready.
    const draft = github.addPullRequest({
      path: ['meridian', 'api'],
      title: 'Send back, not ready',
      author: 'you',
      source: 'fix-send-back',
      headSha: head,
      fork: ['you', 'api'],
      draft: true,
    })
    return Effect.gen(function* () {
      const { projectId, task, personId } = yield* project(working)
      // On the head already, with no branch of its own yet, and none of its name left from before.
      git(task.worktree, 'fetch', '-q', bare, 'fix-send-back')
      git(task.worktree, 'checkout', '-q', '--detach', 'FETCH_HEAD')
      git(task.worktree, 'branch', '-q', '-D', task.branch)
      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE workspaces SET branched_at = NULL WHERE task_id = ${task.taskId}`
      const changes = yield* Changes
      // Nothing to start over: it follows at once, without being told to.
      const attached = yield* changes.attach({ taskId: task.taskId, pullRequest: `#${draft.number}`, actorId: personId })
      assert.deepInclude(attached, { kind: 'attached', started: false, kept: 0 })
      assert.strictEqual(git(task.worktree, 'branch', '--show-current'), task.branch)
      assert.strictEqual(git(task.worktree, 'rev-parse', 'HEAD'), head)
      const [workspace] = yield* sql<{
        branched: number
      }>`SELECT branched_at IS NOT NULL AS branched FROM workspaces WHERE task_id = ${task.taskId}`
      assert.strictEqual(workspace?.branched, 1)
      const [card] = yield* until(cardOf(projectId, task.taskId), (all) => all[0]?.change != null)
      assert.deepInclude(card?.change, { number: draft.number, draft: true })
      const notice = (yield* items(task.threadId)).find((item) => item.kind === 'notice')
      assert.strictEqual(notice?.content.title, `The task follows PR #${draft.number} now: Send back, not ready`)
      assert.strictEqual(
        notice?.content.description,
        'Its work goes to PR #2’s branch, fix-send-back, on you/api, as a plain push: nothing opens another.',
      )
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('follows one again that it stopped listening to', () => {
    const { github, pull, working } = forked()
    return Effect.gen(function* () {
      const { task, personId } = yield* project(working)
      const changes = yield* Changes
      yield* changes.attach({ taskId: task.taskId, pullRequest: `#${pull.number}`, start: true, actorId: personId })
      yield* changes.stopListening(task.taskId, 'https://github.com/meridian/api/pull/1')
      assert.isFalse((yield* changes.ofTask(task.taskId))[0]?.listening)
      const again = yield* changes.attach({ taskId: task.taskId, pullRequest: `#${pull.number}`, start: true, actorId: personId })
      assert.strictEqual(again.kind, 'attached')
      const followed = yield* changes.ofTask(task.taskId)
      assert.lengthOf(followed, 1)
      assert.isTrue(followed[0]?.listening)
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('doesn’t start its branch over while its lead is at work in it', () => {
    const { github, pull, working } = forked()
    return Effect.gen(function* () {
      const { task, personId } = yield* project(working)
      const before = git(task.worktree, 'rev-parse', 'HEAD')
      yield* (yield* Sessions).start({ threadId: task.threadId, agentId: 'codex' })
      const refused = yield* Effect.flip(
        (yield* Changes).attach({ taskId: task.taskId, pullRequest: `#${pull.number}`, start: true, actorId: personId }),
      )
      assert.strictEqual(
        (refused as { message?: string }).message,
        'Its lead is at work in its worktree. Stop it, or wait for its turn to end, then attach PR #1.',
      )
      assert.strictEqual(git(task.worktree, 'rev-parse', 'HEAD'), before)
    }).pipe(Effect.provide(withQueries(github)))
  })
})
