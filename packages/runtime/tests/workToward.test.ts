import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { makeFakeService } from '@althar/connectors/testing'
import type { MessageSender } from '@althar/contracts'
import { Ids, newId, type ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { withoutSignIns } from '../src/Config'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Launches } from '../src/Launches'
import { coordinatorFolder, freshCopy } from '../src/coordinatorFolder'
import { place, spotsOf } from '../src/local'
import { Projects } from '../src/Projects'
import { guardHolds, guardStopIn } from '../src/pushGuard'
import { Queries } from '../src/Queries'
import { timestamp } from '../src/records'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
import { makeBranch } from '../src/newBranch'
import { setToward } from '../src/towards'
import { ask, cards, connect, git, runtimeWith, tipOf } from './changesSupport'
import { conflictsIn, given, hostOf, moveMainOn, runtimeWith as conflictsRuntime, taskBranch, titled } from './conflictsSupport'
import { callTool, fakeConnectors, HOST, hosted, launches, repository, runtime, until } from './support'

/*
 * A task working toward a branch other than the default (ADR-093): the
 * project's Work toward, or one task's own. It starts from that branch, its
 * pull request goes into it, and what the lead reads of the checks it is
 * held to, keeping it current, Local's checkout and a fork's upstream go by
 * it; other tasks still go to main. The coordinator makes a release branch,
 * and opens the pull request that brings it back, on the person's word.
 */

const RELEASE = 'release/0.8.0'

/** A commit on a new branch of the repository, made from main and left: what a release branch has that main hasn't. */
const branchOff = (working: string, branch = RELEASE) => {
  git(working, 'switch', '-q', '-c', branch)
  git(working, '-c', 'user.name=T', '-c', 'user.email=t@t.test', 'commit', '-q', '--allow-empty', '-m', `Start ${branch}`)
  git(working, 'switch', '-q', 'main')
  return git(working, 'rev-parse', branch)
}

/** The task's workspaces as the store has them. */
const workspacesOf = (taskId: string) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql<{ path: string; baseRef: string; baseCommit: string | null; toward: string | null }>`
      SELECT path, base_ref, base_commit, toward FROM workspaces WHERE task_id = ${taskId}`,
  )

const opened = (path: string) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
    const [bound] = yield* projects.repositories(project.projectId)
    return { projectId: project.projectId as ProjectId, repositoryId: bound?.id ?? '' }
  })

const drafted = (projectId: ProjectId, title: string, more: { readonly toward?: string | null; readonly local?: boolean } = {}) =>
  Effect.gen(function* () {
    return yield* (yield* Projects).createTask({
      envelope: yield* Runtime.envelope('task.create', { title }),
      projectId,
      title,
      draft: true,
      ...(more.local === true ? { worksIn: 'checkout' as const } : {}),
      ...(more.toward === undefined ? {} : { toward: more.toward }),
    })
  })

const planning = () =>
  Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { localEvery: Duration.hours(1), countdown: Duration.hours(1) })))

