import type { CheckState } from '@althar/connectors'
import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { Ids, newId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Instance } from '../src/Instance'
import { CALLED_OFF } from '../src/Errands'
import { MergeLine, sentBack } from '../src/MergeLine'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { timestamp } from '../src/records'
import * as Runtime from '../src/Runtime'
import { fakeConnectors, HOST, hosted, runtime } from './support'

/*
 * Merge when checks pass, pressed on a task's card: the press keeps a merge
 * errand of the line's in the task's thread, which the line takes step by
 * step itself, with no agent's turn, through the host's queue or auto-merge
 * where it has one, and Althar's own line elsewhere. What would step it out
 * of line sends it back, saying why; Don't merge calls it off. The line is
 * swept here by hand.
 */

const host = (options: { readonly autoMerge?: boolean } = {}) => {
  const checks = new Map<string, CheckState>()
  const service = makeFakeService({
    ...options,
    checksFor: (_number, sha) => [{ name: 'test', state: checks.get(sha) ?? 'passed' }],
    checksOn: (sha) => [{ name: 'post-merge', state: checks.get(sha) ?? 'passed' }],
  })
  service.addRepository(['meridian', 'api'])
  const number = service.addPullRequest({ path: ['meridian', 'api'], title: 'Retry refunds', author: 'you' }).number
  return { service, checks, number }
}

const layer = (service: FakeService) =>
  Queries.layer.pipe(
    Layer.provideMerge(
      runtime(
        ':memory:',
        {},
        { connectors: fakeConnectors({ github: service }), signedOut: ['claude-code'], mergeLineEvery: Duration.infinity },
      ),
    ),
  )

/** The project, and a task following the pull request given, with its link through the connection. */
const taskOf = (path: string, number: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path })
    const task = yield* (yield* Projects).createTask({
      envelope: yield* Runtime.envelope('task.create', { title: 'Retry refunds' }),
      projectId: project.projectId,
      title: 'Retry refunds',
    })
    const url = `${HOST}/meridian/api/pull/${number}`
    const linkId = yield* newId(Ids.externalLink)
    const at = yield* timestamp
    const [connection] = yield* sql<{ id: string }>`SELECT id FROM connections WHERE product = 'github' LIMIT 1`
    yield* sql`INSERT INTO external_links ${sql.insert({ id: linkId, projectId: project.projectId, taskId: task.taskId, connectionId: connection?.id ?? null, product: 'github', kind: 'change', externalId: String(number), ref: String(number), key: String(number), url, snapshot: JSON.stringify({ number, title: 'Retry refunds', url, state: 'open', draft: false, headSha: `head-${number}`, additions: null, deletions: null, changedFiles: null, checks: null, target: 'main', words: { noun: 'pull request', short: 'PR', prefix: '#' }, repository: ['meridian', 'api'] }), listening: 1, createdAt: at, updatedAt: at })}`
    return { projectId: project.projectId, taskId: task.taskId, threadId: task.threadId, url, linkId }
  })

type Task = Effect.Success<ReturnType<typeof taskOf>>

const press = (task: Task, head: string, pressId = 'cmd_1') =>
  Effect.flatMap(MergeLine, (line) => line.press({ projectId: task.projectId, taskId: task.taskId, url: task.url, head, pressId }))
const sweep = (task: Task) => Effect.flatMap(MergeLine, (line) => line.tick(task.projectId))

/** The press's errand: its state, and why, where it was called off. */
const errandOf = (task: Task) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ state: string; reason: string | null; messageId: string }>`
      SELECT e.state, e.reason, e.message_id FROM errands e JOIN errand_steps s ON s.errand_id = e.id
      WHERE s.task_id = ${task.taskId} ORDER BY e.created_at DESC, e.rowid DESC LIMIT 1`
    return row
  })

/** Whether anything woke an agent: news in any thread. */
const newsSent = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  return (yield* sql<{ body: string }>`SELECT body FROM user_inputs WHERE input_origin = 'news'`).map((row) => row.body)
})

/** Where its Change card says it stands. */
const shown = (task: Task) =>
  Effect.gen(function* () {
    const read = yield* Effect.orDie((yield* Queries).thread(task.threadId))
    return read.task?.changes.find((one) => one.url === task.url)?.whenGreen
  })

