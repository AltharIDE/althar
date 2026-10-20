import { execFileSync } from 'node:child_process'
import { chmodSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Reviews } from '../src/Reviews'
import * as Runtime from '../src/Runtime'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, notices, repository, runtime, turns, until } from './support'

/*
 * A lead's and the coordinator's tools where a task can't do what was
 * asked: a review's lead settling it before its draft is posted; a planned
 * change's lead making it a change; a review started whose lead couldn't;
 * and a quick task that can't be done while something on it waits on the
 * person.
 */

const withQueries = (connectors: Parameters<typeof fakeConnectors>[0]) =>
  Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors(connectors) })))

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Nine', '-c', 'user.email=nine@althar.test', ...args], { cwd })
    .toString()
    .trim()

/** Someone else's pull request, #1: a commit on main, on the host only as the pull request's head. */
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

/** GitHub with someone's pull request #1, connected, and the repository opened as a project: its id and the coordinator's tools. */
const opened = (at: { readonly working: string; readonly bare: string }) =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: at.working })
    const projectId = project.projectId as ProjectId
    const coordinator: ToolAccess = {
      role: 'coordinator',
      projectId,
      threadId: yield* (yield* Coordinator).thread(projectId),
      sessionId: 'coordinator-session',
      taskId: null,
    }
    return { projectId, coordinator }
  })

const githubWithPull = (at: { readonly working: string; readonly bare: string }) => {
  const github = makeFakeService({ pushUrl: () => at.bare })
  github.addRepository(['meridian', 'api'])
  pullRequest(at, github)
  return github
}

describe('a review’s lead', () => {
  it.live('can’t settle it as done before its draft is posted', () => {
    const at = hosted()
    const github = githubWithPull(at)
    return Effect.gen(function* () {
      const { projectId } = yield* opened(at)
      const started = yield* (yield* Reviews).start({
        envelope: yield* Runtime.envelope('review.start', {}),
        projectId,
        pullRequest: '#1',
        lead: { agentId: 'claude-code', model: null },
      })
      const lead: ToolAccess = { role: 'lead', projectId, threadId: started.threadId, sessionId: 'none', taskId: started.taskId }
      assert.strictEqual(
        yield* callTool(lead, 'settle_task', { how: 'done' }),
        'A review settles once its draft is posted: the person posts it, or discards it, on its draft. If they asked to set it aside, keep it for later instead.',
      )
      const sql = yield* SqlClient.SqlClient
      assert.deepStrictEqual(yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${started.taskId}`, [{ state: 'open' }])
    }).pipe(Effect.provide(withQueries({ github })))
  })
})

describe('a planned change’s lead', () => {
  it.live('can’t make it a change: its plan says already who reviews it and how it ends', () =>
    Effect.gen(function* () {
      const plans = yield* Plans
      const instance = yield* Instance
      const projects = yield* Projects
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const change = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Retry the checkout',
        draft: true,
      })
      yield* plans.propose({
        projectId: project.projectId as ProjectId,
        taskId: change.taskId,
        steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
        reason: null,
        actorId: instance.personId,
        end: null,
        startsIn: Duration.hours(1),
      })
      const lead: ToolAccess = {
        role: 'lead',
        projectId: project.projectId,
        threadId: change.threadId,
        sessionId: 'none',
        taskId: change.taskId,
      }
      assert.strictEqual(
        yield* callTool(lead, 'make_it_a_change', { title: 'Retry it', review: null, output: 'draft' }),
        'This task was planned as a change from its start: its plan already says who reviews it and how it ends. Carry on, and call finish_step when it’s done.',
      )
      const sql = yield* SqlClient.SqlClient
      assert.deepStrictEqual(yield* sql<{ title: string }>`SELECT title FROM tasks WHERE id = ${change.taskId}`, [
        { title: 'Retry the checkout' },
      ])
    }).pipe(Effect.provide(runtime())),
  )
})

describe('the coordinator’s review_pull_request', () => {
  it.live('says the review started but its lead couldn’t, where Althar couldn’t make the copy it reads', () => {
    const at = hosted()
    const github = githubWithPull(at)
    return Effect.gen(function* () {
      const { projectId, coordinator } = yield* opened(at)
      // The project's folder of worktrees, where the copy would go, as one that can't be written.
      const other = yield* (yield* Projects).createTask({ envelope: yield* Runtime.envelope('task.create', {}), projectId, title: 'Other' })
      const sql = yield* SqlClient.SqlClient
      const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${other.taskId}`
      const folder = dirname(dirname(workspace?.path ?? ''))
      chmodSync(folder, 0o555)
      const said = yield* callTool(coordinator, 'review_pull_request', { pull_request: '#1', lead: { agent: 'claude-code' } }).pipe(
        Effect.ensuring(Effect.sync(() => chmodSync(folder, 0o755))),
      )
      assert.match(
        said,
        /^Started review-1-send-back to review ninemate's pull request #1, "Send back", but its lead couldn't start: its thread says why, and the person starts another there\. Tell them\.$/,
      )
      const [task] = yield* sql<{ threadId: string }>`
        SELECT t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task' WHERE k.slug = 'review-1-send-back'`
      assert.include(
        (yield* notices(task?.threadId ?? '')).map((notice) => notice.title),
        'Althar couldn’t make a copy of the pull request #1’s code to read.',
      )
    }).pipe(Effect.provide(withQueries({ github })))
  })
})

describe('a quick task', () => {
  it.live('isn’t marked done while an issue its lead drafted waits on the person', () => {
    const linear = makeFakeService({ product: 'linear' })
    linear.addContainer({ id: 'team-1', key: 'MER', name: 'Meridian' })
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      yield* connections.connectToken({ product: 'linear', token: 't', actorId: instance.personId })
      const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const threadId = yield* (yield* Coordinator).thread(project.projectId)
      const coordinator: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, sessionId: 'none', taskId: null }
      assert.match(
        yield* callTool(coordinator, 'start_task', {
          title: 'Which partners still call v1',
          description: '[lead:finish]',
          lead: { agent: 'codex' },
        }),
        /^Started /,
      )
      const [task] = yield* sql<{ taskId: string; threadId: string }>`
        SELECT k.id AS task_id, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
        WHERE k.project_id = ${project.projectId}`
      yield* until(
        turns(task?.threadId ?? ''),
        (rows) => rows.length >= 1 && rows.every((row) => !['pending', 'delivered'].includes(row.state)),
      )
      const lead: ToolAccess = {
        role: 'lead',
        projectId: project.projectId,
        threadId: task?.threadId ?? '',
        sessionId: 'none',
        taskId: task?.taskId ?? '',
      }
      assert.match(yield* callTool(lead, 'draft_issue', { title: 'Partners left on v1' }), /^Drafted the issue “Partners left on v1”/)
      assert.strictEqual(
        yield* callTool(lead, 'settle_task', { how: 'done' }),
        'Althar couldn’t mark it done: something on it waits on the person first. Tell them.',
      )
      assert.deepStrictEqual(yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${task?.taskId ?? ''}`, [{ state: 'open' }])
    }).pipe(Effect.provide(withQueries({ linear })))
  })
})
