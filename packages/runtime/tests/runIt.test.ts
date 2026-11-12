import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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
import { reviewBriefOf, Reviews, runOutside, setRunOutside } from '../src/Reviews'
import * as Runtime from '../src/Runtime'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, items, listTools, runtime, sessionMetas, until } from './support'

/*
 * "Run it" on a pull request a task reviews (a task is a conversation plus
 * parts, "Running someone else's pull request"): the team's own runs as
 * theirs does at once; an outside author's runs only as far as the person
 * says, safely (its packages installed with their install scripts off, from
 * the registries its base branch names, run offline) or trusted fully.
 */

const withQueries = (github: FakeService) =>
  Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }) })))

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Nine', '-c', 'user.email=nine@althar.test', ...args], { cwd })
    .toString()
    .trim()

/** Someone's pull request with a package of no dependencies, its lockfile, and a registry setting it changed. */
const pullRequest = (at: { readonly working: string; readonly bare: string }, github: FakeService, outside: boolean) => {
  const { working, bare } = at
  writeFileSync(join(working, '.npmrc'), 'registry=https://registry.npmjs.org/\n')
  git(working, 'add', '.')
  git(working, 'commit', '-q', '-m', 'The registry')
  git(working, 'push', '-q', bare, 'main')
  git(working, 'checkout', '-q', '--detach', 'main')
  writeFileSync(join(working, 'package.json'), '{"name":"meridian","version":"1.0.0"}\n')
  writeFileSync(
    join(working, 'package-lock.json'),
    '{"name":"meridian","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"meridian","version":"1.0.0"}}}\n',
  )
  writeFileSync(join(working, '.npmrc'), 'registry=https://evil.example/\n')
  git(working, 'add', '.')
  git(working, 'commit', '-q', '-m', 'Package')
  const head = git(working, 'rev-parse', 'HEAD')
  git(working, 'checkout', '-q', 'main')
  git(working, 'push', '-q', bare, `${head}:refs/pull/1/head`)
  const pull = github.addPullRequest({
    path: ['meridian', 'api'],
    title: 'Package it',
    author: 'ninemate',
    body: '',
    headSha: head,
    ...(outside ? { member: false, fork: ['ninemate', 'api'] } : {}),
  })
  return { pull }
}

const project = (working: string) =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const projects = yield* Projects
    const opened = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const threadId = yield* (yield* Coordinator).thread(opened.projectId)
    const coordinator: ToolAccess = { role: 'coordinator', projectId: opened.projectId, threadId, sessionId: 'c', taskId: null }
    return { projectId: opened.projectId as ProjectId, coordinator }
  })

const reviewTask = (projectId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [task] = yield* sql<{ id: string; threadId: string }>`
      SELECT k.id, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
      WHERE k.project_id = ${projectId} ORDER BY k.created_at DESC LIMIT 1`
    const [workspace] = yield* sql<{ path: string; trust: string | null }>`
      SELECT path, trust FROM workspaces WHERE task_id = ${task?.id ?? ''}`
    return { task: task ?? assert.fail('no task'), workspace: workspace ?? assert.fail('no workspace') }
  })

const notices = (threadId: string) =>
  Effect.map(items(threadId), (all) => all.flatMap((item) => (item.kind === 'notice' ? [String(item.content.title)] : [])))

