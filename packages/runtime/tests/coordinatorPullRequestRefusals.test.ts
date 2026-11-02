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
import * as Runtime from '../src/Runtime'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, runtime } from './support'

/* The coordinator's pull request tools (ADR-081) where they refuse, or say there is nothing to do. */

const seeded = (service: FakeService) => {
  const { working } = hosted(['meridian', 'api'])
  service.addRepository(['meridian', 'api'])
  return working
}

const withQueries = (github: FakeService) =>
  Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }) })))

/** A project of the repository, GitHub (or whichever the fake is) connected, and the coordinator's tools. */
const project = (path: string) =>
  Effect.gen(function* () {
    const instance = yield* Instance
    yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const projects = yield* Projects
    const opened = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', { title: 'Retry checkout' }),
      projectId: opened.projectId,
      title: 'Retry checkout',
    })
    const coordinator: ToolAccess = {
      role: 'coordinator',
      projectId: opened.projectId,
      threadId: yield* (yield* Coordinator).thread(opened.projectId),
      sessionId: 'coordinator-session',
      taskId: null,
    }
    return { projectId: opened.projectId as ProjectId, taskId: task.taskId, coordinator }
  })

/** A pull request Althar opened for the task: its link is the task's. */
const openedFor = (projectId: string, taskId: string, url: string, number: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const at = new Date().toISOString()
    yield* sql`INSERT INTO external_links ${sql.insert({
      id: `xlink_${String(number).repeat(32).slice(0, 32)}`,
      projectId,
      taskId,
      connectionId: null,
      product: 'github',
      kind: 'change',
      externalId: String(number),
      ref: String(number),
      key: String(number),
      url,
      snapshot: JSON.stringify({
        number,
        title: 'Retry checkout',
        url,
        state: 'open',
        draft: false,
        words: { noun: 'pull request', short: 'PR', prefix: '#' },
        repository: ['meridian', 'api'],
      }),
      createdAt: at,
      updatedAt: at,
    })}`
  })

const said = (coordinator: ToolAccess, tool: string, input: Record<string, unknown>) => callTool(coordinator, tool, input)

