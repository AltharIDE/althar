import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Reviews } from '../src/Reviews'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import * as Runtime from '../src/Runtime'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, notices, runtime, until } from './support'

/*
 * Reviews of someone else's pull request, at their edges: a lead started on
 * the model and effort the person chose, and a review posted once the
 * connection it would go through is gone.
 */

const withQueries = (github: FakeService) =>
  Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }) })))

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Nine', '-c', 'user.email=nine@althar.test', ...args], { cwd })
    .toString()
    .trim()

/** Someone else's pull request: a commit on main, on the host only as the pull request's head. */
const pullRequest = (at: { readonly working: string; readonly bare: string }, github: FakeService) => {
  git(at.working, 'checkout', '-q', '--detach', 'main')
  writeFileSync(join(at.working, 'send.ts'), 'export const sendBack = () => 1\n')
  git(at.working, 'add', '.')
  git(at.working, 'commit', '-q', '-m', 'Send back')
  const head = git(at.working, 'rev-parse', 'HEAD')
  git(at.working, 'checkout', '-q', 'main')
  git(at.working, 'push', '-q', at.bare, `${head}:refs/pull/1/head`)
  return github.addPullRequest({ path: ['meridian', 'api'], title: 'Send back', author: 'ninemate', headSha: head })
}

/** A connected GitHub and the repository opened as a project. */
const opened = (working: string) =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    const connection = yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    return { projectId: project.projectId as ProjectId, connectionId: connection.id, personId: instance.personId }
  })