describe('a project working toward a release branch', () => {
  it.live('starts a new task from it, opens its pull request into it, and reads that branch’s checks for its lead', () => {
    const { working, bare } = hosted()
    const release = branchOff(working)
    git(working, 'push', '-q', bare, RELEASE)
    const github = makeFakeService({
      pushUrl: () => bare,
      headOf: tipOf(bare),
      // The release branch's latest commit fails a check main passes.
      checksOn: (sha) => (sha === release ? [{ name: 'test', state: 'failed' }] : undefined),
    })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const { projectId, repositoryId } = yield* opened(working)
      const projects = yield* Projects
      yield* projects.setRepository({ projectId, repositoryId, workToward: RELEASE })
      const [shown] = yield* projects.repositories(projectId)
      assert.strictEqual(shown?.workToward, RELEASE)
      assert.deepStrictEqual(shown?.branches?.[0], 'main')

      yield* ask(working, 'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]')
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready' && all[0]?.change != null)
      const taskId = ready?.taskId ?? ''
      assert.strictEqual(ready?.toward, RELEASE)
      const [workspace] = yield* workspacesOf(taskId)
      assert.deepInclude(workspace, { toward: RELEASE, baseCommit: release })
      // Its pull request goes into the release branch, not main.
      assert.strictEqual(github.changes[0]?.target, RELEASE)
      // Its lead's git never pushes straight onto the branch its work goes into, as it never does onto main (ADR-071).
      if (guardHolds) {
        const started = launches.findLast((one) => one.cwd === workspace?.path)
        assert.include(started?.env.ALTHAR_TOWARD_BRANCHES?.split(' ') ?? [], RELEASE)
        const pushed = spawnSync('git', ['push', bare, `HEAD:refs/heads/${RELEASE}`], {
          cwd: workspace?.path ?? '',
          // As a lead's shell has it: the guard's entry of git's config goes after the signed-out ones.
          env: { ...process.env, ...withoutSignIns(mkdtempSync(join(tmpdir(), 'althar-signed-out-'))), ...started?.env },
          encoding: 'utf8',
        })
        assert.notStrictEqual(pushed.status, 0)
        assert.strictEqual(guardStopIn(`${pushed.stdout}${pushed.stderr}`), 'default-branch')
        assert.include(pushed.stderr, `a push to ${RELEASE}, the branch the task's work goes into`)
        assert.strictEqual(git(bare, 'rev-parse', RELEASE), release)
      }
      // What its lead reads to tell a failure of its own from one already on the branch it goes into.
      const lead = { role: 'lead' as const, projectId, threadId: ready?.threadId ?? '', sessionId: 'none', taskId }
      const base = yield* callTool(lead, 'read_default_branch_checks', {})
      assert.match(base, new RegExp(`^The checks on ${RELEASE}'s latest commit, ${release.slice(0, 7)}: 0 passed, 1 failed`))
      // The coordinator's tools say it.
      const coordinator: ToolAccess = {
        role: 'coordinator',
        projectId,
        threadId: yield* (yield* Coordinator).thread(projectId),
        sessionId: 'coordinator-session',
        taskId: null,
      }
      assert.include(yield* callTool(coordinator, 'list_tasks', {}), `toward ${RELEASE})`)
      assert.include(
        yield* callTool(coordinator, 'read_task', { task: ready?.slug ?? '' }),
        `It works toward ${RELEASE}, not the default branch.`,
      )
      // The task's own view says it too.
      const view = yield* Effect.orDie((yield* Queries).thread(ready?.threadId ?? ''))
      assert.strictEqual(view.task.toward, RELEASE)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('refuses a Work toward its repository has no branch for, and back to null goes to the default', () => {
    const root = repository()
    branchOff(root)
    return Effect.gen(function* () {
      const { projectId, repositoryId } = yield* opened(root)
      const projects = yield* Projects
      const refused = yield* Effect.flip(projects.setRepository({ projectId, repositoryId, workToward: 'release/9.9.9' }))
      assert.strictEqual(refused._tag, 'BranchNotFound')
      yield* projects.setRepository({ projectId, repositoryId, workToward: RELEASE })
      yield* projects.setRepository({ projectId, repositoryId, workToward: 'main' })
      assert.isNull((yield* projects.repositories(projectId))[0]?.workToward)
      const task = yield* drafted(projectId, 'Fix the login')
      assert.deepInclude((yield* workspacesOf(task.taskId))[0], { toward: null, baseRef: 'main' })
    }).pipe(Effect.provide(planning()))
  })
})

describe('one task pointed at another branch', () => {
  it.live('starts from it while another still starts from main, and one pointed there before it starts moves its worktree', () => {
    const root = repository()
    const release = branchOff(root)
    const main = git(root, 'rev-parse', 'main')
    return Effect.gen(function* () {
      const { projectId } = yield* opened(root)
      const toward = yield* drafted(projectId, 'Fix the release', { toward: RELEASE })
      const plain = yield* drafted(projectId, 'Fix the login')
      const [first] = yield* workspacesOf(toward.taskId)
      const [second] = yield* workspacesOf(plain.taskId)
      assert.deepInclude(first, { toward: RELEASE, baseCommit: release })
      assert.strictEqual(git(first?.path ?? '', 'rev-parse', 'HEAD'), release)
      assert.deepInclude(second, { toward: null, baseCommit: main })
      // The release branch is here as a branch of the clone's own, for merging and conflicts here to go by.
      assert.strictEqual(git(root, 'rev-parse', `refs/heads/${RELEASE}`), release)

      // Pointed at the release branch on its plan card: its worktree goes there, unused, as its first step begins.
      yield* setToward(plain.taskId, RELEASE)
      assert.strictEqual((yield* workspacesOf(plain.taskId))[0]?.toward, RELEASE)
      assert.deepStrictEqual(yield* place(plain.taskId, 'worktree'), { kind: 'ready' })
      const [moved] = yield* workspacesOf(plain.taskId)
      assert.deepInclude(moved, { baseRef: RELEASE, baseCommit: release })
      assert.strictEqual(git(moved?.path ?? '', 'rev-parse', 'HEAD'), release)
      assert.strictEqual(git(moved?.path ?? '', 'branch', '--show-current'), (yield* spotsOf(plain.taskId))[0]?.branch)

      // A branch nobody has isn't one to work toward: nothing changes.
      const refused = yield* Effect.flip(setToward(toward.taskId, 'release/9.9.9'))
      assert.strictEqual(refused._tag, 'BranchNotFound')
      assert.strictEqual((yield* workspacesOf(toward.taskId))[0]?.toward, RELEASE)
      const unknown = yield* Effect.flip(drafted(projectId, 'Fix nothing', { toward: 'release/9.9.9' }))
      assert.strictEqual(unknown._tag, 'BranchNotFound')
    }).pipe(Effect.provide(planning()))
  })

  it.live('works Local from the release branch, with the checkout on main, and gives it back to main', () => {
    const root = repository()
    const release = branchOff(root)
    return Effect.gen(function* () {
      const { projectId } = yield* opened(root)
      const task = yield* drafted(projectId, 'Fix the release', { toward: RELEASE, local: true })
      // On main, clean: main is no branch of the person's to give up, for a task working toward another.
      assert.deepStrictEqual(yield* place(task.taskId, 'checkout'), { kind: 'ready' })
      const [taken] = yield* spotsOf(task.taskId)
      assert.deepInclude(taken, { state: 'ready', returnsTo: 'main', baseCommit: release })
      assert.strictEqual(git(root, 'rev-parse', 'HEAD'), release)
      assert.strictEqual(git(root, 'branch', '--show-current'), taken?.branch)
    }).pipe(Effect.provide(planning()))
  })
})

describe('keeping a pull request into a release branch current', () => {
  it.live('merges that branch into it, not main', () => {
    const github = makeFakeService()
    const { working } = hosted(['meridian', 'api'])
    github.addRepository(['meridian', 'api'])
    github.addPullRequest({ path: ['meridian', 'api'], title: 'A fix for the release', author: 'dana', member: true, target: RELEASE })
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const { projectId } = yield* opened(working)
      const coordinator: ToolAccess = {
        role: 'coordinator',
        projectId,
        threadId: yield* (yield* Coordinator).thread(projectId),
        sessionId: 'coordinator-session',
        taskId: null,
      }
      github.fallBehind(1)
      assert.include(yield* callTool(coordinator, 'update_branch', { pull_request: '#1' }), `is merging ${RELEASE} into PR #1`)
      assert.lengthOf(github.branchesUpdated, 1)
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }) })))))
  })
})

