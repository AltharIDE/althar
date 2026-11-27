import type { ChangeTarget } from '@althar/domain'
import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { Ids, newId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { MergeLine } from '../src/MergeLine'
import { Projects } from '../src/Projects'
import { timestamp } from '../src/records'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
import { git } from './changesSupport'
import { callTool, fakeConnectors, HOST, hosted, runtime } from './support'

/*
 * A fork's pull requests where its work goes to the repository it came from
 * (DEV-169): the coordinator finds them there by number as by link, merges
 * them there (through that repository's merge queue), and reads that
 * repository's default branch; a fork whose work stays on it is as it was.
 */

const FORK = ['you', 'api']
const UPSTREAM = ['meridian', 'api']

/** A fork's clone, `origin` the fork and `upstream` the repository it came from, both on the fake host, and its checks green. */
const forkClone = () => {
  const { working } = hosted(FORK)
  git(working, 'remote', 'add', 'upstream', `${HOST}/${UPSTREAM.join('/')}.git`)
  const service = makeFakeService({
    checksFor: () => [{ name: 'test', state: 'passed' }],
    checksOn: () => [{ name: 'post-merge', state: 'passed' }],
  })
  service.addRepository(FORK)
  service.addRepository(UPSTREAM)
  return { working, service }
}

/** The clone as a project, its work going to `target`, with the coordinator's thread and a session of its, without an agent. */
const opened = (path: string, target: ChangeTarget) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const projects = yield* Projects
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
    const [repository] = yield* projects.repositories(project.projectId)
    yield* projects.setRepository({ projectId: project.projectId, repositoryId: repository?.id ?? '', changeTarget: target })
    const threadId = yield* (yield* Coordinator).thread(project.projectId)
    const sessionId = yield* newId(Ids.providerSession)
    yield* sql`INSERT INTO provider_sessions ${sql.insert({ id: sessionId, projectId: project.projectId, threadId, agentId: 'codex', state: 'active', startedAt: yield* timestamp })}`
    const access: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, sessionId, taskId: null }
    return access
  })

/** A turn of the coordinator's: the person's message from the window, or news. Gives its message's id. */
const turn = (access: ToolAccess, origin: 'person' | 'news', body = 'Merge what’s ready') =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`UPDATE turn_deliveries SET state = 'completed', ended_at = ${yield* timestamp} WHERE thread_id = ${access.threadId} AND state = 'delivered'`
    const accepted = yield* (yield* Sessions).send({
      envelope: yield* Runtime.envelope('thread.send', {}),
      threadId: access.threadId,
      body,
      sender: origin === 'person' ? { kind: 'window' } : { kind: 'internal' },
      origin: origin === 'person' ? 'system' : 'news',
    })
    const turnId = yield* newId(Ids.turnDelivery)
    yield* sql`INSERT INTO turn_deliveries ${sql.insert({ id: turnId, projectId: access.projectId, threadId: access.threadId, providerSessionId: access.sessionId, controllerGeneration: 1, state: 'delivered', origin, requestedAt: yield* timestamp, deliveredAt: yield* timestamp })}`
    yield* sql`INSERT INTO turn_delivery_inputs ${sql.insert({ projectId: access.projectId, deliveryId: turnId, userInputId: accepted.inputId, position: 1 })}`
    return accepted.inputId
  })

/** Each merge errand by its pull request's number: its id, state and the repository its step names. */
const errandsOf = (access: ToolAccess) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ id: string; state: string; number: number; repository: string }>`
      SELECT e.id, e.state, json_extract(s.request, '$.number') AS number, json_extract(s.request, '$.repository') AS repository
      FROM errands e JOIN errand_steps s ON s.errand_id = e.id
      WHERE e.project_id = ${access.projectId} AND s.tool = 'merge_pull_request' ORDER BY e.created_at, e.rowid`
    return new Map(rows.map((row) => [row.number, row]))
  })

const layer = (service: FakeService) =>
  runtime(
    ':memory:',
    {},
    { connectors: fakeConnectors({ github: service }), signedOut: ['claude-code'], mergeLineEvery: Duration.infinity },
  )

describe('a fork whose work goes to the repository it came from', () => {
  it.live('merges its pull requests there by number and by link, through its merge queue, and takes the kept errand', () => {
    const { working, service } = forkClone()
    service.mergeQueue()
    const byNumber = service.addPullRequest({ path: UPSTREAM, title: 'Retry refunds', author: 'you' }).number
    const byLink = service.addPullRequest({ path: UPSTREAM, title: 'Cap retries', author: 'you' }).number
    return Effect.gen(function* () {
      const access = yield* opened(working, 'upstream_branch')
      const message = yield* turn(access, 'person')

      assert.match(
        yield* callTool(access, 'merge_pull_request', { pull_request: `#${byNumber}`, head: `head-${byNumber}`, message }),
        new RegExp(`is in main’s merge queue at head-${byNumber}`),
      )
      assert.match(
        yield* callTool(access, 'merge_pull_request', {
          pull_request: `${HOST}/${UPSTREAM.join('/')}/pull/${byLink}`,
          head: `head-${byLink}`,
          message,
        }),
        new RegExp(`merge queue at head-${byLink}`),
      )
      assert.deepStrictEqual(
        service.merged.map((one) => [one.number, one.how]),
        [
          [byNumber, 'queue'],
          [byLink, 'queue'],
        ],
      )
      // Each errand's step names the repository it came from, and the line finds it there once it merges.
      const errands = yield* errandsOf(access)
      assert.strictEqual(errands.get(byNumber)?.repository, `github:${UPSTREAM.join('/')}`)
      service.mergeByHand(byNumber)
      yield* Effect.flatMap(MergeLine, (line) => line.tick(access.projectId))
      yield* turn(access, 'news', 'Althar’s merge line')
      assert.match(
        yield* callTool(access, 'merge_pull_request', { errand: errands.get(byNumber)?.id ?? '', step: 'merge' }),
        /is merged into main/,
      )
      assert.strictEqual((yield* errandsOf(access)).get(byNumber)?.state, 'done')
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('reads a pull request by number, and the default branch’s checks, on the repository it came from', () => {
    const { working, service } = forkClone()
    const number = service.addPullRequest({ path: UPSTREAM, title: 'Retry refunds', author: 'you' }).number
    return Effect.gen(function* () {
      const access = yield* opened(working, 'upstream_branch')
      assert.include(yield* callTool(access, 'read_pull_request', { pull_request: `#${number}` }), 'Retry refunds')
      assert.include(yield* callTool(access, 'read_default_branch_checks', {}), `${UPSTREAM.join('/')}'s main`)
      assert.include(yield* callTool(access, 'mark_ready', { pull_request: `#${number}` }), 'ready for review')
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('a fork whose work stays on it reads and merges on the fork, as before', () => {
    const { working, service } = forkClone()
    const number = service.addPullRequest({ path: FORK, title: 'Retry refunds', author: 'you' }).number
    return Effect.gen(function* () {
      const access = yield* opened(working, 'fork')
      assert.include(yield* callTool(access, 'read_default_branch_checks', {}), `${FORK.join('/')}'s main`)
      const message = yield* turn(access, 'person')
      yield* callTool(access, 'merge_pull_request', { pull_request: `#${number}`, head: `head-${number}`, message })
      assert.strictEqual((yield* errandsOf(access)).get(number)?.repository, `github:${FORK.join('/')}`)
    }).pipe(Effect.provide(layer(service)))
  })
})
