import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
import { fakeConnectors, HOST, hosted, runtime, until } from './support'

/*
 * A task's next pull request, after its last merged (ADR-034), where the
 * worktree isn't as a plain round leaves it: what the lead changed and didn't
 * commit, the default branch it brought in itself, a binary file, or a
 * worktree that is gone.
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
    const [ready] = yield* until(
      cards(project.projectId),
      (all) => all[0]?.phase === 'ready' && all[0].change !== null,
      Duration.seconds(30),
    )
    const card = ready ?? assert.fail('no card')
    // The host squashes it into main: one commit with the branch's change, the branch left as it was.
    const clone = mkdtempSync(join(tmpdir(), 'althar-merge-'))
    execFileSync('git', ['clone', '-q', bare, clone])
    git(clone, 'merge', '-q', '--squash', 'origin/althar/add-a-retry')
    git(clone, 'commit', '-q', '-m', 'Squashed althar/add-a-retry')
    git(clone, 'push', '-q', 'origin', 'main')
    github.mergeByHand(1)
    yield* (yield* Changes).refresh(card.taskId)
    yield* until(cards(project.projectId), (all) => all[0]?.phase === 'settled', Duration.seconds(10))
    const sql = yield* SqlClient.SqlClient
    const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${card.taskId}`
    return { projectId: project.projectId, taskId: card.taskId, path: workspace?.path ?? '' }
  })

describe('a task’s next pull request, from its worktree as it is', () => {
  it.live(
    'isn’t opened while what the lead changed isn’t committed, and its branch stays as it was',
    () => {
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
    },
    60_000,
  )

  it.live(
    'goes on a branch from the task’s own where the lead brought what merged in already, and counts a binary file as no lines',
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
        yield* (yield* Runs).publish(task.taskId)
        yield* until(
          Effect.sync(() => github.changes),
          (all) => all.length === 2,
        )
        // Its new branch is the task's as it was, nothing picked onto main again.
        assert.strictEqual(git(task.path, 'rev-parse', '--abbrev-ref', 'HEAD'), 'althar/add-a-retry-2')
        assert.strictEqual(git(task.path, 'rev-parse', 'HEAD'), head)
        assert.strictEqual(github.changes[1]?.source, 'althar/add-a-retry-2')
      }).pipe(Effect.provide(runtimeWith(github)))
    },
    60_000,
  )

  it.live(
    'is nothing to open once its worktree is gone',
    () => {
      const { working, bare, github } = onGitHub()
      return Effect.gen(function* () {
        const task = yield* merged(working, bare, github)
        commitIn(task.path, 'slider.txt', 'Slider')
        yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready' && all[0].unshipped != null)
        assert.lengthOf(yield* (yield* Changes).unshipped(task.taskId), 1)
        rmSync(task.path, { recursive: true, force: true })
        assert.deepStrictEqual(yield* (yield* Changes).unshipped(task.taskId), [])
      }).pipe(Effect.provide(runtimeWith(github)))
    },
    60_000,
  )
})