describe('Run it', () => {
  it.live(
    'asks how far to trust an outside author’s code, runs it safely with install scripts off and the base’s registry, offline',
    () => {
      const at = hosted()
      const github = makeFakeService({ pushUrl: () => at.bare })
      github.addRepository(['meridian', 'api'])
      const { pull } = pullRequest(at, github, true)
      return Effect.gen(function* () {
        const { projectId, coordinator } = yield* project(at.working)
        yield* callTool(coordinator, 'review_pull_request', { pull_request: `#${pull.number}`, lead: { agent: 'claude-code' } })
        const { task, workspace } = yield* reviewTask(projectId)
        yield* until(
          Effect.map(items(task.threadId), (all) => all.filter((item) => item.kind === 'agent_message')),
          (all) => all.length > 0,
        )
        const lead: ToolAccess = { role: 'lead', projectId, threadId: task.threadId, sessionId: 'none', taskId: task.id }
        // Only reading, it gets the tools a review gets; asked to run with nothing said, its lead is told to ask.
        assert.notInclude(yield* listTools(lead), 'run_project')
        assert.include(yield* callTool(lead, 'run_it', {}), 'Ask them: Run safely')
        assert.isNull((yield* reviewTask(projectId)).workspace.trust)

        // Run safely: its lockfile installs with scripts off, the base branch's registry in place of the one it wrote.
        const ran = yield* (yield* Reviews).runIt({ taskId: task.id, how: 'safe' })
        assert.strictEqual(ran.kind, 'ran')
        if (ran.kind === 'ran') assert.include(ran.said, 'installed with `npm ci --ignore-scripts --no-audit --no-fund`')
        assert.strictEqual(readFileSync(join(workspace.path, '.npmrc'), 'utf8'), 'registry=https://registry.npmjs.org/\n')
        assert.isTrue(existsSync(join(workspace.path, 'node_modules')) || ran.kind === 'ran')
        assert.strictEqual((yield* reviewTask(projectId)).workspace.trust, 'safe')
        assert.strictEqual((yield* reviewBriefOf(task.id))?.trust, 'safe')
        assert.isTrue((yield* notices(task.threadId)).some((title) => title.startsWith('Runs PR #1 safely')))
        // Its lead starts afresh to run it: no longer a reader, still untrusted and offline.
        yield* until(
          Effect.sync(() => sessionMetas.at(-1)),
          (meta) => meta?.role === 'lead',
        )
        assert.deepInclude(sessionMetas.at(-1)?.options ?? {}, { untrusted: true, offline: true })
        assert.include(yield* listTools(lead), 'run_project')

        // Stop running it: the copy is read only again, and its lead a reader once more, told so.
        const instance = yield* Instance
        const stopped = yield* (yield* Reviews).stopRunning({ taskId: task.id, actorId: instance.personId })
        assert.strictEqual(stopped, 'Stopped running PR #1: its copy is read only again, and its lead reads it only.')
        assert.isNull((yield* reviewTask(projectId)).workspace.trust)
        assert.isUndefined((yield* reviewBriefOf(task.id))?.trust)
        assert.notInclude(yield* listTools(lead), 'run_project')
        assert.isTrue((yield* notices(task.threadId)).includes(stopped))
        // Asked again, nothing runs to stop.
        assert.strictEqual(
          yield* (yield* Reviews).stopRunning({ taskId: task.id, actorId: instance.personId }),
          'PR #1 doesn’t run: its lead reads it only.',
        )
      }).pipe(Effect.provide(withQueries(github)))
    },
  )

  it.live('runs the team’s own at once, trusted as their code, and keeps how outside code is answered', () => {
    const at = hosted()
    const github = makeFakeService({ pushUrl: () => at.bare })
    github.addRepository(['meridian', 'api'])
    const { pull } = pullRequest(at, github, false)
    return Effect.gen(function* () {
      const { projectId, coordinator } = yield* project(at.working)
      yield* callTool(coordinator, 'review_pull_request', { pull_request: `#${pull.number}`, lead: { agent: 'claude-code' } })
      const { task } = yield* reviewTask(projectId)
      const ran = yield* (yield* Reviews).runIt({ taskId: task.id })
      assert.deepInclude(ran, { kind: 'ran', trust: 'full' })
      assert.strictEqual((yield* reviewTask(projectId)).workspace.trust, 'full')
      yield* until(
        Effect.sync(() => sessionMetas.at(-1)),
        (meta) => meta?.role === 'lead' && meta.options?.untrusted !== true,
      )
      // The setting answers the question for outside code, and only that.
      assert.strictEqual(yield* runOutside, 'ask')
      yield* setRunOutside('safe')
      assert.strictEqual(yield* runOutside, 'safe')
      yield* setRunOutside('ask')
      assert.strictEqual(yield* runOutside, 'ask')
    }).pipe(Effect.provide(withQueries(github)))
  })
})
