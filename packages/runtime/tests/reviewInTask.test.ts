import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Reviews } from '../src/Reviews'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { callTool, fakeConnectors, HOST, hosted, items, runtime, until } from './support'

/*
 * Any task can review a pull request (a task is a conversation plus parts,
 * "Reviewing"): a change reviews a related one in its own repository, with a
 * read-only copy beside its worktree, its lead drafting the review as a
 * review task's does. The task stays the change's: it settles once its own
 * work is done, not as the review posts.
 */

const runtimeWith = (github: FakeService) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) })),
  )

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Nine', '-c', 'user.email=nine@althar.test', ...args], { cwd })
    .toString()
    .trim()

const cards = (projectId: string) =>
  Effect.gen(function* () {
    const snapshot = yield* Effect.orDie((yield* Queries).coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

describe('a change reviewing a related pull request', () => {
  it.live('reviews it from a copy beside its worktree, drafts it, and stays open once the review posts', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
      const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const coordinator = yield* Coordinator
      const threadId = yield* coordinator.thread(project.projectId)
      const body = 'Add a retry. [coordinator:plan] [coordinator:plan-no-review] [lead:finish] [lead:edit]'
      yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
      const [ready] = yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready' && all[0].change !== null)
      const card = ready ?? assert.fail('no card')
      yield* until(
        Effect.flatMap(Sessions, (sessions) => sessions.busy(card.threadId)),
        (busy) => !busy,
      )
      // A colleague's related pull request, on the host.
      git(working, 'checkout', '-q', '--detach', 'main')
      writeFileSync(join(working, 'backoff.ts'), 'export const backoff = 2\n')
      git(working, 'add', '.')
      git(working, 'commit', '-q', '-m', 'Backoff')
      const head = git(working, 'rev-parse', 'HEAD')
      git(working, 'checkout', '-q', 'main')
      git(working, 'push', '-q', bare, `${head}:refs/pull/2/head`)
      github.addPullRequest({ path: ['meridian', 'api'], title: 'Back off', author: 'dana', body: '', headSha: head })

      const sql = yield* SqlClient.SqlClient
      const [lead] = yield* sql<{ id: string }>`
        SELECT id FROM provider_sessions WHERE thread_id = ${card.threadId} ORDER BY started_at DESC LIMIT 1`
      const access = {
        role: 'lead' as const,
        projectId: project.projectId,
        threadId: card.threadId,
        sessionId: lead?.id ?? '',
        taskId: card.taskId,
      }
      const said = yield* callTool(access, 'add_review', { pull_request: '#2' })
      assert.include(said, 'reviews PR #2 now, beside its own work')
      const [own, copy] = yield* sql<{ access: string; path: string; reviewing: string | null }>`
        SELECT access, path, reviewing FROM workspaces WHERE task_id = ${card.taskId} ORDER BY created_at, rowid`
      assert.strictEqual(copy?.access, 'read')
      assert.isNotNull(copy?.reviewing ?? null)
      // Beside the task's worktree, at the pull request's head, detached.
      assert.strictEqual(dirname(copy?.path ?? ''), dirname(own?.path ?? ''))
      assert.isTrue(existsSync(join(copy?.path ?? '', 'backoff.ts')))
      assert.strictEqual(git(copy?.path ?? '', 'rev-parse', 'HEAD'), head)
      // The task is still the change's: its card says so, and its lead keeps its own tools.
      const [still] = yield* cards(project.projectId)
      assert.strictEqual(still?.kind, 'change')
      assert.isTrue(
        (yield* items(card.threadId)).some(
          (item) => item.kind === 'notice' && String(item.content.title).startsWith('Reviews dana’s PR #2'),
        ),
      )

      // Its lead drafts the review; posted, the review goes up and the task stays open, its own pull request still to merge.
      yield* callTool(access, 'draft_review', { verdict: 'comment', summary: 'The backoff matches the retry.' })
      const [draft] = yield* sql<{ id: string }>`SELECT id FROM review_drafts WHERE task_id = ${card.taskId}`
      yield* (yield* Reviews).post(draft?.id ?? '', instance.personId)
      const [task] = yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${card.taskId}`
      assert.strictEqual(task?.state, 'open')
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})
