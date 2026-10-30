import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import type { PushRefused } from '../src/errors'
import { words } from '../src/words'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Sessions } from '../src/Sessions'
import * as Runtime from '../src/Runtime'
import { callTool, fakeConnectors, HOST, hosted, items, runtime, until } from './support'

import { runtimeWith, connect, ask, cards, tipOf, git } from './changesSupport'

/*
 * A task that ends in a pull request (docs/plans/integrations.md): when its
 * steps are done, Althar commits what the lead left, pushes the branch to
 * the code host (here, a bare repository in its place), and opens a draft
 * pull request on it (here, the fake service); then it listens. What people
 * say arrives in the thread and reaches the lead; failed checks too; a merge
 * settles the task.
 */

describe('the Push button', () => {
  /** An agent's commit, as Claude Code makes one: with its own credit line, which Althar makes again without. */
  const agentCommit = (cwd: string, subject: string) =>
    git(cwd, 'commit', '-q', '--allow-empty', '-m', subject, '-m', 'Co-Authored-By: Claude <noreply@anthropic.com>')

  /**
   * A task with its draft pull request open, on a host that can be held at a
   * head, as GitHub answers for a moment after a push it hasn't read yet.
   */
  const pushable = () => {
    const { working, bare } = hosted()
    const tip = tipOf(bare)
    const held: { head: string | null } = { head: null }
    const github = makeFakeService({ pushUrl: () => bare, headOf: () => held.head ?? tip() })
    github.addRepository(['meridian', 'api'])
    git(working, 'config', 'user.name', 'Fake')
    git(working, 'config', 'user.email', 'fake@althar.test')
    const opened = Effect.gen(function* () {
      yield* connect('github', HOST)
      const projectId = yield* ask(working, 'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]')
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready' && all[0]?.change != null)
      const taskId = ready?.taskId ?? ''
      const [workspace] = yield* (yield* SqlClient.SqlClient)<{
        path: string
        branch: string
      }>`SELECT path, branch FROM workspaces WHERE task_id = ${taskId}`
      return { projectId, taskId, here: workspace?.path ?? '', branch: workspace?.branch ?? '' }
    })
    /** Once the host has been asked of the pull request twice more: a whole look of Althar's since. */
    const looked = Effect.gen(function* () {
      const asked = () => github.calls.filter((call) => call === 'change').length
      const before = asked()
      yield* until(
        Effect.sync(() => [asked()]),
        ([now = 0]) => now >= before + 2,
      )
    })
    /** A hook the bare repository runs as it takes a push, in the task's worktree, once. */
    const whilePushing = (hook: 'pre-receive', here: string, script: string) => {
      const path = join(bare, 'hooks', hook)
      writeFileSync(
        path,
        [
          '#!/bin/sh',
          // What git sets for the repository taking the push isn't the worktree's.
          'unset GIT_DIR GIT_QUARANTINE_PATH GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_PUSH_OPTION_COUNT',
          `rm -- "$0"`,
          `cd '${here}' || exit 1`,
          script,
          '',
        ].join('\n'),
        { mode: 0o755 },
      )
    }
    return { working, bare, tip, held, github, opened, looked, whilePushing }
  }

  it.live('pushes ten commits in one click, and counts none left at once, though the host hasn’t read the push yet', () => {
    const { bare, tip, held, github, opened, looked } = pushable()
    return Effect.gen(function* () {
      const changes = yield* Changes
      const { projectId, taskId, here, branch } = yield* opened
      const before = tip()
      // The host answers with what it had before, until it reads the push.
      held.head = before
      for (let n = 1; n <= 10; n++) agentCommit(here, `Step ${n}`)
      const [seen] = yield* until(cards(projectId), (all) => all[0]?.change?.unpushed === 10)
      yield* changes.push(taskId, seen?.change?.localHead ?? '')

      // All ten went up, credited, and the branch is on what went: nothing is left, at once.
      assert.strictEqual(git(bare, 'rev-list', '--count', `${before}..${branch}`), '10')
      assert.notInclude(git(bare, 'log', '--format=%B', `${before}..${branch}`), 'Claude')
      assert.strictEqual(git(here, 'rev-parse', 'HEAD'), tip())
      const [pushed] = yield* cards(projectId)
      assert.strictEqual(pushed?.change?.unpushed, 0)
      assert.strictEqual(pushed?.change?.head, tip())

      // The host's next looks, still on what it had, don't put the ten back.
      yield* looked
      const [after] = yield* cards(projectId)
      assert.strictEqual(after?.change?.unpushed, 0)
      assert.strictEqual(after?.change?.head, tip())
      assert.isNull(after?.change?.diverged)
      held.head = null
      yield* looked
      assert.strictEqual((yield* cards(projectId))[0]?.change?.unpushed, 0)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('leaves only what the lead committed during the push, credited onto what went, for the next push', () => {
    const { tip, github, opened, whilePushing } = pushable()
    return Effect.gen(function* () {
      const changes = yield* Changes
      const { projectId, taskId, here } = yield* opened
      for (let n = 1; n <= 3; n++) agentCommit(here, `Step ${n}`)
      const [seen] = yield* until(cards(projectId), (all) => all[0]?.change?.unpushed === 3)
      // The lead commits while git sends the three.
      whilePushing(
        'pre-receive',
        here,
        `git commit -q --allow-empty -m 'During the push' -m 'Co-Authored-By: Claude <noreply@anthropic.com>'`,
      )
      yield* changes.push(taskId, seen?.change?.localHead ?? '')

      // The three went; the lead's commit is left, made again on top of what went, and counted at once.
      assert.strictEqual(git(here, 'log', '-1', '--format=%s', 'HEAD'), 'During the push')
      assert.strictEqual(git(here, 'rev-parse', 'HEAD~1'), tip())
      assert.notInclude(git(here, 'log', '-1', '--format=%B', 'HEAD'), 'Claude')
      const [left] = yield* cards(projectId)
      assert.strictEqual(left?.change?.unpushed, 1)
      assert.isNull(left?.change?.diverged)

      yield* changes.push(taskId, left?.change?.localHead ?? '')
      assert.strictEqual(tip(), git(here, 'rev-parse', 'HEAD'))
      assert.strictEqual((yield* cards(projectId))[0]?.change?.unpushed, 0)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live(
    'pushes what the lead commits on top of commits the push credited but couldn’t move the branch onto, a merge of main among them',
    () => {
      const { working, bare, tip, github, opened, whilePushing } = pushable()
      return Effect.gen(function* () {
        const changes = yield* Changes
        const { projectId, taskId, here, branch } = yield* opened
        // Main moves on, and the lead merges it in while the push is under way: the worktree is mid-merge as the push ends, so the
        // branch stays on the commits as the lead made them.
        writeFileSync(join(working, 'main.txt'), 'main\n')
        git(working, 'add', 'main.txt')
        git(working, 'commit', '-q', '-m', 'On main')
        for (let n = 1; n <= 3; n++) agentCommit(here, `Step ${n}`)
        const [seen] = yield* until(cards(projectId), (all) => all[0]?.change?.unpushed === 3)
        const made = seen?.change?.localHead ?? ''
        whilePushing('pre-receive', here, 'git merge -q --no-ff --no-commit main')
        yield* changes.push(taskId, made)
        assert.strictEqual(git(here, 'rev-parse', 'HEAD'), made)
        assert.notStrictEqual(tip(), made)

        // What went is what the branch has, as the lead made it: nothing to push, and nothing parted.
        const [pushed] = yield* cards(projectId)
        assert.strictEqual(pushed?.change?.unpushed, 0)
        assert.isNull(pushed?.change?.diverged)

        // The lead commits the merge, and more on top: those are what is left, and Push takes them.
        git(here, 'commit', '-q', '--no-edit')
        agentCommit(here, 'After the merge')
        const [left] = yield* until(cards(projectId), (all) => all[0]?.change?.localHead !== made)
        // The merge, its commit from main, and the one after.
        assert.strictEqual(left?.change?.unpushed, 3)
        assert.isNull(left?.change?.diverged)
        yield* changes.push(taskId, left?.change?.localHead ?? '')
        assert.strictEqual(tip(), git(here, 'rev-parse', 'HEAD'))
        assert.strictEqual((yield* cards(projectId))[0]?.change?.unpushed, 0)
        assert.strictEqual(git(bare, 'log', '-1', '--format=%s', `${branch}~1`), `Merge branch 'main' into ${branch}`)
        assert.strictEqual(git(bare, 'log', '-1', '--format=%s', `${branch}~1^2`), 'On main')
        assert.notInclude(git(bare, 'log', '--format=%B', `${branch}~5..${branch}`), 'Claude')
      }).pipe(Effect.provide(runtimeWith({ github })))
    },
  )

  it.live('says why the host refused a push, leaves the count as it was, and pushes once it takes it', () => {
    const { bare, tip, github, opened } = pushable()
    return Effect.gen(function* () {
      const changes = yield* Changes
      const { projectId, taskId, here } = yield* opened
      for (let n = 1; n <= 2; n++) agentCommit(here, `Step ${n}`)
      const [seen] = yield* until(cards(projectId), (all) => all[0]?.change?.unpushed === 2)
      const before = tip()
      writeFileSync(join(bare, 'hooks', 'pre-receive'), '#!/bin/sh\necho "protected branch" >&2\nexit 1\n', { mode: 0o755 })
      const refused = yield* Effect.flip(changes.push(taskId, seen?.change?.localHead ?? ''))
      assert.strictEqual(refused instanceof Error ? refused.name : String(refused), 'PushRefused')
      assert.strictEqual((refused as PushRefused).why, 'protected')
      assert.strictEqual(
        words(refused, String).message,
        'The branch is protected, so PR #1 didn’t take the push. Push to another branch or a fork, or ask its owners to let you push to it.',
      )
      // Nothing went, and the card says so: the same two to push.
      assert.strictEqual(tip(), before)
      const [still] = yield* cards(projectId)
      assert.strictEqual(still?.change?.unpushed, 2)
      assert.strictEqual(still?.change?.head, before)

      rmSync(join(bare, 'hooks', 'pre-receive'))
      yield* changes.push(taskId, still?.change?.localHead ?? '')
      assert.strictEqual((yield* cards(projectId))[0]?.change?.unpushed, 0)
      assert.strictEqual(tip(), git(here, 'rev-parse', 'HEAD'))
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

describe('a push the lead asks the person for', () => {
  /** The pushes the lead asked for in a task's thread, oldest first, as their items keep them. */
  const asked = (threadId: string) =>
    Effect.map(items(threadId), (all) =>
      all.flatMap((item) =>
        item.kind === 'push_request'
          ? [
              item.content as {
                readonly url: string
                readonly where: string
                readonly head: string
                readonly commits: ReadonlyArray<{ readonly sha: string; readonly subject: string }>
                readonly count: number
                readonly moved: boolean
                readonly blocked: string | null
                readonly state: string
              },
            ]
          : [],
      ),
    )

  /** What the person says in a task's thread. */
  const say = (threadId: string, body: string) =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { threadId, body }), threadId, body })
    })

  /** What Althar told the lead quietly, in the person's place. */
  const toldLead = (like: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* sql<{ body: string }>`SELECT body FROM user_inputs WHERE body LIKE ${like}`
    })

  /** A task whose lead opened a pull request, and goes on when the person says "push pls". */
  const opened = (working: string) =>
    Effect.gen(function* () {
      yield* connect('github', HOST)
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:push]',
      )
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready')
      const sql = yield* SqlClient.SqlClient
      const [workspace] = yield* sql<{
        path: string
        branch: string
      }>`SELECT path, branch FROM workspaces WHERE task_id = ${ready?.taskId ?? ''}`
      const taskId = ready?.taskId ?? ''
      const threadId = ready?.threadId ?? ''
      return {
        projectId,
        taskId,
        threadId,
        path: workspace?.path ?? '',
        branch: workspace?.branch ?? '',
        lead: { role: 'lead' as const, projectId, threadId, sessionId: 'none', taskId },
      }
    })

  const commit = (cwd: string, message: string, ...more: Array<string>) =>
    execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', 'commit', '-q', '--allow-empty', ...more, '-m', message], {
      cwd,
    })

  it.live('is refused before the task has a pull request', () => {
    const { working } = hosted()
    return Effect.gen(function* () {
      const projects = yield* Projects
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'x',
      })
      const lead = {
        role: 'lead' as const,
        projectId: project.projectId,
        threadId: created.threadId,
        sessionId: 'none',
        taskId: created.taskId,
      }
      assert.include(yield* callTool(lead, 'push_to_pull_request', {}), 'This task has no pull request yet.')
      assert.lengthOf(yield* asked(created.threadId), 0)
    }).pipe(Effect.provide(runtimeWith({})))
  })

  it.live('shows the person what would go up when they ask the lead to push, pushes exactly that, and tells the lead', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const changes = yield* Changes
      const queries = yield* Queries
      const task = yield* opened(working)

      // Nothing new on the branch: nothing to ask for, and what isn't committed is said.
      assert.strictEqual(
        yield* callTool(task.lead, 'push_to_pull_request', {}),
        "PR #1 already has every commit on the branch, so there's nothing new to push.",
      )
      writeFileSync(join(task.path, 'notes.txt'), 'notes\n')
      assert.include(yield* callTool(task.lead, 'push_to_pull_request', {}), "What you changed isn't committed yet (notes.txt)")
      rmSync(join(task.path, 'notes.txt'))
      // Named as it isn't, it says how it is named.
      assert.include(yield* callTool(task.lead, 'push_to_pull_request', { pull_request: 'web#1' }), "This task's pull request is PR #1.")

      // The person asks the lead to push: it commits, and asks them to, with what would go up.
      yield* say(task.threadId, 'push pls')
      const [card] = yield* until(asked(task.threadId), (all) => all.length === 1)
      assert.deepInclude(card, { where: 'PR #1', count: 1, moved: false, state: 'open' })
      assert.deepStrictEqual(
        card?.commits.map((one) => one.subject),
        ['Tidy up before pushing'],
      )
      assert.strictEqual(card?.head, git(task.path, 'rev-parse', 'HEAD'))
      // Nothing went up yet.
      assert.notInclude(git(bare, 'log', '--format=%s', task.branch), 'Tidy up before pushing')
      // The window reads it as the contract has it.
      const shown = (yield* queries.thread(task.threadId, { limit: 100 })).items.find((item) => item.kind === 'push_request')
      assert.deepInclude(shown?.content, { where: 'PR #1', count: 1, state: 'open', settledAt: null })
      // Asked again with nothing new, it is the same request, not another.
      assert.strictEqual(
        yield* callTool(task.lead, 'push_to_pull_request', {}),
        "Already asked the person to push 1 commit to PR #1: it waits for them in the task's thread, and you'll be told when they've pushed.",
      )
      assert.lengthOf(yield* asked(task.threadId), 1)

      // The lead commits more meanwhile; the person's Push sends what the card showed, and nothing newer.
      commit(task.path, 'Later')
      yield* changes.push(task.taskId, card?.head ?? '', card?.url ?? '')
      const pushed = git(bare, 'log', '--format=%s', task.branch)
      assert.include(pushed, 'Tidy up before pushing')
      assert.notInclude(pushed, 'Later')
      const [done] = yield* asked(task.threadId)
      assert.strictEqual(done?.state, 'pushed')
      // The lead hears it.
      yield* until(toldLead('%pushed your commit to PR #1%'), (rows) => rows.length === 1)

      // Asked for what came after, then for more again: the later ask takes the earlier one's place.
      assert.strictEqual(
        yield* callTool(task.lead, 'push_to_pull_request', {}),
        "Asked the person to push 1 commit to PR #1. They see them in the task's thread with a Push button; nothing goes up until they press it, and you'll be told when they have.",
      )
      commit(task.path, 'Even later')
      writeFileSync(join(task.path, 'scratch.log'), 'trying\n')
      assert.include(yield* callTool(task.lead, 'push_to_pull_request', {}), "Not included, since they aren't committed: scratch.log.")
      const [, replaced, later] = yield* asked(task.threadId)
      assert.strictEqual(replaced?.state, 'replaced')
      assert.deepInclude(later, { count: 2, state: 'open', moved: false })
      assert.deepStrictEqual(
        later?.commits.map((one) => one.subject),
        ['Later', 'Even later'],
      )

      // The lead rewrites what the card showed before the person pushes: nothing is pushed, and the card shows the branch as it is now.
      commit(task.path, 'Even later, again', '--amend')
      const moved = yield* Effect.flip(changes.push(task.taskId, later?.head ?? '', later?.url ?? ''))
      assert.strictEqual(moved instanceof Error ? moved.name : String(moved), 'ChangedSinceSeen')
      assert.strictEqual(
        words(moved, String).message,
        'The branch changed since you looked at it, so nothing was pushed. Have another look at what would go up, then push.',
      )
      assert.notInclude(git(bare, 'log', '--format=%s', task.branch), 'Later')
      const [, , again] = yield* asked(task.threadId)
      assert.deepInclude(again, { moved: true, count: 2, state: 'open', head: git(task.path, 'rev-parse', 'HEAD') })
      assert.deepStrictEqual(
        again?.commits.map((one) => one.subject),
        ['Later', 'Even later, again'],
      )
      // Pushed as it is now, it says so.
      yield* changes.push(task.taskId, again?.head ?? '', again?.url ?? '')
      assert.include(git(bare, 'log', '--format=%s', task.branch), 'Even later, again')
      assert.strictEqual((yield* asked(task.threadId))[2]?.state, 'pushed')
      yield* until(toldLead('%pushed your 2 commits to PR #1%'), (rows) => rows.length === 1)

      // Without its host, it can't reach the pull request, and says so.
      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE external_links SET connection_id = NULL WHERE kind = 'change'`
      commit(task.path, 'Last')
      assert.include(yield* callTool(task.lead, 'push_to_pull_request', {}), 'Althar isn’t connected to this repository’s host')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('closes what it asked once the pull request merges, and is refused after', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const changes = yield* Changes
      const task = yield* opened(working)
      yield* say(task.threadId, 'push pls')
      yield* until(asked(task.threadId), (all) => all[0]?.state === 'open')
      github.mergeByHand(1)
      yield* changes.refresh(task.taskId)
      yield* until(asked(task.threadId), (all) => all[0]?.state === 'closed')
      commit(task.path, 'After')
      assert.strictEqual(
        yield* callTool(task.lead, 'push_to_pull_request', {}),
        "PR #1 is merged, so there's nothing to push to. What you committed after it goes in a new pull request, which the person opens from the task: if you haven't, call finish_step with your summary, and tell them it's ready.",
      )
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  /** The commit a branch is on in the remote's repository. */
  const remoteHead = (bare: string, branch: string) => git(bare, 'rev-parse', `refs/heads/${branch}`)

  /**
   * Althar's reading of the pull request, left behind: not asked again, with
   * its head as it was at `head`. A reading a push asked for that is under
   * way waits for the task's pull request as this does, and goes first.
   */
  const staleReading = (taskId: string, head: string) =>
    Effect.gen(function* () {
      const changes = yield* Changes
      yield* changes.stopListening(taskId, (yield* changes.ofTask(taskId))[0]?.url ?? '')
      yield* Effect.sleep(Duration.millis(300))
      const sql = yield* SqlClient.SqlClient
      yield* changes.exclusive(
        taskId,
        sql`UPDATE external_links SET snapshot = json_set(snapshot, '$.headSha', ${head}) WHERE kind = 'change' AND task_id = ${taskId}`,
      )
    })

  /** Someone pushes to the pull request's branch from elsewhere: a commit the task's worktree doesn't have. */
  const pushFromElsewhere = (bare: string, branch: string) => {
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: 'Dana',
      GIT_AUTHOR_EMAIL: 'dana@althar.test',
      GIT_COMMITTER_NAME: 'Dana',
      GIT_COMMITTER_EMAIL: 'dana@althar.test',
    }
    const tip = remoteHead(bare, branch)
    const made = execFileSync('git', ['commit-tree', `${tip}^{tree}`, '-p', tip, '-m', 'From elsewhere'], { cwd: bare, env })
      .toString()
      .trim()
    git(bare, 'update-ref', `refs/heads/${branch}`, made)
  }

  it.live('goes by what the pull request has now, never an older commit a stale reading names', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const changes = yield* Changes
      const task = yield* opened(working)
      const first = remoteHead(bare, task.branch)
      // The person pushes the lead's next commit; Althar's reading of the pull request is still from before it, with a real head.
      commit(task.path, 'Next')
      yield* changes.push(task.taskId, git(task.path, 'rev-parse', 'HEAD'))
      assert.notStrictEqual(remoteHead(bare, task.branch), first)
      yield* staleReading(task.taskId, first)
      // The lead rewrites what went up: the stale head is still under the branch, but what the pull request has isn't, so nothing can go up.
      commit(task.path, 'Next, again', '--amend')
      assert.include(yield* callTool(task.lead, 'push_to_pull_request', {}), "Your branch no longer has PR #1's head")
      assert.lengthOf(yield* asked(task.threadId), 0)
      // Back on top of what went up, only what is new is asked for, not what the stale head would add.
      git(task.path, 'reset', '-q', '--hard', remoteHead(bare, task.branch))
      commit(task.path, 'Then')
      assert.include(yield* callTool(task.lead, 'push_to_pull_request', {}), 'Asked the person to push 1 commit to PR #1.')
      assert.deepStrictEqual(
        (yield* asked(task.threadId))[0]?.commits.map((one) => one.subject),
        ['Then'],
      )
      // Pushed to from elsewhere, the pull request has commits the branch doesn't: nothing can go up until they're in it.
      pushFromElsewhere(bare, task.branch)
      commit(task.path, 'After')
      assert.include(yield* callTool(task.lead, 'push_to_pull_request', {}), "PR #1 has commits your branch doesn't")
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('shows what is on the branch now where it moved, without what already went up, or why it can’t go up', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const changes = yield* Changes
      const task = yield* opened(working)
      const first = remoteHead(bare, task.branch)
      commit(task.path, 'Next')
      yield* changes.push(task.taskId, git(task.path, 'rev-parse', 'HEAD'))
      yield* staleReading(task.taskId, first)
      commit(task.path, 'Then')
      yield* callTool(task.lead, 'push_to_pull_request', {})
      const [card] = yield* asked(task.threadId)
      // The lead rewrites what the card showed: it shows what is on the branch now, and nothing that went up already.
      commit(task.path, 'Then, again', '--amend')
      yield* Effect.flip(changes.push(task.taskId, card?.head ?? '', card?.url ?? ''))
      const [moved] = yield* asked(task.threadId)
      assert.deepInclude(moved, { moved: true, count: 1, blocked: null, state: 'open', head: git(task.path, 'rev-parse', 'HEAD') })
      assert.deepStrictEqual(
        moved?.commits.map((one) => one.subject),
        ['Then, again'],
      )
      // The lead drops what went up: what is on the branch can't go up without forcing, and the card says so rather than that nothing is new.
      git(task.path, 'reset', '-q', '--hard', first)
      commit(task.path, 'Instead')
      const refused = yield* Effect.flip(changes.push(task.taskId, moved?.head ?? '', moved?.url ?? ''))
      assert.strictEqual(refused instanceof Error ? refused.name : String(refused), 'ChangedSinceSeen')
      const [blocked] = yield* asked(task.threadId)
      assert.deepInclude(blocked, { moved: true, count: 0, blocked: 'rewritten', state: 'open' })
      assert.lengthOf(blocked?.commits ?? [], 0)
      assert.notInclude(git(bare, 'log', '--format=%s', task.branch), 'Instead')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('is refused where the branch no longer has what the pull request has', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const task = yield* opened(working)
      // The lead rewrites the commit that went up: pushing would need forcing.
      commit(task.path, 'Change it, better', '--amend')
      assert.include(yield* callTool(task.lead, 'push_to_pull_request', {}), "Your branch no longer has PR #1's head")
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

describe('what an earlier launch was doing outside', () => {
  it.live('is uncertain after a restart, and read back rather than done twice', () => {
    const database = join(mkdtempSync(join(tmpdir(), 'althar-outward-')), 'althar.sqlite')
    const github = makeFakeService()
    return Effect.gen(function* () {
      const projectId = yield* Effect.scoped(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const instance = yield* Instance
          const projects = yield* Projects
          const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: hosted().working })
          const at = new Date().toISOString()
          yield* sql`INSERT INTO work_items ${sql.insert({
            id: `work_${'1'.repeat(32)}`,
            projectId: project.projectId,
            kind: 'reply',
            subjectType: 'task',
            subjectId: 'x',
            payload: '{}',
            state: 'claimed',
            claimedByInstanceId: instance.id,
            leaseExpiresAt: at,
            attempts: 1,
            availableAt: at,
            createdAt: at,
            updatedAt: at,
          })}`
          yield* sql`INSERT INTO mutation_receipts ${sql.insert({
            id: `mut_${'1'.repeat(32)}`,
            projectId: project.projectId,
            workItemId: `work_${'1'.repeat(32)}`,
            target: 'github:meridian/api',
            operation: 'reply',
            idempotencyKey: 'reply:x',
            state: 'intended',
            request: '{}',
            createdAt: at,
          })}`
          return project.projectId
        }).pipe(Effect.provide(runtime(database, {}, { connectors: fakeConnectors({ github }) }))),
      )
      yield* Effect.scoped(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [receipt] = yield* sql<{ state: string }>`SELECT state FROM mutation_receipts WHERE project_id = ${projectId}`
          const [work] = yield* sql<{ state: string }>`SELECT state FROM work_items WHERE project_id = ${projectId}`
          assert.strictEqual(receipt?.state, 'uncertain')
          assert.strictEqual(work?.state, 'uncertain')
        }).pipe(Effect.provide(runtime(database, {}, { connectors: fakeConnectors({ github }) }))),
      )
    })
  })
})

/*
 * A change in Althar's hands (ADR-040): its work came back with a pull
 * request, and the person hasn't opened the task since. Althar sees its
 * checks through: under way while they run, its lead fixing a failure
 * alone, started again if it must be, and each fix pushed as the lead asks,
 * for FIX_ROUNDS fixes; then the change is the person's.
 */