describe('a task whose pull request conflicts with the release branch it goes into', () => {
  it.live('goes back to work to merge that branch, not main, which it merges cleanly', () => {
    const { working, bare } = hosted()
    branchOff(working)
    git(working, 'push', '-q', bare, RELEASE)
    const github = hostOf(bare, () => undefined, undefined, { into: RELEASE })
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const { projectId, repositoryId } = yield* opened(working)
      yield* (yield* Projects).setRepository({ projectId, repositoryId, workToward: RELEASE })
      yield* ask(working, 'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:resolve]')
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready' && all[0]?.change != null)
      const threadId = ready?.threadId ?? ''
      // The release branch moves on, conflicting with what the task changed; main stays as it was.
      git(working, 'switch', '-q', RELEASE)
      moveMainOn(working)
      git(working, 'push', '-q', bare, RELEASE)
      git(working, 'switch', '-q', 'main')
      assert.isFalse(conflictsIn(bare, 'main', taskBranch(bare) ?? ''))
      yield* titled(threadId, `The lead resolved the conflict with ${RELEASE}`)
      const [brought] = (yield* given(threadId)).filter((body) => body.includes('Bring the branch up to date'))
      assert.include(brought, `${RELEASE} has moved on`)
      assert.match(brought ?? '', /merge \S*release\/0\.8\.0 into it/)
      // What it pushed holds the release branch's change: it merged that, and its pull request merges cleanly into it.
      assert.isFalse(conflictsIn(bare, RELEASE, taskBranch(bare) ?? ''))
      assert.include(git(bare, 'show', `${taskBranch(bare)}:change.txt`), 'rate limits')
    }).pipe(Effect.provide(conflictsRuntime({ github })))
  })
})

