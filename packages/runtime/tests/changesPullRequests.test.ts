import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { setCoAuthor } from '../src/credit'
import { ChangedSinceSeen } from '../src/errors'
import { words } from '../src/words'
import { Instance } from '../src/Instance'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import * as Runtime from '../src/Runtime'
import { HOST, hosted, turns, until } from './support'

import { refused, runtimeWith, connect, ask, cards, tipOf, git, arrivals, pushByHand } from './changesSupport'

/*
 * A task that ends in a pull request (docs/plans/integrations.md): when its
 * steps are done, Althar commits what the lead left, pushes the branch to
 * the code host (here, a bare repository in its place), and opens a draft
 * pull request on it (here, the fake service); then it listens. What people
 * say arrives in the thread and reaches the lead; failed checks too; a merge
 * settles the task.
 */

describe('what the host says of a ready pull request’s conflicts', () => {
  it.live('reaches the board and the home as the host says it now, with the branch it merges into', () => {
    const { working, bare } = hosted()
    // That it conflicts, that it doesn't, or nothing. Here the branches merge cleanly, so no lead is asked to resolve it.
    let says: boolean | undefined = true
    const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare), conflictsOf: () => says })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const projectId = yield* ask(working, 'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]')
      const queries = yield* Queries
      const seen = Effect.gen(function* () {
        const board = (yield* Effect.orDie(queries.board(projectId))).tasks[0]?.change
        const home = (yield* Effect.orDie(queries.home())).tasks[0]?.change
        return { board: { target: board?.target, conflicts: board?.conflicts }, home: { target: home?.target, conflicts: home?.conflicts } }
      })
      const saying = (conflicts: boolean | undefined) =>
        until(
          Effect.map(seen, (both) => [both]),
          ([both]) =>
            both !== undefined &&
            both.board.conflicts === conflicts &&
            both.home.conflicts === conflicts &&
            both.board.target !== undefined,
          Duration.seconds(20),
        )
      const [conflicting] = yield* saying(true)
      assert.deepStrictEqual(conflicting, { board: { target: 'main', conflicts: true }, home: { target: 'main', conflicts: true } })
      // It no longer does: the card says so, rather than what the host said before.
      says = false
      const [clean] = yield* saying(false)
      assert.deepStrictEqual(clean, { board: { target: 'main', conflicts: false }, home: { target: 'main', conflicts: false } })
      // The host doesn't say: nor does the card.
      says = true
      yield* saying(true)
      says = undefined
      const [unknown] = yield* saying(undefined)
      assert.deepStrictEqual(unknown, { board: { target: 'main', conflicts: undefined }, home: { target: 'main', conflicts: undefined } })
      const [ready] = yield* cards(projectId)
      assert.strictEqual(ready?.phase, 'ready')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

describe('a pull request, by the person and the lead', () => {
  it.live('is marked ready by the person, read and replied on by the lead, and pushed by the person as far as they saw', () => {
    const { working, bare } = hosted()
    const tip = tipOf(bare)
    const github = makeFakeService({ pushUrl: () => bare, headOf: tip })
    github.addRepository(['meridian', 'api'])
    // Commits are the person's own, which is what Althar credits.
    git(working, 'config', 'user.name', 'Fake')
    git(working, 'config', 'user.email', 'fake@althar.test')
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const changes = yield* Changes
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]',
        pushByHand,
      )
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      const taskId = ready?.taskId ?? ''

      yield* changes.markReady(taskId)
      assert.isFalse(github.changes[0]?.draft)
      assert.isFalse((yield* changes.ofTask(taskId))[0]?.draft)
      // Ready already, marking it again asks nothing more of the host.
      const marked = () => github.calls.filter((call) => call === 'markReady').length
      assert.strictEqual(marked(), 1)
      yield* changes.markReady(taskId)
      assert.strictEqual(marked(), 1)

      github.reviewAs(1, 'dana', 'changes_requested', 'Name it better.')
      github.commentAs(1, 'lee', 'Looks fine to me.')
      github.setChecks(1, [
        { name: 'test', state: 'failed', log: 'FAIL limit.test.ts' },
        { name: 'verify', state: 'failed', url: 'https://github.com/meridian/api/actions/runs/1/job/2', log: refused },
      ])
      const read = yield* changes.read(taskId)
      assert.include(read, 'PR #1, "Add a retry" (open)')
      assert.include(read, 'Checks: 0 passed, 2 failed, 0 running (failed: test, verify).')
      assert.include(read, "The end of test's log:\n```\nFAIL limit.test.ts\n```")
      // A log that couldn't be read says why, and that reading it again won't help.
      assert.include(
        read,
        "Althar couldn't read verify's log: GitHub refused (403): Resource not accessible by integration. Its sign-in may not be allowed to read logs. Reading it again with read_check_log would fail the same way: work from what is here, or reproduce the check locally. Its page: https://github.com/meridian/api/actions/runs/1/job/2",
      )
      assert.include(read, '- dana reviewed: changes requested\n> Name it better.')
      assert.include(read, '- lee:\n> Looks fine to me.')

      yield* changes.reply(taskId, { body: 'Renamed it.', threadId: null, by: 'Claude Code' })
      // The same reply asked for again isn't sent twice; it says it came from Althar, and who wrote it.
      yield* changes.reply(taskId, { body: 'Renamed it.', threadId: null, by: 'Claude Code' })
      assert.lengthOf(
        github.commentsOn(1).filter((comment) => comment.body === 'Renamed it.\n\n<sub>From Althar, by Claude Code.</sub>'),
        1,
      )
      // Read back, it is the lead's own, without the signature.
      assert.include(yield* changes.read(taskId), '- you, through Althar:\n> Renamed it.')

      const sql = yield* SqlClient.SqlClient
      const [workspace] = yield* sql<{ path: string; branch: string }>`SELECT path, branch FROM workspaces WHERE task_id = ${taskId}`
      // What the lead commits after waits for the person: the card says how many, and they push what they saw.
      const commit = (message: string) => execFileSync('git', ['commit', '-q', '--allow-empty', '-m', message], { cwd: workspace?.path })
      commit('More')
      const [seen] = yield* until(cards(projectId), (all) => all[0]?.change?.unpushed === 1)
      const head = seen?.change?.localHead ?? ''
      assert.strictEqual(head, git(workspace?.path ?? '', 'rev-parse', 'HEAD').trim())
      commit('Later')
      yield* changes.push(taskId, head)
      const pushed = git(bare, 'log', '--format=%s', workspace?.branch ?? '')
      assert.include(pushed, 'More')
      assert.notInclude(pushed, 'Later')
      // Only what came after is left to push.
      yield* until(cards(projectId), (all) => all[0]?.change?.unpushed === 1 && all[0]?.change?.localHead !== head)
      // The earlier push credited More and moved the branch onto it, Later on top: that is what is left, and it goes as it is.
      assert.notStrictEqual(git(bare, 'rev-parse', workspace?.branch ?? ''), head)
      yield* setCoAuthor(true)
      const [later] = yield* until(cards(projectId), (all) => all[0]?.change?.unpushed === 1)
      yield* changes.push(taskId, later?.change?.localHead ?? '')
      assert.strictEqual((yield* cards(projectId))[0]?.change?.unpushed, 0)
      // A commit made after is credited as it goes: what is pushed isn't what was seen, and the branch moves onto it. Nothing is
      // left to push at once, without the host's next look.
      commit('Fresh')
      const [fresh] = yield* until(cards(projectId), (all) => all[0]?.change?.unpushed === 1)
      const seenFresh = fresh?.change?.localHead ?? ''
      yield* changes.push(taskId, seenFresh)
      const [afterCredited] = yield* cards(projectId)
      assert.strictEqual(afterCredited?.change?.unpushed, 0)
      assert.notStrictEqual(tip(), seenFresh)
      assert.strictEqual(tip(), git(workspace?.path ?? '', 'rev-parse', 'HEAD'))
      assert.strictEqual(afterCredited?.change?.localHead, tip())
      // The same where nothing is rewritten: the commit goes up as it is.
      yield* setCoAuthor(false)
      commit('Plain')
      const [plain] = yield* until(cards(projectId), (all) => all[0]?.change?.unpushed === 1)
      yield* changes.push(taskId, plain?.change?.localHead ?? '')
      const [afterPlain] = yield* cards(projectId)
      assert.strictEqual(afterPlain?.change?.unpushed, 0)
      assert.strictEqual(tip(), plain?.change?.localHead)
      // The host is the last word: where it is rewound behind what was pushed, what is ahead of it is the person's to push again.
      git(bare, 'update-ref', 'refs/heads/althar/add-a-retry', 'althar/add-a-retry~1')
      yield* until(cards(projectId), (all) => all[0]?.change?.unpushed === 1, Duration.seconds(20))
      // A commit that isn't on the branch any more isn't pushed.
      const gone = yield* Effect.flip(changes.push(taskId, '0000000000000000000000000000000000000000'))
      assert.strictEqual(gone instanceof Error ? gone.name : String(gone), 'ChangedSinceSeen')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('says what the lead can’t do without one', () => {
    const { working } = hosted()
    return Effect.gen(function* () {
      const projects = yield* Projects
      const changes = yield* Changes
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'x',
      })
      const error = yield* Effect.flip(changes.read(created.taskId))
      assert.strictEqual(error instanceof Error ? error.name : String(error), 'NotFound')
      assert.lengthOf(yield* changes.ofTask(created.taskId), 0)
      assert.isNull(yield* changes.endFor(project.projectId))
    }).pipe(Effect.provide(runtimeWith({})))
  })
})