describe('the coordinator naming a pull request', () => {
  it.live('refuses what it cannot place, in words for the person', () => {
    const github = makeFakeService()
    const working = seeded(github)
    github.addPullRequest({ path: ['meridian', 'api'], title: 'Their fix', author: 'dana' })
    return Effect.gen(function* () {
      const { coordinator } = yield* project(working)
      assert.include(yield* said(coordinator, 'mark_ready', { pull_request: 'soon' }), 'Give the pull request’s link')
      assert.include(yield* said(coordinator, 'mark_ready', { pull_request: ' ' }), 'Say which pull request')
      assert.include(yield* said(coordinator, 'mark_ready', { pull_request: 'https://elsewhere.test/a/b/pull/1' }), 'isn’t connected')
      assert.include(yield* said(coordinator, 'mark_ready', { pull_request: `${HOST}/meridian/api/issues/3` }), 'isn’t a pull request')
      assert.include(
        yield* said(coordinator, 'mark_ready', { pull_request: `${HOST}/other/repo/pull/1` }),
        'isn’t one of the project’s repositories',
      )
      assert.include(yield* said(coordinator, 'mark_ready', { pull_request: '#99' }), 'not there')
      github.failNext('change', 'forbidden')
      assert.include(yield* said(coordinator, 'mark_ready', { pull_request: '#1' }), 'The code host said')
      assert.include(yield* said(coordinator, 'mark_ready', { pull_request: { no: 'number' } }), 'couldn')
      assert.include(yield* said(coordinator, 'reply_on_pull_request', { pull_request: 1 }), 'couldn')
      assert.include(yield* said(coordinator, 'rerun_check', { pull_request: { no: 1 } }), 'couldn')
      assert.include(yield* said(coordinator, 'read_default_branch_checks', { repository: 4 }), 'couldn')
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('says the host’s refusal, and the scope it lacks', () => {
    const github = makeFakeService()
    const working = seeded(github)
    const mine = github.addPullRequest({ path: ['meridian', 'api'], title: 'Retry checkout', author: 'althar', draft: true })
    return Effect.gen(function* () {
      const { projectId, taskId, coordinator } = yield* project(working)
      yield* openedFor(projectId, taskId, mine.url, mine.number)
      github.failNext('markReady', 'forbidden')
      assert.include(yield* said(coordinator, 'mark_ready', { pull_request: '#1' }), 'The code host')
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('says nothing is to be done to a closed, merged or open one', () => {
    const github = makeFakeService()
    const working = seeded(github)
    const mine = github.addPullRequest({ path: ['meridian', 'api'], title: 'Retry checkout', author: 'althar', draft: true })
    return Effect.gen(function* () {
      const { projectId, taskId, coordinator } = yield* project(working)
      yield* openedFor(projectId, taskId, mine.url, mine.number)
      assert.include(yield* said(coordinator, 'reopen_pull_request', { pull_request: '#1' }), 'open already')
      github.close(1)
      assert.include(yield* said(coordinator, 'mark_ready', { pull_request: '#1' }), "is closed, so it can't be marked ready")
      assert.include(yield* said(coordinator, 'rerun_check', { pull_request: '#1' }), 'is closed, so its checks')
      assert.include(yield* said(coordinator, 'reopen_pull_request', { pull_request: '#1' }), 'is open again. It is a draft.')
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('refuses marking ready where the host has no drafts', () => {
    const github = makeFakeService()
    ;(github.capabilities as { drafts: boolean }).drafts = false
    const working = seeded(github)
    const mine = github.addPullRequest({ path: ['meridian', 'api'], title: 'Retry checkout', author: 'althar', draft: true })
    return Effect.gen(function* () {
      const { projectId, taskId, coordinator } = yield* project(working)
      yield* openedFor(projectId, taskId, mine.url, mine.number)
      assert.include(yield* said(coordinator, 'mark_ready', { pull_request: '#1' }), 'has no drafts')
    }).pipe(Effect.provide(withQueries(github)))
  })
})

describe('the coordinator running checks again where there is nothing to run', () => {
  it.live('says so, and names the repository it was asked for', () => {
    let checks: ReadonlyArray<{ name: string; state: 'queued' | 'running' | 'failed' | 'passed' }> = []
    const github = makeFakeService({ checksFor: () => checks })
    const working = seeded(github)
    github.addPullRequest({ path: ['meridian', 'api'], title: 'Their fix', author: 'dana' })
    github.addPullRequest({ path: ['meridian', 'api'], title: 'Headless', author: 'dana', headSha: '' })
    return Effect.gen(function* () {
      const { coordinator } = yield* project(working)
      checks = [
        { name: 'unit', state: 'queued' },
        { name: 'lint', state: 'running' },
        { name: 'e2e', state: 'passed' },
      ]
      assert.include(yield* said(coordinator, 'rerun_check', { pull_request: '#1', check: 'unit' }), 'waiting to run')
      assert.include(yield* said(coordinator, 'rerun_check', { pull_request: '#1', check: 'lint' }), 'still running')
      assert.include(yield* said(coordinator, 'rerun_check', { pull_request: '#1' }), "None of PR #1's checks failed, and some still run")
      checks = []
      assert.include(yield* said(coordinator, 'rerun_check', { pull_request: '#1', check: 'x' }), 'Its checks: none')
      assert.include(yield* said(coordinator, 'rerun_check', { pull_request: '#1' }), 'nothing to run again')
      assert.include(yield* said(coordinator, 'rerun_check', { repository: 'nowhere' }), 'Name one of those')
      assert.include(yield* said(coordinator, 'read_default_branch_checks', { repository: 'meridian/api' }), 'none have run')
    }).pipe(Effect.provide(withQueries(github)))
  })
})
