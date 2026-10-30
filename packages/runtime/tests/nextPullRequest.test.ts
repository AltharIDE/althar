import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import type { NoChangeToOpen } from '../src/errors'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { fakeConnectors, HOST, hosted, notices, runtime, until } from './support'

/*
 * A task's next pull request, after its last merged (ADR-034), where the
 * worktree isn't as a plain round leaves it: what the lead changed and didn't
 * commit, the default branch it brought in itself, a binary file, or a
 * worktree that is gone. And a pull request that merges with commits after
 * it, whose task isn't done yet.
 */

const runtimeWith = (github: FakeService) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.millis(100) })),
  )

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', ...args], { cwd })
    .toString()
    .trim()

const commitIn = (path: string, file: string, line: string) => {
  appendFileSync(join(path, file), `${line}\n`)
  git(path, 'add', '-A')
  git(path, 'commit', '-q', '-m', line)
  return git(path, 'rev-parse', 'HEAD')
}

const cards = (projectId: string) =>
  Effect.gen(function* () {
    const snapshot = yield* Effect.orDie((yield* Queries).coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

/** A repository on the fake GitHub, its lead committing as the person does. */
const onGitHub = () => {
  const { working, bare } = hosted()
  const github = makeFakeService({ pushUrl: () => bare })
  github.addRepository(['meridian', 'api'])
  git(working, 'config', 'user.name', 'Fake')
  git(working, 'config', 'user.email', 'fake@althar.test')
  return { working, bare, github }
}

/** A planned task whose draft pull request opened, and which the host merged by squashing it: settled. */
const merged = (working: string, bare: string, github: FakeService) =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const projects = yield* Projects
    const coordinator = yield* Coordinator
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const threadId = yield* coordinator.thread(project.projectId)
    const body = 'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]'
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
    const [ready] = yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready' && all[0].change !== null)
    const card = ready ?? assert.fail('no card')
    // The host squashes it into main: one commit with the branch's change, the branch left as it was.
    const clone = mkdtempSync(join(tmpdir(), 'althar-merge-'))
    execFileSync('git', ['clone', '-q', bare, clone])
    git(clone, 'merge', '-q', '--squash', 'origin/althar/add-a-retry')
    git(clone, 'commit', '-q', '-m', 'Squashed althar/add-a-retry')
    git(clone, 'push', '-q', 'origin', 'main')
    github.mergeByHand(1)
    yield* (yield* Changes).refresh(card.taskId)
    yield* until(cards(project.projectId), (all) => all[0]?.phase === 'settled')
    const sql = yield* SqlClient.SqlClient
    const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${card.taskId}`
    return { projectId: project.projectId, taskId: card.taskId, path: workspace?.path ?? '' }
  })

describe('a task whose pull request merges with commits after it', () => {
  it.live('isn’t done yet, and says how many commits aren’t in a pull request', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
      const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const coordinator = yield* Coordinator
      const threadId = yield* coordinator.thread(project.projectId)
      const body = 'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]'
      yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
      const [ready] = yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready' && all[0].change !== null)
      const sql = yield* SqlClient.SqlClient
      const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${ready?.taskId ?? ''}`
      // Two more commits on the task's branch, then the host merges what it had.
      commitIn(workspace?.path ?? '', 'slider.txt', 'Slider')
      commitIn(workspace?.path ?? '', 'slider.txt', 'Slider, warmer')
      github.mergeByHand(1)
      yield* (yield* Changes).refresh(ready?.taskId ?? '')
      const said = yield* until(notices(ready?.threadId ?? ''), (all) =>
        all.some((notice) => notice.title?.startsWith('Not done yet') === true),
      )
      const notDone = said.find((notice) => notice.title?.startsWith('Not done yet') === true)
      assert.strictEqual(notDone?.title, "Not done yet: 2 commits after PR #1 aren't in a pull request.")
      assert.strictEqual(notDone?.description, 'Open a new pull request for them from the task.')
      const [task] = yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${ready?.taskId ?? ''}`
      assert.strictEqual(task?.state, 'open')
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('a task’s next pull request, from its worktree as it is', () => {
  it.live('isn’t opened while what the lead changed isn’t committed, and its branch stays as it was', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* merged(working, bare, github)
      const head = commitIn(task.path, 'slider.txt', 'Slider')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready' && all[0].unshipped != null)
      appendFileSync(join(task.path, 'slider.txt'), 'Warmer, not committed\n')
      const refused = (yield* Effect.flip((yield* Runs).publish(task.taskId))) as NoChangeToOpen
      assert.deepStrictEqual([refused._tag, refused.why, refused.detail], ['NoChangeToOpen', 'uncommitted', 'slider.txt'])
      assert.strictEqual(git(task.path, 'rev-parse', '--abbrev-ref', 'HEAD'), 'althar/add-a-retry')
      assert.strictEqual(git(task.path, 'rev-parse', 'HEAD'), head)
      assert.lengthOf(github.changes, 1)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live(
    'goes on a branch from the task’s own, by the next free name, where the lead brought what merged in already, and counts a binary file as no lines',
    () => {
      const { working, bare, github } = onGitHub()
      return Effect.gen(function* () {
        const task = yield* merged(working, bare, github)
        // The lead merged main, with what the host squashed, into its branch, then went on.
        git(task.path, 'fetch', '-q', bare, 'main')
        git(task.path, 'merge', '-q', '--no-edit', 'FETCH_HEAD')
        writeFileSync(join(task.path, 'icon.bin'), Buffer.from([0, 1, 2, 3, 0, 255]))
        commitIn(task.path, 'slider.txt', 'Slider')
        const head = git(task.path, 'rev-parse', 'HEAD')
        const [ready] = yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready' && all[0].unshipped != null)
        // Main as this Mac has it hasn't the squash yet, so it counts too; the binary file counts no lines.
        assert.deepStrictEqual(ready?.unshipped, { commits: 2, add: 1, del: 0 })
        // A branch of the next one's name is here already, from before: it takes the next free one.
        git(task.path, 'branch', 'althar/add-a-retry-2', 'HEAD~1')
        yield* (yield* Runs).publish(task.taskId)
        yield* until(
          Effect.sync(() => github.changes),
          (all) => all.length === 2,
        )
        // Its new branch is the task's as it was, nothing picked onto main again.
        assert.strictEqual(git(task.path, 'rev-parse', '--abbrev-ref', 'HEAD'), 'althar/add-a-retry-3')
        assert.strictEqual(git(task.path, 'rev-parse', 'HEAD'), head)
        assert.strictEqual(github.changes[1]?.source, 'althar/add-a-retry-3')
      }).pipe(Effect.provide(runtimeWith(github)))
    },
  )

  it.live('is nothing to open once its worktree is gone', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* merged(working, bare, github)
      commitIn(task.path, 'slider.txt', 'Slider')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready' && all[0].unshipped != null)
      assert.lengthOf(yield* (yield* Changes).unshipped(task.taskId), 1)
      rmSync(task.path, { recursive: true, force: true })
      assert.deepStrictEqual(yield* (yield* Changes).unshipped(task.taskId), [])
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('opens nothing where main has taken the commit after it meanwhile, its change picked there by someone else', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* merged(working, bare, github)
      const mine = commitIn(task.path, 'slider.txt', 'Slider')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready' && all[0].unshipped != null)
      // Someone picks the same change onto main on the host, after Althar last fetched it.
      const clone = mkdtempSync(join(tmpdir(), 'althar-other-'))
      execFileSync('git', ['clone', '-q', bare, clone])
      git(clone, 'fetch', '-q', task.path, mine)
      git(clone, 'cherry-pick', 'FETCH_HEAD')
      git(clone, 'push', '-q', 'origin', 'main')
      const main = git(clone, 'rev-parse', 'HEAD')
      yield* (yield* Runs).publish(task.taskId)
      // Nothing new for a pull request: none opens, and the commit stays on the task's first branch.
      assert.lengthOf(github.changes, 1)
      assert.strictEqual(git(task.path, 'rev-parse', 'althar/add-a-retry'), mine)
      assert.strictEqual(git(task.path, 'rev-parse', 'HEAD'), main)
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('a settled task’s card, its worktree kept', () => {
  /**
   * Every git run, by the folder it runs in, counted by a git in front of the
   * real one on the PATH; while `failing` is set, its `rev-list` fails as git
   * does timed out or out of processes. `done` puts the PATH back.
   */
  const counted = () => {
    const shim = realpathSync(mkdtempSync(join(tmpdir(), 'althar-git-count-')))
    const log = join(shim, 'calls')
    const flag = join(shim, 'failing')
    const real = execFileSync('sh', ['-c', 'command -v git']).toString().trim()
    writeFileSync(
      join(shim, 'git'),
      [
        '#!/bin/sh',
        `echo "$(pwd -P) $*" >> '${log}'`,
        `case " $* " in *" rev-list "*) [ -e '${flag}' ] && exit 128 ;; esac`,
        `exec '${real}' "$@"`,
        '',
      ].join('\n'),
      { mode: 0o755 },
    )
    const path = process.env.PATH
    process.env.PATH = `${shim}:${path ?? ''}`
    return {
      ranIn: (folder: string) => {
        const lines = existsSync(log) ? readFileSync(log, 'utf8').split('\n') : []
        rmSync(log, { force: true })
        // Each by its command: what comes before it, such as `-c core.hooksPath=/dev/null`, left out.
        return lines
          .filter((line) => line.startsWith(`${folder} `))
          .map((line) =>
            line
              .slice(folder.length + 1)
              .split(' ')
              .find((word) => !word.startsWith('-') && !word.includes('=')),
          )
      },
      failing: (on: boolean) => (on ? writeFileSync(flag, '') : rmSync(flag, { force: true })),
      done: Effect.sync(() => {
        process.env.PATH = path
        rmSync(shim, { recursive: true, force: true })
      }),
    }
  }

  // Not on Windows: git is counted by a shell script on the PATH.
  it.live.skipIf(process.platform === 'win32')(
    'reads what is after its pull request from git once, then only the commits that follows from, until one moves',
    () => {
      const { working, bare, github } = onGitHub()
      return Effect.gen(function* () {
        const task = yield* merged(working, bare, github)
        const folder = realpathSync(task.path)
        const git = counted()
        yield* Effect.gen(function* () {
          yield* cards(task.projectId)
          git.ranIn(folder)
          // A coordinator's thread, a board and the home read every card, each time any task changes: the same commits, no more git.
          const [again] = yield* cards(task.projectId)
          assert.strictEqual(again?.phase, 'settled')
          assert.deepStrictEqual(
            git.ranIn(folder).filter((command) => command !== 'cat-file'),
            [],
          )
          // A commit after it: read again, it shows.
          commitIn(task.path, 'slider.txt', 'Slider')
          const [moved] = yield* cards(task.projectId)
          assert.strictEqual(moved?.phase, 'ready')
          assert.deepStrictEqual(moved?.unshipped, { commits: 1, add: 1, del: 0 })
          assert.include(git.ranIn(folder), 'rev-list')
        }).pipe(Effect.ensuring(git.done))
      }).pipe(Effect.provide(runtimeWith(github)))
    },
  )

  it.live.skipIf(process.platform === 'win32')(
    'keeps nothing git failed to read: the next read, its commits the same, finds what is after its pull request',
    () => {
      const { working, bare, github } = onGitHub()
      return Effect.gen(function* () {
        const task = yield* merged(working, bare, github)
        const folder = realpathSync(task.path)
        commitIn(task.path, 'slider.txt', 'Slider')
        const git = counted()
        yield* Effect.gen(function* () {
          git.failing(true)
          const [failed] = yield* cards(task.projectId)
          assert.include(git.ranIn(folder), 'rev-list')
          // git couldn't list them: the card says less than there is, this once.
          assert.strictEqual(failed?.phase, 'settled')
          git.failing(false)
          const [after] = yield* cards(task.projectId)
          assert.strictEqual(after?.phase, 'ready')
          assert.deepStrictEqual(after?.unshipped, { commits: 1, add: 1, del: 0 })
          // Once read in full, it is kept.
          git.ranIn(folder)
          yield* cards(task.projectId)
          assert.deepStrictEqual(
            git.ranIn(folder).filter((command) => command !== 'cat-file'),
            [],
          )
        }).pipe(Effect.ensuring(git.done))
      }).pipe(Effect.provide(runtimeWith(github)))
    },
  )
})
