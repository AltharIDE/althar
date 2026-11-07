import { renameSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { afterEach } from 'vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import type { ChangeTarget, ProjectId } from '@althar/domain'
import { baseBranch, forgetTold, forkOf, tell, workRemotes } from '../src/forks'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { ask, cards, connect, git, pushByHand, runtimeWith } from './changesSupport'
import { HOST, hosted, pushLog, until } from './support'

/*
 * Where a fork's tasks' branches go (ADR-085): the fork, until the project
 * says the repository it was forked from, which the host must say the person
 * can push to. What is open stays where it is: a pull request already open from
 * the fork takes its commits on the fork, whatever the project says now. Here
 * the fork and the repository it came from are two bare repositories, so a
 * test sees which a branch reached.
 */

const BRANCH = 'althar/add-a-retry'
const FORK = ['you', 'api']
const UPSTREAM = ['meridian', 'api']

/** Whether a bare repository has a branch. */
const hasBranch = (bare: string, branch = BRANCH) => {
  try {
    execFileSync('git', ['rev-parse', '--verify', '-q', `refs/heads/${branch}`], { cwd: bare, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** A fork's clone, with `origin` the fork and `upstream` the repository it came from, each a bare repository of its own. */
const forkClone = (
  options: {
    readonly canPush?: boolean
    readonly upstreamDefault?: string
    readonly saysHead?: boolean
    /** What the host says the pull request's head is, where not the commit its branch on the fork is at. */
    readonly headOf?: () => string | undefined
    /** What the clone calls the repository it came from; and whether its host says the fork is one of that repository. */
    readonly parent?: string
    readonly saysParent?: boolean
  } = {},
) => {
  const { working, bare: fork } = hosted(FORK)
  git(working, 'remote', 'add', options.parent ?? 'upstream', `${HOST}/${UPSTREAM.join('/')}.git`)
  git(working, 'config', 'user.name', 'Fake')
  git(working, 'config', 'user.email', 'fake@althar.test')
  const upstream = mkdtempSync(join(tmpdir(), 'althar-remote-'))
  git(upstream, 'init', '-q', '--bare', '-b', 'main')
  git(working, 'push', '-q', upstream, 'main')
  // What took a push, not what Althar fetched from: it fetches the branch a pull request goes into to look for conflicts.
  const pushes = pushLog()
  pushes.watch(fork, FORK.join('/'))
  pushes.watch(upstream, UPSTREAM.join('/'))
  const github = makeFakeService({
    ...(options.saysHead === undefined ? {} : { saysHead: options.saysHead }),
    headOf: () => options.headOf?.() ?? (hasBranch(fork) ? git(fork, 'rev-parse', BRANCH) : null),
    pushUrl: (path) => (path.join('/') === UPSTREAM.join('/') ? upstream : fork),
  })
  github.addRepository(FORK)
  github.addRepository(UPSTREAM, options.upstreamDefault)
  github.letPush(UPSTREAM, options.canPush ?? true)
  if (options.saysParent === true) {
    github.forkFrom(FORK, UPSTREAM)
    // As reading the project's repositories asked it, before the person chose where its work goes.
    tell(`${HOST}/${FORK.join('/')}.git`, { path: UPSTREAM }, Date.now())
  }
  return { working, fork, upstream, pushedTo: pushes.pushedTo, github }
}

/** The clone opened as a project, connected, with where its work goes set as `target`. */
const opened = (working: string, target: ChangeTarget) =>
  Effect.gen(function* () {
    yield* connect('github', HOST)
    const projects = yield* Projects
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const [repository] = yield* projects.repositories(project.projectId)
    const repositoryId = repository?.id ?? ''
    yield* projects.setRepository({ projectId: project.projectId, repositoryId, changeTarget: target })
    return {
      projectId: project.projectId,
      /** Where the project's next tasks' work goes, from now on. */
      send: (next: ChangeTarget) => projects.setRepository({ projectId: project.projectId, repositoryId, changeTarget: next }),
    }
  })

const TASK = '[coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]'

/** A task through to its pull request, with where its worktree is. */
const taskToPullRequest = (working: string, body = `Add a retry. ${TASK}`) =>
  Effect.gen(function* () {
    const projectId = yield* ask(working, body, pushByHand)
    const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready' && all[0]?.change != null)
    const taskId = ready?.taskId ?? ''
    const [workspace] = yield* (yield* SqlClient.SqlClient)<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${taskId}`
    return { projectId, taskId, here: workspace?.path ?? '', url: ready?.change?.url }
  })

/** One more commit on the task's branch, sent by the Push button: it goes where its pull request's branch is. */
const pushOneMore = (projectId: string, taskId: string, here: string, subject: string) =>
  Effect.gen(function* () {
    git(here, 'commit', '-q', '--allow-empty', '-m', subject)
    const [seen] = yield* until(cards(projectId), (all) => all[0]?.change?.unpushed === 1)
    yield* (yield* Changes).push(taskId, seen?.change?.localHead ?? '')
  })

describe('where a fork’s tasks’ branches go', () => {
  afterEach(() => forgetTold())

  it.live('opens its pull request on the repository its host says it came from, the clone calling it base', () => {
    const { working, fork, upstream, pushedTo, github } = forkClone({ parent: 'base', saysParent: true })
    return Effect.gen(function* () {
      yield* opened(working, 'upstream')
      const { url } = yield* taskToPullRequest(working)
      assert.strictEqual(url, 'https://github.com/meridian/api/pull/1')
      assert.strictEqual(github.forkOf(1), FORK.join('/'))
      assert.deepStrictEqual(pushedTo(), [FORK.join('/')])
      assert.isTrue(hasBranch(fork))
      assert.isFalse(hasBranch(upstream))
      // Its remotes are as the person left them.
      assert.deepStrictEqual(git(working, 'remote').split('\n'), ['base', 'origin'])
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('pushes its branches to that repository by that name, where the person chose that and can', () => {
    const { working, fork, upstream, pushedTo, github } = forkClone({ parent: 'base', saysParent: true })
    return Effect.gen(function* () {
      yield* opened(working, 'upstream_branch')
      const { url } = yield* taskToPullRequest(working)
      assert.strictEqual(url, 'https://github.com/meridian/api/pull/1')
      assert.isNull(github.forkOf(1))
      assert.deepStrictEqual(pushedTo(), [UPSTREAM.join('/')])
      assert.isTrue(hasBranch(upstream))
      assert.isFalse(hasBranch(fork))
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('without access, a project still set to push there keeps its branches on the fork, its pull requests where they were', () => {
    const { working, fork, upstream, pushedTo, github } = forkClone({ canPush: false })
    return Effect.gen(function* () {
      // Set while the person could; the host says now they can't.
      yield* opened(working, 'upstream_branch')
      const { url } = yield* taskToPullRequest(working)
      assert.strictEqual(url, 'https://github.com/meridian/api/pull/1')
      assert.strictEqual(github.forkOf(1), FORK.join('/'))
      assert.deepStrictEqual(pushedTo(), [FORK.join('/')])
      assert.isTrue(hasBranch(fork))
      assert.isFalse(hasBranch(upstream))
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('with access and the setting on, a new task pushes to the repository it came from and opens its pull request there', () => {
    const { working, fork, upstream, pushedTo, github } = forkClone({ upstreamDefault: 'trunk' })
    return Effect.gen(function* () {
      yield* opened(working, 'upstream_branch')
      const { url, projectId, taskId, here } = yield* taskToPullRequest(working)
      assert.strictEqual(url, 'https://github.com/meridian/api/pull/1')
      // A branch of its own there: no fork in it, into that repository's default branch.
      assert.isNull(github.forkOf(1))
      assert.strictEqual(github.changes[0]?.source, BRANCH)
      assert.strictEqual(github.changes[0]?.target, 'trunk')
      assert.deepStrictEqual(pushedTo(), [UPSTREAM.join('/')])
      assert.isTrue(hasBranch(upstream))
      assert.isFalse(hasBranch(fork))
      // Its next commits go there too.
      yield* pushOneMore(projectId, taskId, here, 'One more')
      assert.strictEqual(git(upstream, 'log', '-1', '--format=%s', BRANCH), 'One more')
      assert.isFalse(hasBranch(fork))
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live(
    'keeps a pull request open from the fork on the fork after switching, with no new branch upstream; the next task goes upstream',
    () => {
      const { working, fork, upstream, pushedTo, github } = forkClone()
      return Effect.gen(function* () {
        const { send } = yield* opened(working, 'upstream')
        const { projectId, taskId, here } = yield* taskToPullRequest(working)
        assert.strictEqual(github.forkOf(1), FORK.join('/'))
        yield* send('upstream_branch')

        yield* pushOneMore(projectId, taskId, here, 'One more')
        assert.strictEqual(git(fork, 'log', '-1', '--format=%s', BRANCH), 'One more')
        assert.isFalse(hasBranch(upstream), 'no stray branch for the open pull request')
        assert.lengthOf(github.changes, 1)
        assert.notInclude(pushedTo(), UPSTREAM.join('/'))

        yield* ask(working, `Add a limit. ${TASK}`, pushByHand)
        yield* until(
          Effect.sync(() => github.changes),
          (all) => all.length === 2,
        )
        assert.strictEqual(github.changes[1]?.url, 'https://github.com/meridian/api/pull/2')
        assert.isNull(github.forkOf(2))
        assert.isTrue(hasBranch(upstream, github.changes[1]?.source ?? ''))
        assert.isFalse(hasBranch(fork, github.changes[1]?.source ?? ''))
      }).pipe(Effect.provide(runtimeWith({ github })))
    },
  )

  it.live('switching back sends the next task to the fork, and leaves one open upstream where it is', () => {
    const { working, fork, upstream, github } = forkClone()
    return Effect.gen(function* () {
      const { send } = yield* opened(working, 'upstream_branch')
      const { projectId, taskId, here } = yield* taskToPullRequest(working)
      assert.isNull(github.forkOf(1))
      yield* send('upstream')

      yield* pushOneMore(projectId, taskId, here, 'One more')
      assert.strictEqual(git(upstream, 'log', '-1', '--format=%s', BRANCH), 'One more')
      assert.isFalse(hasBranch(fork))

      yield* ask(working, `Add a limit. ${TASK}`, pushByHand)
      yield* until(
        Effect.sync(() => github.changes),
        (all) => all.length === 2,
      )
      assert.strictEqual(github.forkOf(2), FORK.join('/'))
      assert.isTrue(hasBranch(fork, github.changes[1]?.source ?? ''))
      assert.isFalse(hasBranch(upstream, github.changes[1]?.source ?? ''))
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('never pushes onto the default branch of the repository it came from', () => {
    // That repository's default branch is named as the task's would be.
    const { working, fork, upstream, github } = forkClone({ upstreamDefault: BRANCH })
    return Effect.gen(function* () {
      yield* opened(working, 'upstream_branch')
      const projectId = yield* ask(working, `Add a retry. ${TASK}`, pushByHand)
      const sql = yield* SqlClient.SqlClient
      const [card] = yield* until(cards(projectId), (all) => all.length === 1)
      // The run stops at publishing, and asks the person.
      const [call] = yield* until(
        sql<{ payload: string }>`SELECT payload FROM attention_requests WHERE task_id = ${card?.taskId ?? ''} AND kind = 'stuck'`,
        (all) => all.length === 1,
      )
      assert.include(call?.payload, '"step":"publish"')
      assert.isFalse(hasBranch(upstream))
      assert.isFalse(hasBranch(fork))
      assert.lengthOf(github.changes, 0)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

describe('a clone whose remotes were renamed by hand', () => {
  it('sends its work to origin, not to the fork that sorts first by name', () => {
    const named = [
      { name: 'fork', url: `${HOST}/you/api.git` },
      { name: 'origin', url: `${HOST}/meridian/api.git` },
    ]
    assert.isNull(forkOf(named))
    assert.deepStrictEqual(workRemotes(named, [`${HOST}/you/api.git`, `${HOST}/meridian/api.git`]), [
      `${HOST}/meridian/api.git`,
      `${HOST}/you/api.git`,
    ])
    // No origin at all: what it was added with.
    assert.deepStrictEqual(workRemotes([{ name: 'fork', url: 'a' }], ['a', 'b']), ['a', 'b'])
  })

  it('opens a task started before the rename into that branch, not one called upstream/main', () => {
    assert.strictEqual(baseBranch('upstream/main', false), 'main')
    assert.strictEqual(baseBranch('origin/main', false), 'main')
    assert.strictEqual(baseBranch('main', false), 'main')
    // A branch of this clone's that is called that stays as it is.
    assert.strictEqual(baseBranch('upstream/next', true), 'upstream/next')
  })

  it.live('keeps a pull request open from the fork on the fork, and opens new ones as a normal project', () => {
    const { working, fork, upstream, pushedTo, github } = forkClone()
    return Effect.gen(function* () {
      yield* opened(working, 'upstream')
      const { projectId, taskId, here } = yield* taskToPullRequest(working)
      assert.strictEqual(github.forkOf(1), FORK.join('/'))

      // The person renames them: the repository it came from is origin now, and the fork is `fork`.
      git(working, 'remote', 'rename', 'origin', 'fork')
      git(working, 'remote', 'rename', 'upstream', 'origin')
      assert.deepStrictEqual(pushedTo(), [FORK.join('/')])

      yield* pushOneMore(projectId, taskId, here, 'One more')
      assert.strictEqual(git(fork, 'log', '-1', '--format=%s', BRANCH), 'One more')
      assert.isFalse(hasBranch(upstream), 'no new branch upstream for the open pull request')
      assert.lengthOf(github.changes, 1)

      // A new task is a normal project's: a branch of origin's, a pull request there.
      yield* ask(working, `Add a limit. ${TASK}`, pushByHand)
      yield* until(
        Effect.sync(() => github.changes),
        (all) => all.length === 2,
      )
      assert.strictEqual(github.changes[1]?.url, 'https://github.com/meridian/api/pull/2')
      assert.isNull(github.forkOf(2))
      assert.isTrue(hasBranch(upstream, github.changes[1]?.source ?? ''))
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  /** The person renames them: the repository it came from is origin now, and the fork is `fork`. */
  const rename = (working: string) => {
    git(working, 'remote', 'rename', 'origin', 'fork')
    git(working, 'remote', 'rename', 'upstream', 'origin')
  }

  /** The task's next commit, refused by the Push button and by publishing alike, with what each said. */
  const refusedBoth = (projectId: string, taskId: string, here: string) =>
    Effect.gen(function* () {
      const changes = yield* Changes
      git(here, 'commit', '-q', '--allow-empty', '-m', 'One more')
      const pushed = yield* Effect.flip(changes.push(taskId, git(here, 'rev-parse', 'HEAD')))
      const [run] = yield* (yield* SqlClient.SqlClient)<{ id: string }>`SELECT id FROM runs WHERE task_id = ${taskId}`
      const published = yield* Effect.flip(
        changes.publish({ projectId: projectId as ProjectId, taskId, runId: run?.id ?? '', end: 'draft' }),
      )
      return [pushed, published].map((refused) => ({ tag: (refused as { _tag?: string })._tag, why: (refused as { why?: string }).why }))
    })

  it.live('refuses to push a pull request whose fork is gone, rather than make its branch upstream', () => {
    const { working, upstream, github } = forkClone()
    return Effect.gen(function* () {
      yield* opened(working, 'upstream')
      const { projectId, taskId, here } = yield* taskToPullRequest(working)
      rename(working)
      github.loseFork(1)
      const sql = yield* SqlClient.SqlClient
      yield* until(
        sql<{
          head: string
        }>`SELECT json_extract(snapshot, '$.head') AS head FROM external_links WHERE task_id = ${taskId} AND kind = 'change'`,
        (all) => all[0]?.head === '[]',
      )

      assert.deepStrictEqual(yield* refusedBoth(projectId, taskId, here), [
        { tag: 'PushRefused', why: 'fork_gone' },
        { tag: 'PushRefused', why: 'fork_gone' },
      ])
      assert.isFalse(hasBranch(upstream), 'no new branch upstream for the open pull request')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('finds a pull request its host doesn’t place on the fork, where its branch stands at its head', () => {
    const { working, fork, upstream, github } = forkClone({ saysHead: false })
    return Effect.gen(function* () {
      yield* opened(working, 'upstream')
      const { projectId, taskId, here } = yield* taskToPullRequest(working)
      rename(working)

      yield* pushOneMore(projectId, taskId, here, 'One more')
      assert.strictEqual(git(fork, 'log', '-1', '--format=%s', BRANCH), 'One more')
      assert.isFalse(hasBranch(upstream), 'no new branch upstream for the open pull request')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('leaves an unrelated branch of that name upstream alone, though the push would have gone through', () => {
    const { working, fork, upstream, github } = forkClone({ saysHead: false })
    return Effect.gen(function* () {
      yield* opened(working, 'upstream')
      const { projectId, taskId, here } = yield* taskToPullRequest(working)
      rename(working)
      // At a commit the task's is built on, so the plain push isn't refused as behind.
      git(upstream, 'update-ref', `refs/heads/${BRANCH}`, 'refs/heads/main')
      const theirs = git(upstream, 'rev-parse', BRANCH)

      yield* pushOneMore(projectId, taskId, here, 'One more')
      assert.strictEqual(git(fork, 'log', '-1', '--format=%s', BRANCH), 'One more')
      assert.strictEqual(git(upstream, 'rev-parse', BRANCH), theirs)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('refuses a pull request its branch could be either of two for, each at its head', () => {
    const { working, fork, upstream, github } = forkClone({ saysHead: false })
    return Effect.gen(function* () {
      yield* opened(working, 'upstream')
      const { projectId, taskId, here } = yield* taskToPullRequest(working)
      rename(working)
      const head = git(fork, 'rev-parse', BRANCH)
      git(fork, 'push', '-q', upstream, `${head}:refs/heads/${BRANCH}`)

      assert.deepStrictEqual(yield* refusedBoth(projectId, taskId, here), [
        { tag: 'PushRefused', why: 'unplaced' },
        { tag: 'PushRefused', why: 'unplaced' },
      ])
      assert.strictEqual(git(fork, 'rev-parse', BRANCH), head)
      assert.strictEqual(git(upstream, 'rev-parse', BRANCH), head)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('takes no saved head for the pull request’s, where the host can’t be read', () => {
    const { working, fork, upstream, github } = forkClone({ saysHead: false })
    return Effect.gen(function* () {
      yield* opened(working, 'upstream')
      const { taskId, here } = yield* taskToPullRequest(working)
      rename(working)
      const saved = git(fork, 'rev-parse', BRANCH)
      // Upstream's branch of that name stands where the pull request last was; the fork's has moved on since.
      git(fork, 'push', '-q', upstream, `${saved}:refs/heads/${BRANCH}`)
      const tree = git(fork, 'rev-parse', `${saved}^{tree}`)
      const moved = git(fork, '-c', 'user.name=Them', '-c', 'user.email=them@althar.test', 'commit-tree', tree, '-p', saved, '-m', 'Theirs')
      git(fork, 'update-ref', `refs/heads/${BRANCH}`, moved)
      git(here, 'commit', '-q', '--allow-empty', '-m', 'One more')

      github.failNext('change', 'unreachable')
      yield* Effect.exit((yield* Changes).push(taskId, git(here, 'rev-parse', 'HEAD')))
      assert.strictEqual(git(upstream, 'rev-parse', BRANCH), saved, 'upstream’s branch of that name stays as it was')
      assert.strictEqual(git(fork, 'rev-parse', BRANCH), moved)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('refuses a pull request whose other repository can’t be read, where only one that can stands at its head', () => {
    let head: string | undefined
    const { working, fork, upstream, github } = forkClone({ saysHead: false, headOf: () => head })
    return Effect.gen(function* () {
      yield* opened(working, 'upstream')
      const { projectId, taskId, here } = yield* taskToPullRequest(working)
      rename(working)
      head = git(fork, 'rev-parse', BRANCH)
      git(fork, 'push', '-q', upstream, `${head}:refs/heads/${BRANCH}`)
      // The fork answers nothing for now: its branch may be there all the same.
      renameSync(fork, `${fork}.away`)

      assert.deepStrictEqual(yield* refusedBoth(projectId, taskId, here), [
        { tag: 'PushRefused', why: 'unplaced' },
        { tag: 'PushRefused', why: 'unplaced' },
      ])
      assert.strictEqual(git(upstream, 'rev-parse', BRANCH), head)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('refuses a pull request no branch of that name stands at the head of', () => {
    const { working, fork, upstream, github } = forkClone({ saysHead: false, headOf: () => 'f'.repeat(40) })
    return Effect.gen(function* () {
      yield* opened(working, 'upstream')
      const { projectId, taskId, here } = yield* taskToPullRequest(working)
      rename(working)
      const head = git(fork, 'rev-parse', BRANCH)

      assert.deepStrictEqual(yield* refusedBoth(projectId, taskId, here), [
        { tag: 'PushRefused', why: 'unplaced' },
        { tag: 'PushRefused', why: 'unplaced' },
      ])
      assert.strictEqual(git(fork, 'rev-parse', BRANCH), head)
      assert.isFalse(hasBranch(upstream), 'no new branch upstream for the open pull request')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

describe('a pull request whose host doesn’t say where its branch is', () => {
  it.live('still takes its commits on the fork, where its branch is, in a clone not renamed', () => {
    const { working, fork, upstream, github } = forkClone({ saysHead: false })
    return Effect.gen(function* () {
      yield* opened(working, 'upstream')
      const { projectId, taskId, here } = yield* taskToPullRequest(working)
      yield* pushOneMore(projectId, taskId, here, 'One more')
      assert.strictEqual(git(fork, 'log', '-1', '--format=%s', BRANCH), 'One more')
      assert.isFalse(hasBranch(upstream))
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('still takes them in a normal project, whose branch is on its own repository', () => {
    const { working, bare } = hosted(FORK)
    git(working, 'config', 'user.name', 'Fake')
    git(working, 'config', 'user.email', 'fake@althar.test')
    const github = makeFakeService({
      saysHead: false,
      headOf: () => (hasBranch(bare) ? git(bare, 'rev-parse', BRANCH) : null),
      pushUrl: () => bare,
    })
    github.addRepository(FORK)
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const { projectId, taskId, here } = yield* taskToPullRequest(working)
      yield* pushOneMore(projectId, taskId, here, 'One more')
      assert.strictEqual(git(bare, 'log', '-1', '--format=%s', BRANCH), 'One more')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})
