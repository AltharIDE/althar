import { execFileSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { AttachRefused } from '../src/errors'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { ReviewRefused, Reviews } from '../src/Reviews'
import * as Runtime from '../src/Runtime'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, notices, runtime } from './support'

/*
 * A project of two repositories on the same connected host, api and web:
 * a pull request named only by its number names none of them, and one
 * attached by its link says which repository it is in.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Nine', '-c', 'user.email=nine@althar.test', ...args], { cwd })
    .toString()
    .trim()

/** Someone's branch on a repository, pushed to its remote: its head. */
const branchOn = (at: { readonly working: string; readonly bare: string }, branch: string) => {
  git(at.working, 'checkout', '-q', '-b', branch)
  writeFileSync(join(at.working, `${branch}.ts`), `export const ${branch.replace(/-/g, '')} = 1\n`)
  git(at.working, 'add', '.')
  git(at.working, 'commit', '-q', '-m', `Write ${branch}`)
  const head = git(at.working, 'rev-parse', 'HEAD')
  git(at.working, 'push', '-q', at.bare, branch)
  git(at.working, 'checkout', '-q', 'main')
  return head
}

/** api and web on the fake host, with pull requests #1 and #2 on web and #3 on api, each from a branch of its own. */
const twoRepositories = () => {
  const api = hosted(['meridian', 'api'])
  const web = hosted(['meridian', 'web'])
  const heads = new Map<number, string>([
    [1, branchOn(web, 'fix-nav')],
    [2, branchOn(web, 'fix-footer')],
    [3, branchOn(api, 'fix-retry')],
  ])
  const github: FakeService = makeFakeService({
    pushUrl: (path) => (path[1] === 'web' ? web.bare : api.bare),
    headOf: (number) => heads.get(number) ?? null,
  })
  github.addRepository(['meridian', 'api'])
  github.addRepository(['meridian', 'web'])
  github.addPullRequest({ path: ['meridian', 'web'], title: 'Fix the nav', author: 'you', source: 'fix-nav', headSha: heads.get(1) ?? '' })
  github.addPullRequest({
    path: ['meridian', 'web'],
    title: 'Fix the footer',
    author: 'you',
    source: 'fix-footer',
    headSha: heads.get(2) ?? '',
  })
  github.addPullRequest({
    path: ['meridian', 'api'],
    title: 'Fix the retry',
    author: 'you',
    source: 'fix-retry',
    headSha: heads.get(3) ?? '',
  })
  return { api, web, github }
}

const withQueries = (github: FakeService) =>
  Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }) })))

/** GitHub connected, and both repositories opened as one project: its id, their names, and a task across both. */
const opened = (api: string, web: string) =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    const projects = yield* Projects
    yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: api, repositories: [api, web] })
    const names = (yield* projects.repositories(project.projectId)).map((one) => one.name)
    const across = (title: string) =>
      Effect.gen(function* () {
        return yield* projects.createTask({
          envelope: yield* Runtime.envelope('task.create', {}),
          projectId: project.projectId,
          title,
          repositories: names,
        })
      })
    return { projectId: project.projectId as ProjectId, names, across, personId: instance.personId }
  })

describe('a project of two repositories on one connected host', () => {
  it.live('starts no review of a pull request named only by its number', () => {
    const { api, web, github } = twoRepositories()
    return Effect.gen(function* () {
      const { projectId, names } = yield* opened(api.working, web.working)
      const refused = yield* Effect.flip(
        (yield* Reviews).start({
          envelope: yield* Runtime.envelope('review.start', {}),
          projectId,
          pullRequest: '#1',
          lead: { agentId: 'claude-code', model: null },
        }),
      )
      assert.instanceOf(refused, ReviewRefused)
      assert.strictEqual(
        refused.message,
        `Several of the project’s repositories are on a connected host (${names.join(', ')}): give the pull request’s link.`,
      )
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('attaches a task across both by its pull request’s link, saying which repository it is in, and not by its number', () => {
    const { api, web, github } = twoRepositories()
    return Effect.gen(function* () {
      const { names, across, personId } = yield* opened(api.working, web.working)
      const task = yield* across('Fix the nav')
      const changes = yield* Changes
      const refused = yield* Effect.flip(changes.attach({ taskId: task.taskId, pullRequest: '#1', start: true, actorId: personId }))
      assert.instanceOf(refused, AttachRefused)
      assert.strictEqual(
        refused instanceof AttachRefused ? refused.message : '',
        `The task changes several repositories (${names.join(', ')}): give the pull request’s link.`,
      )
      const attached = yield* changes.attach({
        taskId: task.taskId,
        pullRequest: `${HOST}/meridian/web/pull/1`,
        start: true,
        actorId: personId,
      })
      assert.strictEqual(attached.kind, 'attached')
      assert.include(
        (yield* notices(task.threadId)).map((notice) => notice.title),
        `Following PR #1 in ${names[1] ?? ''}: Fix the nav`,
      )
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('attaches by its number where the task’s worktree of the other repository is gone', () => {
    const { api, web, github } = twoRepositories()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { across, personId } = yield* opened(api.working, web.working)
      const task = yield* across('Fix the footer')
      const [own] = yield* sql<{ path: string }>`
        SELECT w.path FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
        WHERE w.task_id = ${task.taskId} ORDER BY b.created_at, b.rowid LIMIT 1`
      rmSync(own?.path ?? '', { recursive: true, force: true })
      const attached = yield* (yield* Changes).attach({ taskId: task.taskId, pullRequest: '#2', start: true, actorId: personId })
      assert.strictEqual(attached.kind === 'attached' ? attached.change.url : '', 'https://github.com/meridian/web/pull/2')
      assert.include(
        (yield* notices(task.threadId)).map((notice) => notice.title),
        'Following PR #2: Fix the footer',
      )
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('lists each repository’s pull requests under its name, and has nothing to push to once a task’s two are merged', () => {
    const { api, web, github } = twoRepositories()
    return Effect.gen(function* () {
      const { projectId, names, across, personId } = yield* opened(api.working, web.working)
      const coordinator: ToolAccess = {
        role: 'coordinator',
        projectId,
        threadId: yield* (yield* Coordinator).thread(projectId),
        sessionId: 'coordinator-session',
        taskId: null,
      }
      const listed = yield* callTool(coordinator, 'find_pull_requests', {})
      assert.include(listed, `${names[0] ?? ''} (meridian/api)`)
      assert.include(listed, `${names[1] ?? ''} (meridian/web)`)

      // A task following a pull request in each.
      const task = yield* across('Fix both')
      const changes = yield* Changes
      for (const link of [`${HOST}/meridian/web/pull/1`, `${HOST}/meridian/api/pull/3`])
        assert.strictEqual(
          (yield* changes.attach({ taskId: task.taskId, pullRequest: link, start: true, actorId: personId })).kind,
          'attached',
        )
      const lead: ToolAccess = { role: 'lead', projectId, threadId: task.threadId, sessionId: 'none', taskId: task.taskId }
      // Both merged on the host: nothing is open to push to.
      github.mergeByHand(1)
      github.mergeByHand(3)
      yield* changes.refresh(task.taskId)
      assert.strictEqual(
        yield* callTool(lead, 'push_to_pull_request', {}),
        "None of this task's pull requests is open, so there's nothing to push to. What you committed goes in a new pull request, which the person opens from the task: if you haven't, call finish_step with your summary, and tell them it's ready.",
      )
    }).pipe(Effect.provide(withQueries(github)))
  })
})