describe('a review, at its edges', () => {
  it.live('starts its lead on the model and effort the person chose', () => {
    const at = hosted()
    const github = makeFakeService({ pushUrl: () => at.bare })
    github.addRepository(['meridian', 'api'])
    pullRequest(at, github)
    return Effect.gen(function* () {
      const { projectId } = yield* opened(at.working)
      const started = yield* (yield* Reviews).start({
        envelope: yield* Runtime.envelope('review.start', {}),
        projectId,
        pullRequest: '#1',
        lead: { agentId: 'claude-code', model: 'large', effort: 'high' },
      })
      const sql = yield* SqlClient.SqlClient
      const [session] = yield* until(
        sql<{
          model: string | null
          effort: string | null
        }>`SELECT model, effort FROM provider_sessions WHERE thread_id = ${started.threadId}`,
        (rows) => rows.length > 0,
      )
      assert.deepStrictEqual(session, { model: 'large', effort: 'high' })
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('isn’t posted once the connection it goes through is gone, and says so', () => {
    const at = hosted()
    const github = makeFakeService({ pushUrl: () => at.bare })
    github.addRepository(['meridian', 'api'])
    pullRequest(at, github)
    return Effect.gen(function* () {
      const { projectId, connectionId, personId } = yield* opened(at.working)
      const reviews = yield* Reviews
      const started = yield* reviews.start({
        envelope: yield* Runtime.envelope('review.start', {}),
        projectId,
        pullRequest: '#1',
        lead: { agentId: 'claude-code', model: null },
      })
      const lead: ToolAccess = { role: 'lead', projectId, threadId: started.threadId, sessionId: 'none', taskId: started.taskId }
      // Its lead stopped, the draft is nobody's in particular.
      yield* (yield* Sessions).stop(started.threadId)
      assert.match(yield* callTool(lead, 'draft_review', { verdict: 'approve', summary: 'Fine.' }), /^Drafted/)
      // Called from no task, it says it is a review's.
      assert.strictEqual(
        yield* callTool({ ...lead, taskId: null }, 'draft_review', { verdict: 'approve', summary: 'Fine.' }),
        'This task doesn’t review someone else’s pull request: draft_review is for one that does.',
      )
      const sql = yield* SqlClient.SqlClient
      const [draft] = yield* sql<{ id: string }>`SELECT id FROM review_drafts WHERE task_id = ${started.taskId}`
      yield* (yield* Connections).remove(connectionId, personId)
      const card = yield* reviews.post(draft?.id ?? '', personId)
      assert.deepInclude(card, { state: 'failed', error: 'The connection to GitHub is gone. Connect it again, then try again.' })
      assert.lengthOf(github.reviewsPosted, 0)
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('says it couldn’t make a copy of the code to read where its folder can’t be written, and starts no lead', () => {
    const at = hosted()
    const github = makeFakeService({ pushUrl: () => at.bare })
    github.addRepository(['meridian', 'api'])
    pullRequest(at, github)
    return Effect.gen(function* () {
      const { projectId } = yield* opened(at.working)
      // A file where the review's folder in the project's folder of worktrees would go, so its copy can't be made there.
      const other = yield* (yield* Projects).createTask({ envelope: yield* Runtime.envelope('task.create', {}), projectId, title: 'Other' })
      const sql = yield* SqlClient.SqlClient
      const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${other.taskId}`
      writeFileSync(join(dirname(dirname(workspace?.path ?? '')), 'review-1-send-back'), '')
      const started = yield* (yield* Reviews).start({
        envelope: yield* Runtime.envelope('review.start', {}),
        projectId,
        pullRequest: '#1',
        lead: { agentId: 'claude-code', model: null },
      })
      assert.deepInclude(started, { already: false, leading: false })
      assert.include(
        (yield* notices(started.threadId)).map((notice) => notice.title),
        'Althar couldn’t make a copy of the pull request #1’s code to read.',
      )
      const [copy] = yield* sql<{ state: string }>`SELECT state FROM workspaces WHERE task_id = ${started.taskId}`
      assert.strictEqual(copy?.state, 'failed')
      assert.lengthOf(yield* sql`SELECT id FROM provider_sessions WHERE thread_id = ${started.threadId}`, 0)
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('is listed as reviewed before once its task is over, for the coordinator to start another', () => {
    const at = hosted()
    const github = makeFakeService({ pushUrl: () => at.bare })
    github.addRepository(['meridian', 'api'])
    pullRequest(at, github)
    return Effect.gen(function* () {
      const { projectId } = yield* opened(at.working)
      const started = yield* (yield* Reviews).start({
        envelope: yield* Runtime.envelope('review.start', {}),
        projectId,
        pullRequest: '#1',
        lead: { agentId: 'claude-code', model: null },
      })
      yield* (yield* Tasks).abandon({
        envelope: yield* Runtime.envelope('task.abandon', { taskId: started.taskId }),
        taskId: started.taskId,
      })
      const coordinator: ToolAccess = {
        role: 'coordinator',
        projectId,
        threadId: yield* (yield* Coordinator).thread(projectId),
        sessionId: 'coordinator-session',
        taskId: null,
      }
      const found = yield* callTool(coordinator, 'find_pull_requests', {})
      assert.include(found, `task ${started.slug} reviewed it before`)
      assert.notInclude(found, 'reviews it already')
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('reads a pull request whose history never meets its base from where the base is', () => {
    const at = hosted()
    const github = makeFakeService({ pushUrl: () => at.bare })
    github.addRepository(['meridian', 'api'])
    // A head with a history of its own, as an import of another repository is.
    git(at.working, 'checkout', '-q', '--orphan', 'imported')
    writeFileSync(join(at.working, 'send.ts'), 'export const sendBack = () => 1\n')
    git(at.working, 'add', '.')
    git(at.working, 'commit', '-q', '-m', 'Import')
    const head = git(at.working, 'rev-parse', 'HEAD')
    git(at.working, 'checkout', '-q', '-f', 'main')
    git(at.working, 'push', '-q', at.bare, `${head}:refs/pull/1/head`)
    github.addPullRequest({ path: ['meridian', 'api'], title: 'Import', author: 'ninemate', headSha: head })
    const main = git(at.working, 'rev-parse', 'main')
    return Effect.gen(function* () {
      const { projectId } = yield* opened(at.working)
      const started = yield* (yield* Reviews).start({
        envelope: yield* Runtime.envelope('review.start', {}),
        projectId,
        pullRequest: '#1',
        lead: { agentId: 'claude-code', model: null },
      })
      const sql = yield* SqlClient.SqlClient
      const [copy] = yield* sql<{ state: string; baseCommit: string | null }>`
        SELECT state, base_commit FROM workspaces WHERE task_id = ${started.taskId}`
      assert.deepStrictEqual(copy, { state: 'ready', baseCommit: main })
    }).pipe(Effect.provide(withQueries(github)))
  })
})