describe('an abandoned task’s pull request', () => {
  /** A task whose pull request is open on the fake GitHub, ready for the person: its project, its task and its thread. */
  const opened = (github: FakeService, working: string) =>
    Effect.gen(function* () {
      yield* connect('github', HOST)
      const projectId = yield* ask(working, 'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]')
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      assert.strictEqual(github.changes[0]?.state, 'open')
      return { projectId, taskId: ready?.taskId ?? '', threadId: ready?.threadId ?? '', url: github.changes[0]?.url ?? '' }
    })
  const abandon = (taskId: string) =>
    Effect.flatMap(Tasks, (tasks) =>
      Effect.flatMap(Runtime.envelope('task.abandon', { taskId }), (envelope) => tasks.abandon({ envelope, taskId })),
    )
  const fresh = () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare) })
    github.addRepository(['meridian', 'api'])
    return { working, github }
  }

  it.live('stays open on its host when the person doesn’t close it, and its card says so, as the host does after', () => {
    const { working, github } = fresh()
    return Effect.gen(function* () {
      const changes = yield* Changes
      const { projectId, taskId, threadId } = yield* opened(github, working)
      yield* abandon(taskId)
      // Abandoning alone asks nothing of the host: the pull request is open there, and the card says it is.
      assert.notInclude(github.calls, 'closeChange')
      assert.strictEqual(github.changes[0]?.state, 'open')
      const [card] = yield* cards(projectId)
      assert.strictEqual(card?.phase, 'settled')
      assert.strictEqual(card?.change?.state, 'open')
      // Not listened to any more, as an older Althar left it, it is read from the host once: still open there, it says open.
      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE external_links SET listening = 0 WHERE task_id = ${taskId} AND kind = 'change'`
      yield* changes.readSettled
      assert.strictEqual((yield* changes.ofTask(taskId))[0]?.state, 'open')
      // Closed on GitHub by hand since, the next read says so, in the card and the thread.
      github.close(1)
      yield* changes.readSettled
      const [seen] = yield* changes.ofTask(taskId)
      assert.strictEqual(seen?.state, 'closed')
      assert.isFalse(seen?.listening)
      assert.strictEqual((yield* cards(projectId))[0]?.change?.state, 'closed')
      assert.isTrue((yield* arrivals(threadId)).some((arrival) => arrival['kind'] === 'closed'))
      // Closed, it isn't read again.
      const reads = github.calls.filter((call) => call === 'change').length
      yield* changes.readSettled
      assert.strictEqual(github.calls.filter((call) => call === 'change').length, reads)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('is read from its host at the next launch, its card saying how it stands there now', () => {
    const { working, github } = fresh()
    const database = join(mkdtempSync(join(tmpdir(), 'althar-settled-')), 'althar.sqlite')
    return Effect.gen(function* () {
      // Abandoned with its pull request left open, as an older Althar left it: not listened to, its card saying open.
      const { projectId, taskId } = yield* Effect.scoped(
        Effect.gen(function* () {
          const left = yield* opened(github, working)
          yield* abandon(left.taskId)
          const sql = yield* SqlClient.SqlClient
          yield* sql`UPDATE external_links SET listening = 0 WHERE task_id = ${left.taskId} AND kind = 'change'`
          return left
        }).pipe(Effect.provide(runtimeWith({ github }, database))),
      )
      // Closed on GitHub by hand while Althar wasn't running.
      github.close(1)
      const reads = github.calls.filter((call) => call === 'change').length
      // Launched again, nothing asked of it: the board's settled row reads it from GitHub, once, and says it is closed.
      yield* Effect.scoped(
        Effect.gen(function* () {
          const queries = yield* Queries
          const onBoard = Effect.map(queries.board(projectId), (board) => board.tasks.filter((task) => task.taskId === taskId))
          const [card] = yield* until(onBoard, ([one]) => one?.change?.state === 'closed', Duration.seconds(20))
          assert.strictEqual(card?.phase, 'settled')
          assert.strictEqual(github.calls.filter((call) => call === 'change').length, reads + 1)
        }).pipe(Effect.provide(runtimeWith({ github }, database))),
      )
    })
  })

  it.live('is closed on its host when the person says, its branch deleted where they ask', () => {
    const { working, github } = fresh()
    return Effect.gen(function* () {
      const changes = yield* Changes
      const { projectId, taskId, threadId, url } = yield* opened(github, working)
      yield* abandon(taskId)
      // The board's settled row reads it open, as GitHub has it; closed, it reads it closed, without waiting for anything else.
      const onBoard = Effect.flatMap(Queries, (queries) =>
        Effect.map(queries.board(projectId), (board) => board.tasks.find((task) => task.taskId === taskId)),
      )
      assert.strictEqual((yield* onBoard)?.change?.state, 'open')
      const closed = yield* changes.close(taskId, url, { deleteBranch: true })
      assert.strictEqual((yield* onBoard)?.change?.state, 'closed')
      assert.strictEqual(closed.change.state, 'closed')
      assert.isNull(closed.branch)
      assert.strictEqual(github.changes[0]?.state, 'closed')
      assert.deepStrictEqual(github.branchesDeleted, [1])
      // Closed, it is listened to no more, the card says closed, and the thread says it closed.
      const [seen] = yield* changes.ofTask(taskId)
      assert.strictEqual(seen?.state, 'closed')
      assert.isFalse(seen?.listening)
      assert.strictEqual((yield* cards(projectId))[0]?.change?.state, 'closed')
      assert.isTrue((yield* arrivals(threadId)).some((arrival) => arrival['kind'] === 'closed'))
      // Pressed again, nothing more is asked of the host.
      const asked = github.calls.filter((call) => call === 'closeChange' || call === 'deleteBranch').length
      yield* changes.close(taskId, url, { deleteBranch: true })
      assert.strictEqual(github.calls.filter((call) => call === 'closeChange' || call === 'deleteBranch').length, asked)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('stays open where the host refuses to close it, and says why; a branch it won’t delete is said apart', () => {
    const { working, github } = fresh()
    return Effect.gen(function* () {
      const changes = yield* Changes
      const { projectId, taskId, url } = yield* opened(github, working)
      yield* abandon(taskId)
      github.failNext('closeChange', 'forbidden', undefined, 403)
      const refused = yield* Effect.flip(changes.close(taskId, url, { deleteBranch: true }))
      assert.strictEqual(refused instanceof Error ? refused.name : String(refused), 'ConnectorFailed')
      assert.strictEqual(words(refused, String).message, "GitHub won't let this account do that: The fake closeChange failed (forbidden).")
      assert.strictEqual(github.changes[0]?.state, 'open')
      assert.strictEqual((yield* changes.ofTask(taskId))[0]?.state, 'open')
      assert.strictEqual((yield* cards(projectId))[0]?.change?.state, 'open')
      assert.deepStrictEqual(github.branchesDeleted, [])
      // Tried again, it closes; the branch the host won't delete stays, and what it said is returned.
      github.failNext('deleteBranch', 'forbidden', undefined, 403)
      const closed = yield* changes.close(taskId, url, { deleteBranch: true })
      assert.strictEqual(closed.change.state, 'closed')
      assert.strictEqual(closed.branch, 'The fake deleteBranch failed (forbidden)')
      assert.strictEqual(github.changes[0]?.state, 'closed')
      assert.deepStrictEqual(github.branchesDeleted, [])
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live(
    'keeps a pull request merged on its host meanwhile as merged, closing nothing, and leaves its branch where the person asks',
    () => {
      const { working, github } = fresh()
      return Effect.gen(function* () {
        const changes = yield* Changes
        const { taskId, url } = yield* opened(github, working)
        yield* abandon(taskId)
        github.mergeByHand(1)
        const merged = yield* changes.close(taskId, url, { deleteBranch: true })
        assert.strictEqual(merged.change.state, 'merged')
        assert.isNull(merged.branch)
        assert.notInclude(github.calls, 'closeChange')
        assert.deepStrictEqual(github.branchesDeleted, [])
      }).pipe(Effect.provide(runtimeWith({ github })))
    },
  )

  it.live('is closed without deleting its branch where the person doesn’t ask, and a settled read that fails is let go', () => {
    const { working, github } = fresh()
    return Effect.gen(function* () {
      const changes = yield* Changes
      const { taskId, url } = yield* opened(github, working)
      yield* abandon(taskId)
      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE external_links SET listening = 0 WHERE task_id = ${taskId} AND kind = 'change'`
      // The host failing to answer is logged, not raised, and the pull request stays as it was seen.
      github.failNext('change', 'unreachable')
      yield* changes.readSettled
      assert.strictEqual((yield* changes.ofTask(taskId))[0]?.state, 'open')
      const closed = yield* changes.close(taskId, url, { deleteBranch: false })
      assert.strictEqual(closed.change.state, 'closed')
      assert.isNull(closed.branch)
      assert.deepStrictEqual(github.branchesDeleted, [])
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

describe('a branch that parted from its pull request', () => {
  it.live('is said in a new lead’s brief to be published, by its pull request', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare) })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const projectId = yield* ask(working, 'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]')
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready' && all[0]?.change != null, Duration.seconds(20))
      const threadId = ready?.threadId ?? ''
      const [workspace] = yield* (yield* SqlClient.SqlClient)<{
        branch: string
      }>`SELECT branch FROM workspaces WHERE task_id = ${ready?.taskId ?? ''}`
      const before = (yield* turns(threadId)).length
      yield* (yield* Sessions).switchAgent({ threadId, agentId: 'opencode' })
      const briefed = yield* until(
        turns(threadId),
        (rows) => rows.length > before && rows.every((row) => !['pending', 'delivered'].includes(row.state)),
      )
      assert.include(
        briefed.at(before)?.prompt ?? '',
        `The branch ${workspace?.branch ?? ''} is published: its pull request, ${ready?.change?.url ?? ''}, has it at ${(ready?.change?.head ?? '').slice(0, 12)}.`,
      )
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('is told apart from one that only adds to it, replaced only under a lease, or brought back by merging', () => {
    const { working, bare } = hosted()
    const tip = tipOf(bare)
    const github = makeFakeService({ pushUrl: () => bare, headOf: tip })
    github.addRepository(['meridian', 'api'])
    git(working, 'config', 'user.name', 'Fake')
    git(working, 'config', 'user.email', 'fake@althar.test')
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      yield* setCoAuthor(false)
      const changes = yield* Changes
      const sql = yield* SqlClient.SqlClient
      const projectId = yield* ask(working, 'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]')
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      const taskId = ready?.taskId ?? ''
      const [workspace] = yield* sql<{ path: string; branch: string }>`SELECT path, branch FROM workspaces WHERE task_id = ${taskId}`
      const here = workspace?.path ?? ''
      const branch = workspace?.branch ?? ''
      const at = (cwd: string, ...args: Array<string>) => execFileSync('git', args, { cwd }).toString().trim()
      const refused = (error: unknown) => (error instanceof Error && 'why' in error ? `${error.name}:${String(error.why)}` : String(error))

      // A commit on top: a plain fast-forward, as it always was.
      at(here, 'commit', '-q', '--allow-empty', '-m', 'More')
      const [ahead] = yield* until(cards(projectId), (all) => all[0]?.change?.unpushed === 1)
      assert.isNull(ahead?.change?.diverged)
      yield* changes.push(taskId, ahead?.change?.localHead ?? '')
      assert.strictEqual(tip(), at(here, 'rev-parse', 'HEAD'))
      // Pushed by URL, with no remote-tracking ref: Althar keeps its own, for the brief to say the branch is published.
      assert.strictEqual(at(here, 'rev-parse', `refs/althar/pushed/${branch}`), tip())

      // The lead rewrites what was pushed: the card says so, with nothing to push plainly.
      const published = tip() ?? ''
      at(here, 'commit', '-q', '--amend', '--allow-empty', '-m', 'More, reworded')
      at(here, 'commit', '-q', '--allow-empty', '-m', 'Then this')
      const [rewritten] = yield* until(cards(projectId), (all) => all[0]?.change?.diverged != null)
      assert.deepStrictEqual(rewritten?.change?.diverged, { kind: 'rewritten', local: 2, onPullRequest: 1 })
      assert.strictEqual(rewritten?.change?.unpushed, 0)
      const local = rewritten?.change?.localHead ?? ''

      // A plain push is refused in a sentence, not git's hint.
      const plain = yield* Effect.flip(changes.push(taskId, local))
      assert.strictEqual(refused(plain), 'PushRefused:behind')
      assert.strictEqual(
        words(plain, String).message,
        'PR #1 has commits that aren’t here yet, so it didn’t take the push. Bring them in, then push again.',
      )

      // Asking the lead to merge instead: the note has it start again from what was pushed, and merge, never rebase;
      // what it hasn't committed is committed, and the backup checked, before any reset.
      assert.notInclude((yield* changes.mergeNote(taskId)).note, 'not committed now')
      writeFileSync(join(here, 'half-done.ts'), 'export {}\n')
      const asked = yield* changes.mergeNote(taskId)
      rmSync(join(here, 'half-done.ts'))
      assert.strictEqual(asked.head, published)
      assert.include(asked.note, 'was rewritten after it was pushed')
      assert.include(asked.note, '(not committed now: half-done.ts)')
      const order = ['Commit everything not committed yet', `git rev-parse ${branch}-rewritten HEAD`, `git reset --hard ${published}`]
      assert.deepStrictEqual(
        order.map((step) => asked.note.indexOf(step)),
        order.map((step) => asked.note.indexOf(step)).toSorted((a, b) => a - b),
      )
      assert.notInclude(
        order.map((step) => asked.note.indexOf(step)),
        -1,
      )
      assert.include(asked.note, 'Merge, never rebase')
      assert.strictEqual(at(here, 'rev-parse', `refs/althar/pull-request/${branch}`), published)

      // Someone pushed meanwhile: replacing under the lease of the head seen refuses, and nothing on the host moves.
      at(bare, 'update-ref', `refs/heads/${branch}`, `${published}~1`)
      // Only from a head seen, as a commit: anything else replaces nothing.
      assert.instanceOf(yield* Effect.flip(changes.replace(taskId, local, 'not-a-commit')), ChangedSinceSeen)
      const stale = yield* Effect.flip(changes.replace(taskId, local, published))
      assert.strictEqual(refused(stale), 'PushRefused:moved')
      assert.strictEqual(tip(), at(bare, 'rev-parse', `${published}~1`))
      at(bare, 'update-ref', `refs/heads/${branch}`, published)

      // Still where the person saw it: their branch replaces it, and the record says it was their force push.
      yield* changes.replace(taskId, local, published)
      assert.strictEqual(tip(), local)
      const [forced] = yield* sql<{ payload: string; actorId: string }>`
        SELECT payload, actor_id FROM record_events WHERE type = 'external_link.force_pushed'`
      assert.deepInclude(JSON.parse(forced?.payload ?? '{}'), {
        replaced: published,
        head: local,
        rule: 'force-push',
        answeredBy: 'person',
      })
      assert.strictEqual(forced?.actorId, (yield* Instance).personId)
      yield* until(cards(projectId), (all) => all[0]?.change?.diverged === null && all[0]?.change?.unpushed === 0)

      // Someone pushes to the pull request from elsewhere: it moved, and a plain push is refused the same way.
      const tree = at(bare, 'rev-parse', `${local}^{tree}`)
      const theirs = execFileSync('git', ['commit-tree', tree, '-p', local, '-m', 'Update branch'], {
        cwd: bare,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Dana',
          GIT_AUTHOR_EMAIL: 'dana@x',
          GIT_COMMITTER_NAME: 'Dana',
          GIT_COMMITTER_EMAIL: 'dana@x',
        },
      })
        .toString()
        .trim()
      at(bare, 'update-ref', `refs/heads/${branch}`, theirs)
      at(here, 'commit', '-q', '--allow-empty', '-m', 'Mine')
      const [moved] = yield* until(cards(projectId), (all) => all[0]?.change?.diverged?.kind === 'moved', Duration.seconds(20))
      assert.deepStrictEqual(moved?.change?.diverged, { kind: 'moved', local: 0, onPullRequest: null })
      assert.strictEqual(refused(yield* Effect.flip(changes.push(taskId, moved?.change?.localHead ?? ''))), 'PushRefused:behind')
      // Bringing its commits in: fetched here, and the lead merges them.
      const bringing = yield* changes.mergeNote(taskId)
      assert.strictEqual(bringing.head, theirs)
      assert.include(bringing.note, `git merge ${theirs}`)
      const [counted] = yield* until(cards(projectId), (all) => all[0]?.change?.diverged?.onPullRequest === 1)
      assert.deepStrictEqual(counted?.change?.diverged, { kind: 'moved', local: 1, onPullRequest: 1 })
      at(here, 'merge', '-q', '--no-edit', theirs)
      const [merged] = yield* until(cards(projectId), (all) => all[0]?.change?.diverged === null && all[0]?.change?.unpushed === 2)
      yield* changes.push(taskId, merged?.change?.localHead ?? '')
      assert.strictEqual(tip(), merged?.change?.localHead)

      // A host that takes no forced push says so in its own words, and nothing moves there.
      at(bare, 'config', 'receive.denyNonFastForwards', 'true')
      const kept = tip() ?? ''
      at(here, 'commit', '-q', '--amend', '--allow-empty', '-m', 'Merged, reworded first')
      const denied = yield* Effect.flip(changes.replace(taskId, at(here, 'rev-parse', 'HEAD'), kept))
      assert.strictEqual(refused(denied), 'PushRefused:refused')
      assert.strictEqual(tip(), kept)
      at(bare, 'config', 'receive.denyNonFastForwards', 'false')

      // Where the project never allows a force push, nothing is replaced.
      const policies = yield* Policies
      yield* policies.set(
        projectId,
        { alwaysAsk: ['default-branch', 'many-branches', 'delete-branch', 'deploy', 'outside'], never: ['force-push'] },
        (yield* Instance).personId,
      )
      const before = tip() ?? ''
      at(here, 'commit', '-q', '--amend', '--allow-empty', '-m', 'Merged, reworded')
      const never = yield* Effect.flip(changes.replace(taskId, at(here, 'rev-parse', 'HEAD'), before))
      assert.strictEqual(refused(never), 'PushRefused:never')
      assert.strictEqual(tip(), before)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})
