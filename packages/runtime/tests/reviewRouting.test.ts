import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { asksForReview, Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, items, runtime, until } from './support'

/*
 * A pull request the person asks to have reviewed is a review task's: read
 * only, its review drafted to post from its card (review_pull_request). A
 * coordinator that starts or drafts a task of work for it instead is refused,
 * told which tool it is; work on a pull request names it (draft_task's
 * pull_request) and goes on.
 */

const runtimeWith = (github: FakeService) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) })),
  )

describe('asking for a review', () => {
  it('is “review” beside a pull request named by its link or number, not work on its review', () => {
    for (const said of [
      'Review this PR please: https://github.com/AltharIDE/althar/pull/717',
      'can you review #42?',
      'Please review PR 12',
      'review https://gitlab.com/acme/api/-/merge_requests/9',
      'Reviewing !31 would help',
    ])
      assert.isTrue(asksForReview(said), said)
    for (const said of [
      'Address the review comments on #12',
      'Fix what the review findings on https://github.com/acme/api/pull/3 said',
      'Review the retry code',
      'Add a retry to the checkout call',
      'Open a pull request for the retry',
      'Add a retry for #12, no review needed',
      'Fix #12 without review',
    ])
      assert.isFalse(asksForReview(said), said)
  })
})

describe('a pull request the person asks to review', () => {
  it.live('is no task of work: start_task is refused, naming review_pull_request, and nothing is made', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const instance = yield* Instance
      yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
      const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const coordinator = yield* Coordinator
      const threadId = yield* coordinator.thread(project.projectId)
      // The coordinator, as a model might, starts a task of work for it in the turn the person's words began.
      const body = 'Review this PR please: https://github.test/meridian/api/pull/1 [coordinator:start]'
      yield* coordinator.say({
        envelope: yield* Runtime.envelope('thread.send', { body }),
        threadId,
        body,
        disposition: 'after_current',
        sender: { kind: 'window' },
      })
      const sessions = yield* Sessions
      yield* until(
        Effect.map(items(threadId), (all) => all.filter((item) => item.kind === 'agent_message')),
        (said) => said.length > 0,
      )
      yield* until(sessions.busy(threadId), (busy) => !busy)
      const sql = yield* SqlClient.SqlClient
      assert.lengthOf(yield* sql`SELECT id FROM tasks WHERE project_id = ${project.projectId}`, 0)
      const answered = JSON.stringify(yield* items(threadId))
      assert.include(answered, 'plan that with review_pull_request')
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('a lead asked to review a pull request', () => {
  it.live('attaches the review to its own task with add_review, and drafts it as a card the person posts', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    // A colleague's pull request, its head on the host.
    const git = (...args: Array<string>) => execFileSync('git', args, { cwd: working }).toString().trim()
    git('checkout', '-q', '-b', 'back-off', 'main')
    writeFileSync(join(working, 'backoff.ts'), 'export const backoff = 2\n')
    git('add', '.')
    git('-c', 'user.name=Dana', '-c', 'user.email=dana@althar.test', 'commit', '-q', '-m', 'Back off')
    const head = git('rev-parse', 'HEAD')
    git('checkout', '-q', 'main')
    git('push', '-q', bare, 'back-off')
    const pull = github.addPullRequest({ path: ['meridian', 'api'], title: 'Back off', author: 'dana', source: 'back-off', headSha: head })
    git('push', '-q', bare, `${head}:refs/pull/${pull.number}/head`)
    return Effect.gen(function* () {
      const instance = yield* Instance
      yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
      const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const threadId = yield* (yield* Coordinator).thread(project.projectId)
      const coordinator: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, sessionId: 'c', taskId: null }
      // A chat, started as a task of work would be.
      yield* callTool(coordinator, 'start_task', {
        title: 'Look at the back-off',
        description: 'Look. [lead:finish]',
        lead: { agent: 'claude-code' },
      })
      const sql = yield* SqlClient.SqlClient
      const [task] = yield* until(
        sql<{
          id: string
          threadId: string
        }>`SELECT k.id, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'`,
        (rows) => rows.length === 1,
      )
      const lead: ToolAccess = {
        role: 'lead',
        projectId: project.projectId,
        threadId: task?.threadId ?? '',
        sessionId: 'l',
        taskId: task?.id ?? '',
      }
      // Its lead attaches the review itself: a read-only copy of the pull request's head, beside its own folder.
      assert.include(yield* callTool(lead, 'add_review', { pull_request: `#${pull.number}` }), `reviews PR #${pull.number} now`)
      const [copy] = yield* sql<{ access: string; reviewing: string | null }>`
        SELECT access, reviewing FROM workspaces WHERE task_id = ${task?.id ?? ''} AND reviewing IS NOT NULL`
      assert.deepStrictEqual(copy, { access: 'read', reviewing: pull.url })
      // Its review is a draft card, nothing posted until the person posts it.
      assert.include(
        yield* callTool(lead, 'draft_review', { verdict: 'comment', summary: 'The back-off matches the retry.' }),
        'Nothing is posted until the person posts it from its card',
      )
      assert.lengthOf(yield* sql`SELECT id FROM review_drafts WHERE task_id = ${task?.id ?? ''}`, 1)
      assert.lengthOf(github.reviewsPosted, 0)
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})