describe('a fork whose work goes upstream, toward a release branch there', () => {
  it.live('starts from it and opens its pull request into it on the repository it came from', () => {
    const { working, bare: fork } = hosted(['you', 'api'])
    git(working, 'remote', 'add', 'upstream', `${HOST}/meridian/api.git`)
    const upstream = mkdtempSync(join(tmpdir(), 'althar-remote-'))
    git(upstream, 'init', '-q', '--bare', '-b', 'main')
    git(working, 'push', '-q', upstream, 'main')
    const release = branchOff(working)
    git(working, 'push', '-q', upstream, RELEASE)
    const github = makeFakeService({
      pushUrl: (path) => (path.join('/') === 'meridian/api' ? upstream : fork),
      headOf: () => {
        try {
          return execFileSync('git', ['rev-parse', 'althar/add-a-retry'], { cwd: fork }).toString().trim()
        } catch {
          return null
        }
      },
    })
    github.addRepository(['you', 'api'])
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const { projectId, repositoryId } = yield* opened(working)
      const projects = yield* Projects
      yield* projects.setRepository({ projectId, repositoryId, changeTarget: 'upstream', workToward: RELEASE })
      yield* ask(working, 'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]')
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready' && all[0]?.change != null)
      assert.deepInclude((yield* workspacesOf(ready?.taskId ?? ''))[0], { toward: RELEASE, baseCommit: release })
      assert.strictEqual(ready?.change?.url, 'https://github.com/meridian/api/pull/1')
      assert.strictEqual(github.changes[0]?.target, RELEASE)
      assert.strictEqual(github.forkOf(1), 'you/api')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

describe('a fork whose work goes upstream, offline', () => {
  it.live('offers the branches of the repository it came from, not the fork’s, and copies its own for the coordinator', () => {
    const { working } = hosted(['you', 'api'])
    git(working, 'remote', 'add', 'upstream', `${HOST}/meridian/api.git`)
    const main = git(working, 'rev-parse', 'main')
    const theirs = git(
      working,
      '-c',
      'user.name=T',
      '-c',
      'user.email=t@t.test',
      'commit-tree',
      '-p',
      main,
      '-m',
      'Start it upstream',
      `${main}^{tree}`,
    )
    // As last fetched: upstream's release branch, and the fork's own of the same name elsewhere, with one upstream hasn't.
    git(working, 'update-ref', 'refs/remotes/upstream/main', main)
    git(working, 'symbolic-ref', 'refs/remotes/upstream/HEAD', 'refs/remotes/upstream/main')
    git(working, 'update-ref', `refs/remotes/upstream/${RELEASE}`, theirs)
    git(working, 'update-ref', `refs/remotes/origin/${RELEASE}`, main)
    git(working, 'update-ref', 'refs/remotes/origin/fork-only', main)
    const github = makeFakeService({})
    github.addRepository(['you', 'api'])
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const { projectId, repositoryId } = yield* opened(working)
      const projects = yield* Projects
      yield* projects.setRepository({ projectId, repositoryId, changeTarget: 'upstream' })
      const [shown] = yield* projects.repositories(projectId)
      assert.strictEqual(shown?.defaultBranch, 'main')
      assert.include(shown?.branches ?? [], RELEASE)
      assert.notInclude(shown?.branches ?? [], 'fork-only')
      // Only upstream has it, with no branch of it here: still a branch to work toward, and the coordinator's copy is upstream's.
      yield* projects.setRepository({ projectId, repositoryId, workToward: RELEASE })
      const copied = yield* coordinatorFolder(projectId)
      assert.strictEqual(git(copied.repositories[0]?.root ?? '', 'rev-parse', 'HEAD'), theirs)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('copies the release branch as the remote it starts from has it, where the fork’s of that name differs', () => {
    const { working, bare: fork } = hosted(['you', 'api'])
    const upstream = mkdtempSync(join(tmpdir(), 'althar-remote-'))
    git(upstream, 'init', '-q', '--bare', '-b', 'main')
    const main = git(working, 'rev-parse', 'main')
    const theirs = git(
      working,
      '-c',
      'user.name=T',
      '-c',
      'user.email=t@t.test',
      'commit-tree',
      '-p',
      main,
      '-m',
      'Start it upstream',
      `${main}^{tree}`,
    )
    git(working, 'push', '-q', upstream, 'main', `${theirs}:refs/heads/${RELEASE}`)
    git(working, 'push', '-q', fork, `main:refs/heads/${RELEASE}`)
    git(working, 'remote', 'set-url', 'origin', fork)
    git(working, 'remote', 'add', 'upstream', upstream)
    return Effect.gen(function* () {
      const into = mkdtempSync(join(tmpdir(), 'althar-copy-'))
      yield* freshCopy(working, join(into, 'upstream'), RELEASE, working, 'upstream')
      assert.strictEqual(git(join(into, 'upstream'), 'rev-parse', 'HEAD'), theirs)
      yield* freshCopy(working, join(into, 'fork'), RELEASE, working, 'origin')
      assert.strictEqual(git(join(into, 'fork'), 'rev-parse', 'HEAD'), main)
    })
  })
})

describe('Run in a fork whose work goes upstream', () => {
  it.live('says the branch its copy is of: upstream’s default, where it isn’t named as the fork’s is', () => {
    const { working } = hosted(['you', 'api'])
    writeFileSync(
      join(working, 'package.json'),
      JSON.stringify({ name: 'api', scripts: { dev: 'node serve.js', storybook: 'node serve.js' } }),
    )
    writeFileSync(join(working, 'serve.js'), 'setInterval(() => {}, 1000)\n')
    git(working, 'add', '.')
    git(working, '-c', 'user.name=T', '-c', 'user.email=t@t.test', 'commit', '-q', '-m', 'Serve')
    git(working, 'remote', 'add', 'upstream', `${HOST}/meridian/api.git`)
    const main = git(working, 'rev-parse', 'main')
    // The fork's default is main; the repository it came from calls its default develop.
    git(working, 'update-ref', 'refs/remotes/origin/main', main)
    git(working, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
    git(working, 'update-ref', 'refs/remotes/upstream/develop', main)
    git(working, 'symbolic-ref', 'refs/remotes/upstream/HEAD', 'refs/remotes/upstream/develop')
    const github = makeFakeService({})
    github.addRepository(['you', 'api'])
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const { projectId, repositoryId } = yield* opened(working)
      const projects = yield* Projects
      yield* projects.setRepository({ projectId, repositoryId, changeTarget: 'upstream' })
      const launches = yield* Launches
      const instance = yield* Instance
      const dev = yield* launches.start({ projectId, taskId: null, threadId: null })
      assert.strictEqual(dev.where, 'develop')
      // Another started beside it, from the same copy, says the same.
      const storybook = yield* launches.keepRunnable({
        projectId,
        name: 'Storybook',
        command: 'npm run storybook',
        actorId: instance.personId,
      })
      const book = yield* launches.start({ projectId, taskId: null, runnableId: storybook.id, threadId: null })
      assert.strictEqual(book.where, 'develop')
      for (const running of yield* launches.ofProject(projectId)) yield* launches.stop(running.id)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

/** A coordinator session with a live turn, by the person's message or by news: its message's id (as coordinatorReleases.test). */
const coordinatorOf = (projectId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const threadId = yield* (yield* Coordinator).thread(projectId)
    const sessionId = yield* newId(Ids.providerSession)
    yield* sql`INSERT INTO provider_sessions ${sql.insert({ id: sessionId, projectId, threadId, agentId: 'codex', state: 'active', startedAt: yield* timestamp })}`
    return { role: 'coordinator', projectId, threadId, taskId: null, sessionId } satisfies ToolAccess
  })

const turn = (access: ToolAccess, body: string, sender: MessageSender = { kind: 'window' }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const origin = sender.kind === 'window' ? 'person' : 'news'
    yield* sql`UPDATE turn_deliveries SET state = 'completed', ended_at = ${yield* timestamp} WHERE thread_id = ${access.threadId} AND state = 'delivered'`
    const accepted = yield* (yield* Sessions).send({
      envelope: yield* Runtime.envelope('thread.send', {}),
      threadId: access.threadId,
      body,
      sender,
      origin: origin === 'news' ? 'news' : 'system',
    })
    const turnId = yield* newId(Ids.turnDelivery)
    yield* sql`INSERT INTO turn_deliveries ${sql.insert({ id: turnId, projectId: access.projectId, threadId: access.threadId, providerSessionId: access.sessionId, controllerGeneration: 1, state: 'delivered', origin, requestedAt: yield* timestamp, deliveredAt: yield* timestamp })}`
    yield* sql`INSERT INTO turn_delivery_inputs ${sql.insert({ projectId: access.projectId, deliveryId: turnId, userInputId: accepted.inputId, position: 1 })}`
    return accepted.inputId
  })

describe('the coordinator’s release branches', () => {
  it.live('makes a release branch from main and opens the pull request back into main, on the person’s word only', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    const main = git(bare, 'rev-parse', 'main')
    const has = (branch: string) => {
      try {
        return git(bare, 'rev-parse', '--verify', '-q', `refs/heads/${branch}`)
      } catch {
        return null
      }
    }
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const { projectId } = yield* opened(working)
      const coordinator = yield* coordinatorOf(projectId)

      const news = yield* turn(coordinator, 'A release is due', { kind: 'internal' })
      assert.match(yield* callTool(coordinator, 'create_branch', { branch: RELEASE, message: news }), /window or a paired device/)
      assert.isNull(has(RELEASE))

      const word = yield* turn(coordinator, 'Make release/0.8.0 from main')
      assert.include(
        yield* callTool(coordinator, 'create_branch', { branch: RELEASE, from: 'main', message: word }),
        `Made ${RELEASE} on meridian/api, from main at ${main.slice(0, 8)}`,
      )
      assert.strictEqual(has(RELEASE), main)
      // Asked again, it was done: its answer stands, and nothing is pushed twice.
      assert.include(yield* callTool(coordinator, 'create_branch', { branch: RELEASE, from: 'main', message: word }), `Made ${RELEASE}`)
      assert.strictEqual(has(RELEASE), main)
      // One there already, elsewhere, is never moved.
      const other = yield* turn(coordinator, 'Make release/0.7.1 from main')
      git(working, 'push', '-q', bare, `${git(working, 'rev-parse', 'main')}:refs/heads/release/0.7.1`)
      git(
        bare,
        'update-ref',
        'refs/heads/release/0.7.1',
        git(bare, '-c', 'user.name=T', '-c', 'user.email=t@t.test', 'commit-tree', '-m', 'Elsewhere', `${main}^{tree}`),
      )
      assert.include(
        yield* callTool(coordinator, 'create_branch', { branch: 'release/0.7.1', from: 'main', message: other }),
        'never moves a branch that is there',
      )

      const back = yield* turn(coordinator, 'Open the PR that brings it back into main')
      assert.include(
        yield* callTool(coordinator, 'open_pull_request', { from: RELEASE, title: 'Release 0.8.0 back into main', message: back }),
        `${RELEASE} into main`,
      )
      assert.deepInclude(github.changes[0], { source: RELEASE, target: 'main', title: 'Release 0.8.0 back into main' })
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('never moves a release branch made there while it was making it, even one behind where it was going', () => {
    const { working, bare } = hosted()
    git(working, '-c', 'user.name=T', '-c', 'user.email=t@t.test', 'commit', '-q', '--allow-empty', '-m', 'On')
    git(working, 'push', '-q', bare, 'main')
    const behind = git(bare, 'rev-parse', 'main^')
    // Between Althar's look and its push, someone makes the branch at main's parent: the host has it once the push connects.
    const script = join(mkdtempSync(join(tmpdir(), 'althar-race-')), 'race.sh')
    writeFileSync(
      script,
      `if [ "$1" = git-receive-pack ]; then git --git-dir="${bare}" update-ref refs/heads/${RELEASE} ${behind} '' 2>/dev/null || true; fi\nexec git "\${1#git-}" "${bare}"\n`,
    )
    git(working, 'config', 'protocol.ext.allow', 'always')
    const github = makeFakeService({ pushUrl: () => `ext::sh ${script} %S` })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const { projectId } = yield* opened(working)
      const coordinator = yield* coordinatorOf(projectId)
      const word = yield* turn(coordinator, 'Make release/0.8.0 from main')
      assert.include(
        yield* callTool(coordinator, 'create_branch', { branch: RELEASE, from: 'main', message: word }),
        'made while Althar was making it',
      )
      assert.strictEqual(git(bare, 'rev-parse', RELEASE), behind)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

describe('a branch the person makes from a branch list', () => {
  it.live('is made on the host from its default branch, never moves one there already, and is then a branch to work toward', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    const main = git(bare, 'rev-parse', 'main')
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const { projectId, repositoryId } = yield* opened(working)
      assert.strictEqual(yield* makeBranch({ projectId, repositoryId, branch: ' release/0.9.0 ' }), 'release/0.9.0')
      assert.strictEqual(git(bare, 'rev-parse', 'release/0.9.0'), main)
      // The branch lists have it, and new tasks can work toward it.
      const [listed] = yield* (yield* Projects).repositories(projectId)
      assert.include(listed?.branches ?? [], 'release/0.9.0')
      yield* (yield* Projects).setRepository({ projectId, repositoryId, workToward: 'release/0.9.0' })
      assert.strictEqual((yield* (yield* Projects).repositories(projectId))[0]?.workToward, 'release/0.9.0')

      // One there already, elsewhere, is left where it is, and is the one the person gets.
      const elsewhere = git(bare, '-c', 'user.name=T', '-c', 'user.email=t@t.test', 'commit-tree', '-m', 'Elsewhere', `${main}^{tree}`)
      git(bare, 'update-ref', 'refs/heads/release/0.7.1', elsewhere)
      assert.strictEqual(yield* makeBranch({ projectId, repositoryId, branch: 'release/0.7.1' }), 'release/0.7.1')
      assert.strictEqual(git(bare, 'rev-parse', 'release/0.7.1'), elsewhere)
      assert.strictEqual(git(working, 'rev-parse', 'refs/remotes/origin/release/0.7.1'), elsewhere)

      // One the host's rules refuse is refused, as git said it, and the lists never have it.
      writeFileSync(join(bare, 'hooks', 'pre-receive'), '#!/bin/sh\necho "release branches are protected" >&2\nexit 1\n', {
        mode: 0o755,
      })
      const declined = yield* Effect.flip(makeBranch({ projectId, repositoryId, branch: 'release/1.0.0' }))
      assert.strictEqual(declined._tag, 'BranchRefused')
      assert.include('message' in declined ? declined.message : '', 'release branches are protected')
      assert.strictEqual(spawnSync('git', ['rev-parse', '--verify', '-q', 'refs/remotes/origin/release/1.0.0'], { cwd: working }).status, 1)
      assert.strictEqual(spawnSync('git', ['rev-parse', '--verify', '-q', 'refs/althar/start/release/1.0.0'], { cwd: working }).status, 1)
      assert.notInclude((yield* (yield* Projects).repositories(projectId))[0]?.branches ?? [], 'release/1.0.0')
      rmSync(join(bare, 'hooks', 'pre-receive'))

      // A name git doesn't take is refused in words for the person, and nothing is pushed.
      const refused = yield* Effect.flip(makeBranch({ projectId, repositoryId, branch: 'my branch' }))
      assert.strictEqual(refused._tag, 'BranchRefused')
      assert.include('message' in refused ? refused.message : '', 'can’t be called')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})