describe('Merge when checks pass', () => {
  it.live('waits while its checks run, then merges by itself, with no agent woken', () => {
    const { service, checks, number } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const task = yield* taskOf(working, number)
      checks.set(`head-${number}`, 'running')
      yield* press(task, `head-${number}`)
      assert.isTrue((yield* errandOf(task))?.messageId.startsWith('press:'))
      assert.deepStrictEqual(yield* shown(task), { state: 'waiting', head: `head-${number}` })

      yield* sweep(task)
      assert.deepStrictEqual(service.merged, [])
      // Pressed again, as a press sent twice: the one errand goes on.
      yield* press(task, `head-${number}`, 'cmd_2')

      checks.set(`head-${number}`, 'passed')
      yield* sweep(task)
      assert.deepStrictEqual(
        service.merged.map((one) => [one.number, one.how, one.head]),
        [[number, 'merge', `head-${number}`]],
      )
      assert.strictEqual((yield* errandOf(task))?.state, 'done')
      assert.deepStrictEqual(yield* newsSent, [])
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('a failed check sends it back, saying why, and a press again puts it back', () => {
    const { service, checks, number } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const task = yield* taskOf(working, number)
      checks.set(`head-${number}`, 'running')
      yield* press(task, `head-${number}`)
      checks.set(`head-${number}`, 'failed')
      yield* sweep(task)
      assert.deepStrictEqual(yield* errandOf(task), { state: 'cancelled', reason: sentBack.failed, messageId: 'press:cmd_1' })
      assert.deepStrictEqual(yield* shown(task), { state: 'sent_back', head: `head-${number}`, reason: sentBack.failed })
      // Green again, nothing merges it: it was sent back.
      checks.set(`head-${number}`, 'passed')
      yield* sweep(task)
      assert.deepStrictEqual(service.merged, [])

      yield* press(task, `head-${number}`, 'cmd_2')
      yield* sweep(task)
      assert.deepStrictEqual(
        service.merged.map((one) => one.number),
        [number],
      )
      assert.deepStrictEqual(yield* newsSent, [])
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('a push after the press sends it back unmerged, and a press at a head that moved is refused', () => {
    const { service, checks, number } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const task = yield* taskOf(working, number)
      checks.set(`head-${number}`, 'running')
      yield* press(task, `head-${number}`)
      const pushed = service.pushTo(number)
      checks.set(pushed, 'passed')
      yield* sweep(task)
      assert.deepStrictEqual(service.merged, [])
      assert.deepStrictEqual(yield* errandOf(task), { state: 'cancelled', reason: sentBack.pushed, messageId: 'press:cmd_1' })

      const stale = yield* Effect.flip(press(task, `head-${number}`, 'cmd_2'))
      assert.match(stale.message, /moved on since you saw it/)
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('Don’t merge calls it off, and nothing merges it once green', () => {
    const { service, checks, number } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const task = yield* taskOf(working, number)
      checks.set(`head-${number}`, 'running')
      yield* press(task, `head-${number}`)
      yield* Effect.flatMap(MergeLine, (line) => line.unpress({ projectId: task.projectId, taskId: task.taskId, url: task.url }))
      assert.deepStrictEqual(yield* errandOf(task), { state: 'cancelled', reason: CALLED_OFF, messageId: 'press:cmd_1' })
      assert.isUndefined(yield* shown(task))
      checks.set(`head-${number}`, 'passed')
      yield* sweep(task)
      assert.deepStrictEqual(service.merged, [])
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('goes through the branch’s merge queue where it has one, and Don’t merge takes it out', () => {
    const { service, checks, number } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      service.mergeQueue()
      const task = yield* taskOf(working, number)
      checks.set(`head-${number}`, 'running')
      yield* press(task, `head-${number}`)
      yield* sweep(task)
      assert.deepStrictEqual(service.merged, [])
      checks.set(`head-${number}`, 'passed')
      yield* sweep(task)
      assert.deepStrictEqual(
        service.merged.map((one) => [one.number, one.how]),
        [[number, 'queue']],
      )
      yield* Effect.flatMap(MergeLine, (line) => line.unpress({ projectId: task.projectId, taskId: task.taskId, url: task.url }))
      assert.strictEqual((yield* errandOf(task))?.state, 'cancelled')
      yield* sweep(task)
      assert.deepStrictEqual(yield* newsSent, [])
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('turns the host’s auto-merge on where it has it, as GitLab’s and Bitbucket Data Center’s', () => {
    const { service, checks, number } = host({ autoMerge: true })
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const task = yield* taskOf(working, number)
      checks.set(`head-${number}`, 'running')
      yield* press(task, `head-${number}`)
      checks.set(`head-${number}`, 'passed')
      yield* sweep(task)
      assert.deepStrictEqual(
        service.merged.map((one) => [one.number, one.how]),
        [[number, 'auto']],
      )
    }).pipe(Effect.provide(layer(service)))
  })
})
