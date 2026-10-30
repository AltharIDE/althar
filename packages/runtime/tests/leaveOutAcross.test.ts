import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import { fakeConnectors, HOST, notices, runtime, until } from './support'

/*
 * A done task of two repositories, one merged through its pull request and
 * one merged here, with commits after in each: leaving them out says, for
 * each repository, what they came after.
 */

const git = (cwd: string, ...args: Array<string>) => execFileSync('git', args, { cwd }).toString().trim()

const commitIn = (path: string, file: string, message: string) => {
  appendFileSync(join(path, file), `${message}\n`)
  git(path, 'add', '-A')
  git(path, '-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', 'commit', '-q', '-m', message)
  return git(path, 'rev-parse', 'HEAD')
}

describe('a done task of two repositories with commits after in each', () => {
  it.live('leaves them out, saying what they came after in each: a pull request, or where its branch started', () => {
    const folder = realpathSync(mkdtempSync(join(tmpdir(), 'althar-folder-')))
    const bares: Record<string, string> = {}
    for (const name of ['api', 'web']) {
      const path = join(folder, name)
      mkdirSync(path)
      git(path, 'init', '-q', '-b', 'main')
      writeFileSync(join(path, 'README.md'), `# ${name}\n`)
      git(path, 'add', '.')
      git(path, '-c', 'user.name=T', '-c', 'user.email=t@t.test', 'commit', '-q', '-m', 'Start')
      git(path, 'remote', 'add', 'origin', `${HOST}/meridian/${name}.git`)
      bares[name] = mkdtempSync(join(tmpdir(), 'althar-remote-'))
      execFileSync('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: bares[name] })
      git(path, 'push', '-q', bares[name] ?? '', 'main')
    }
    const github = makeFakeService({ pushUrl: (path) => bares[path.at(-1) ?? ''] ?? '' })
    github.addRepository(['meridian', 'api'])
    github.addRepository(['meridian', 'web'])
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const instance = yield* Instance
      const projects = yield* Projects
      const plans = yield* Plans
      const changes = yield* Changes
      const queries = yield* Queries
      yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: folder })
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Share the retry',
        description: '[lead:finish]',
        draft: true,
        repositories: ['api', 'web'],
      })
      const worktrees = yield* sql<{ slug: string; path: string }>`
          SELECT b.slug, w.path FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
          WHERE w.task_id = ${task.taskId} ORDER BY b.created_at, b.rowid`
      const [api, web] = worktrees
      const card = Effect.map(queries.coordinator(project.projectId), (snapshot) =>
        snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : [])),
      )
      // Its plan changes api alone, whose pull request opens; web gets a commit in no pull request.
      commitIn(api?.path ?? '', 'retry.txt', 'Retry')
      const planId = yield* plans.propose({
        projectId: project.projectId as ProjectId,
        taskId: task.taskId,
        steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
        reason: null,
        actorId: instance.personId,
      })
      yield* plans.start(planId, instance.personId)
      yield* until(Effect.orDie(card), (all) => all[0]?.phase === 'ready' && all[0].change !== null)
      const webHead = commitIn(web?.path ?? '', 'retry.txt', 'Web first')

      // api's merges on the host, and web is merged here: the task is done.
      github.mergeByHand(1)
      yield* changes.refresh(task.taskId)
      yield* until(Effect.orDie(card), (all) => all[0]?.change?.state === 'merged')
      yield* changes.mergeHere(task.taskId, [{ repository: web?.slug ?? '', head: webHead }])
      yield* until(sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${task.taskId}`, ([row]) => row?.state === 'done')

      // A commit after in each, in no pull request.
      commitIn(api?.path ?? '', 'retry.txt', 'More for api')
      commitIn(web?.path ?? '', 'retry.txt', 'More for web')
      yield* until(Effect.orDie(card), (all) => all[0]?.unshipped?.commits === 2)
      // Its lead, stopped as it merged, started again since, as by the person writing to it.
      const sessions = yield* Sessions
      yield* sessions.startLast(task.threadId)
      assert.isTrue(Option.isSome(yield* sessions.running(task.threadId)))
      yield* (yield* Tasks).leaveOut({ envelope: yield* Runtime.envelope('task.leave_out', {}), taskId: task.taskId })
      assert.include(
        (yield* notices(task.threadId)).map((notice) => notice.title),
        'Abandoned 1 commit after PR #1 in api, 1 commit after where its branch started in web.',
      )
      // Settled again without them, its lead stops.
      yield* until(
        Effect.map(sessions.running(task.threadId), (running) => (Option.isNone(running) ? [true] : [])),
        (gone) => gone.length === 1,
      )
    }).pipe(
      Effect.provide(
        Queries.layer.pipe(
          Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.millis(100) })),
        ),
      ),
    )
  })
})
