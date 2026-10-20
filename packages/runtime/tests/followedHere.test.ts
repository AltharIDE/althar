import { execFileSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'

import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { fakeConnectors, HOST, hosted, runtime } from './support'

/*
 * A pull request a task follows, as its thread shows it against the task's
 * branch here: where that branch has no commit yet, as one started over and
 * not yet committed to, and where the worktree is gone.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Nine', '-c', 'user.email=nine@althar.test', ...args], { cwd })
    .toString()
    .trim()

const commit = (cwd: string, file: string, text: string) => {
  writeFileSync(join(cwd, file), text)
  git(cwd, 'add', file)
  git(cwd, 'commit', '-q', '-m', `Write ${file}`)
  return git(cwd, 'rev-parse', 'HEAD')
}

describe('a pull request a task follows, against its branch here', () => {
  it.live('has nothing here to push where the branch has no commit yet, nor where the worktree is gone', () => {
    const { working, bare } = hosted()
    git(working, 'checkout', '-q', '-b', 'fix-send-back')
    const head = commit(working, 'send.ts', 'export const sendBack = () => 1\n')
    git(working, 'push', '-q', bare, 'fix-send-back')
    git(working, 'checkout', '-q', 'main')
    git(working, 'branch', '-q', '-D', 'fix-send-back')
    const github: FakeService = makeFakeService({ pushUrl: () => bare, headOf: () => head })
    github.addRepository(['meridian', 'api'])
    github.addPullRequest({ path: ['meridian', 'api'], title: 'Send back', author: 'you', source: 'fix-send-back', headSha: head })
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const projects = yield* Projects
      const queries = yield* Queries
      yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
      const opened = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: opened.projectId,
        title: 'Answer the review',
      })
      const changes = yield* Changes
      assert.strictEqual(
        (yield* changes.attach({ taskId: task.taskId, pullRequest: '#1', start: true, actorId: instance.personId })).kind,
        'attached',
      )
      const shown = Effect.map(queries.thread(task.threadId, {}), (snapshot) =>
        snapshot.task.changes.map((change) => ({ localHead: change.localHead, unpushed: change.unpushed, diverged: change.diverged })),
      )
      commit(task.worktree, 'why.md', 'It restarts.\n')
      assert.deepStrictEqual(yield* shown, [{ localHead: git(task.worktree, 'rev-parse', 'HEAD'), unpushed: 1, diverged: null }])

      // The lead starts its branch over, and hasn't committed to it yet: there is no head here to push.
      git(task.worktree, 'checkout', '-q', '--orphan', 'again')
      assert.deepStrictEqual(yield* shown, [{ localHead: null, unpushed: 0, diverged: null }])

      // The worktree is gone: the pull request is as its host has it, with nothing of the branch here.
      rmSync(task.worktree, { recursive: true, force: true })
      assert.deepStrictEqual(yield* shown, [{ localHead: null, unpushed: 0, diverged: null }])
      assert.strictEqual((yield* queries.thread(task.threadId, {})).task.changes[0]?.url, 'https://github.com/meridian/api/pull/1')
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }) })))))
  })
})
