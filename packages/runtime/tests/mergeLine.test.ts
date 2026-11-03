import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CheckState } from '@althar/connectors'
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
import { callTool, fakeConnectors, HOST, hosted, runtime } from './support'

/*
 * The coordinator merging on the person's word (ADR-081, task 5): through
 * the host's own queue, or Althar's line for a branch, one merge at a time,
 * each brought up to date and green first. The line is swept here by hand,
 * and each turn is put in the store as Althar records one, the person's or
 * news's, with no agent: the tools are called over Althar's real MCP server.
 */

/** A fake host whose pull requests' checks, and its branches', a test sets by commit: passed unless said. */
const host = (
  options: {
    readonly product?: 'github' | 'gitlab' | 'bitbucket_cloud' | 'bitbucket_dc'
    readonly conflictsOf?: (number: number) => boolean | undefined
  } = {},
) => {
  const checks = new Map<string, CheckState>()
  const service = makeFakeService({
    ...options,
    checksFor: (_number, sha) => [{ name: 'test', state: checks.get(sha) ?? 'passed' }],
    checksOn: (sha) => [{ name: 'post-merge', state: checks.get(sha) ?? 'passed' }],
  })
  service.addRepository(['meridian', 'api'])
  const pull = (title: string) => service.addPullRequest({ path: ['meridian', 'api'], title, author: 'you' }).number
  return { service, checks, pull }
}

/** The project, its coordinator's thread, and a session of its in the store, without an agent. */
const opened = (path: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path })
    const threadId = yield* (yield* Coordinator).thread(project.projectId)
    const sessionId = yield* newId(Ids.providerSession)
    yield* sql`INSERT INTO provider_sessions ${sql.insert({ id: sessionId, projectId: project.projectId, threadId, agentId: 'codex', state: 'active', startedAt: yield* timestamp })}`
    const access: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, sessionId, taskId: null }
    return access
  })

/** A turn of the coordinator's, as the host records one: the person's message from the window, or news. Gives its message's id. */
const turn = (access: ToolAccess, origin: 'person' | 'news', body = 'Merge them once they’re green') =>
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

/** Each merge errand, oldest first, by its pull request's number. */
const errandsOf = (access: ToolAccess) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ id: string; state: string; number: number }>`
      SELECT e.id, e.state, json_extract(s.request, '$.number') AS number FROM errands e JOIN errand_steps s ON s.errand_id = e.id
      WHERE e.project_id = ${access.projectId} AND s.tool = 'merge_pull_request' ORDER BY e.created_at, e.rowid`
    return new Map(rows.map((row) => [row.number, row]))
  })

/** What Althar's news woke the coordinator with, and the lines in its chat. */
const news = (access: ToolAccess) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return (yield* sql<{ body: string }>`
      SELECT body FROM user_inputs WHERE thread_id = ${access.threadId} AND input_origin = 'news' ORDER BY sequence`).map((row) => row.body)
  })
const lines = (access: ToolAccess) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return (yield* sql<{
      content: string
    }>`SELECT content FROM thread_items WHERE thread_id = ${access.threadId} AND kind = 'notice' ORDER BY rowid`).map((row) =>
      String((JSON.parse(row.content) as { title?: string }).title ?? ''),
    )
  })

const merge = (access: ToolAccess, args: Record<string, unknown>) => callTool(access, 'merge_pull_request', args)
const sweep = (access: ToolAccess) => Effect.flatMap(MergeLine, (line) => line.tick(access.projectId))

/** Takes an errand's step in a turn news started, as the coordinator does once woken. */
const takeStep = (access: ToolAccess, errand: string) =>
  Effect.gen(function* () {
    yield* turn(access, 'news', 'Althar’s merge line')
    return yield* merge(access, { errand, step: 'merge' })
  })

/** The runtime, the coordinator's agent signed out so a wake waits as news, and the line swept only by hand. */
const layer = (service: FakeService, database = ':memory:', keychain?: Map<string, string>) =>
  runtime(
    database,
    {},
    {
      connectors: fakeConnectors({ github: service }),
      signedOut: ['claude-code'],
      mergeLineEvery: Duration.infinity,
      ...(keychain === undefined ? {} : { keychain }),
    },
  )

describe('the coordinator’s merge line', () => {
  it.live('two errands, the first merge held pending: the second waits, then starts again from the new head', () => {
    const { service, pull } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      service.landLater()
      const first = pull('Retry refunds')
      const second = pull('Cap retries')
      const message = yield* turn(access, 'person')
      assert.match(yield* merge(access, { pull_request: `#${first}`, head: `head-${first}`, message }), /lands it later/)
      assert.match(yield* merge(access, { pull_request: `#${second}`, head: `head-${second}`, message }), /2nd in line for main, behind #1/)
      yield* sweep(access)
      // The first holds main's slot until a read shows it landed: the second isn't touched.
      assert.deepStrictEqual(
        service.merged.map((one) => one.number),
        [first],
      )
      assert.deepStrictEqual(service.updated, [])

      service.mergeByHand(first)
      yield* sweep(access)
      const errands = yield* errandsOf(access)
      const a = errands.get(first)?.id ?? ''
      const b = errands.get(second)?.id ?? ''
      assert.include((yield* news(access)).at(-1), `errand "${a}"`)
      assert.match(yield* takeStep(access, a), /is merged into main/)
      assert.strictEqual((yield* errandsOf(access)).get(first)?.state, 'done')

      // Now first in line, the second is brought up to date with main's new head, by a merge, and merged at the head that went green.
      yield* sweep(access)
      assert.deepStrictEqual(service.updated, [second])
      yield* sweep(access)
      assert.include((yield* news(access)).at(-1), `errand "${b}"`)
      assert.match(yield* takeStep(access, b), /lands it later/)
      assert.deepStrictEqual(service.merged.at(-1), {
        number: second,
        how: 'merge',
        method: 'squash',
        head: `head-${second}+merge-${first}`,
      })
      // At the head Althar's update made, not the one the person saw, it is still done once a read shows it merged.
      service.mergeByHand(second)
      yield* sweep(access)
      assert.match(yield* takeStep(access, b), /is merged into main/)
      assert.strictEqual((yield* errandsOf(access)).get(second)?.state, 'done')
      // The line shows in the chat, as it changes.
      assert.isTrue(
        (yield* lines(access)).some((title) => /main of meridian\/api, Althar’s merge line: 1\. #1 .*· 2\. #2 waiting/.test(title)),
      )
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('the person’s “merge it now” goes ahead of the line, waiting only for a merge in flight', () => {
    const { service, checks, pull } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      const slow = pull('Retry refunds')
      checks.set(`head-${slow}`, 'running')
      const urgent = pull('Fix the outage')
      const message = yield* turn(access, 'person', 'Merge #1 once it’s green, and #2 now')
      assert.match(yield* merge(access, { pull_request: `#${slow}`, head: `head-${slow}`, message }), /checks are running/)
      // Nothing is in flight: it merges at once, ahead of the one waiting for its checks.
      assert.match(yield* merge(access, { pull_request: `#${urgent}`, head: `head-${urgent}`, message, now: true }), /Merged PR #2/)

      service.landLater()
      const third = pull('Roll back the flag')
      const fourth = pull('Page on-call')
      const again = yield* turn(access, 'person', 'Merge #3 and #4 now')
      assert.match(yield* merge(access, { pull_request: `#${third}`, head: `head-${third}`, message: again, now: true }), /lands it later/)
      // A merge in flight: the next "now" waits for it, and only for it.
      assert.match(
        yield* merge(access, { pull_request: `#${fourth}`, head: `head-${fourth}`, message: again, now: true }),
        /waits only for the merge in flight \(#3\)/,
      )
      service.mergeByHand(third)
      yield* sweep(access)
      const errands = yield* errandsOf(access)
      yield* takeStep(access, errands.get(third)?.id ?? '')
      yield* sweep(access)
      yield* sweep(access)
      assert.match(yield* takeStep(access, errands.get(fourth)?.id ?? ''), /lands it later/)
      assert.deepStrictEqual(
        service.merged.map((one) => one.number),
        [urgent, third, fourth],
      )
      // The one asked for first still waits for its checks, in the line.
      assert.strictEqual((yield* errandsOf(access)).get(slow)?.state, 'open')
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('a write by someone else in the gap before a merge lands is heard as main going red', () => {
    const { service, checks, pull } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      service.landLater()
      const number = pull('Retry refunds')
      const message = yield* turn(access, 'person')
      assert.match(yield* merge(access, { pull_request: `#${number}`, head: `head-${number}`, message }), /lands it later/)
      // In the gap, between Althar's last read and the merge landing, someone else writes to main.
      service.writeTo('main')
      service.mergeByHand(number)
      const landed = service.branchHeadOf('main')
      checks.set(landed, 'failed')
      yield* sweep(access)
      // The sweep that reads it landed watches main from then on.
      yield* sweep(access)
      // The merge went at the head the person saw, untested with the write beside it: main going red is heard.
      assert.deepStrictEqual(service.merged.at(-1)?.head, `head-${number}`)
      assert.deepStrictEqual(service.updated, [])
      assert.isTrue((yield* lines(access)).some((title) => title.includes(`meridian/api’s main is red at ${landed}: post-merge failed`)))
      assert.include((yield* news(access)).at(-1), 'Main is red')
      // Heard once for a head.
      yield* sweep(access)
      assert.strictEqual((yield* news(access)).filter((body) => body.includes('Main is red')).length, 1)
    }).pipe(Effect.provide(layer(service)))
  })

  it.live(
    'someone else writing to the branch while it holds the slot: brought up to date three times at most, then it waits for the person',
    () => {
      const { service, pull } = host()
      const { working } = hosted(['meridian', 'api'])
      return Effect.gen(function* () {
        const access = yield* opened(working)
        const number = pull('Retry refunds')
        service.writeTo('main')
        const message = yield* turn(access, 'person')
        assert.match(yield* merge(access, { pull_request: `#${number}`, head: `head-${number}`, message }), /behind main at other-1/)
        for (let round = 1; round <= 3; round++) {
          yield* sweep(access)
          assert.strictEqual(service.updated.length, round)
          service.writeTo('main')
        }
        yield* sweep(access)
        assert.strictEqual(service.updated.length, 3)
        assert.strictEqual((yield* errandsOf(access)).get(number)?.state, 'paused')
        assert.isTrue(
          (yield* lines(access)).some((title) =>
            /brought up to date 3 times, and main moved on each time: someone else keeps writing/.test(title),
          ),
        )
        assert.deepStrictEqual(service.merged, [])
      }).pipe(Effect.provide(layer(service)))
    },
  )

  it.live('a push by someone else just after Althar brought it up to date isn’t taken for Althar’s, and ends the errand', () => {
    const { service, pull } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      const number = pull('Retry refunds')
      service.writeTo('main')
      const message = yield* turn(access, 'person')
      yield* merge(access, { pull_request: `#${number}`, head: `head-${number}`, message })
      yield* sweep(access)
      assert.deepStrictEqual(service.updated, [number])
      // Before the next sweep reads it, someone pushes on top of Althar's update.
      const theirs = service.pushTo(number)
      yield* sweep(access)
      const errand = (yield* errandsOf(access)).get(number)?.id ?? ''
      assert.include((yield* news(access)).at(-1), `errand "${errand}"`)
      assert.include(yield* takeStep(access, errand), `Someone else pushed to PR #1 (it is at ${theirs.slice(0, 12)}`)
      assert.strictEqual((yield* errandsOf(access)).get(number)?.state, 'cancelled')
      assert.deepStrictEqual(service.merged, [])
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('a merge the host refuses gives the slot up, its errand waiting for the person, and the next goes ahead', () => {
    const { service, pull } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      const first = pull('Retry refunds')
      const second = pull('Cap retries')
      const message = yield* turn(access, 'person')
      service.failNext('merge', 'rejected', undefined, 405)
      assert.match(
        yield* merge(access, { pull_request: `#${first}`, head: `head-${first}`, message }),
        /GitHub refused to merge PR #1: .*It is out of Althar’s line for main, so the next goes ahead/,
      )
      assert.strictEqual((yield* errandsOf(access)).get(first)?.state, 'paused')
      // Not behind the refused one: it merges at once.
      assert.match(yield* merge(access, { pull_request: `#${second}`, head: `head-${second}`, message }), /Merged PR #2/)
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('one that conflicts steps out of line and is said to its lead; the next goes ahead', () => {
    const clashing = new Set<number>()
    const { service, pull } = host({ conflictsOf: (number) => clashing.has(number) })
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      const first = pull('Retry refunds')
      const second = pull('Cap retries')
      clashing.add(first)
      const message = yield* turn(access, 'person')
      assert.match(yield* merge(access, { pull_request: `#${first}`, head: `head-${first}`, message }), /conflicts with main/)
      yield* sweep(access)
      assert.match((yield* news(access)).at(-1) ?? '', /PR #1 conflicts with main: its task’s lead settles it.*message_lead/)
      assert.match(yield* merge(access, { pull_request: `#${second}`, head: `head-${second}`, message }), /Merged PR #2/)
      assert.strictEqual((yield* errandsOf(access)).get(first)?.state, 'open')
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('a restart keeps the line', () => {
    const { service, checks, pull } = host()
    const { working } = hosted(['meridian', 'api'])
    const database = join(mkdtempSync(join(tmpdir(), 'althar-merge-line-')), 'althar.db')
    const keychain = new Map<string, string>()
    const first = pull('Retry refunds')
    const second = pull('Cap retries')
    checks.set(`head-${first}`, 'running')
    return Effect.gen(function* () {
      const access = yield* Effect.gen(function* () {
        const access = yield* opened(working)
        const message = yield* turn(access, 'person')
        yield* merge(access, { pull_request: `#${first}`, head: `head-${first}`, message })
        assert.match(yield* merge(access, { pull_request: `#${second}`, head: `head-${second}`, message }), /2nd in line/)
        return access
      }).pipe(Effect.provide(layer(service, database, keychain)))
      yield* Effect.gen(function* () {
        const errands = yield* errandsOf(access)
        assert.match(yield* takeStep(access, errands.get(second)?.id ?? ''), /2nd in line for main, behind #1/)
        checks.set(`head-${first}`, 'passed')
        yield* sweep(access)
        assert.include((yield* news(access)).at(-1), `errand "${errands.get(first)?.id ?? ''}"`)
        assert.match(yield* takeStep(access, errands.get(first)?.id ?? ''), /Merged PR #1/)
      }).pipe(Effect.provide(layer(service, database, keychain)))
    })
  })

  it.live('only the person’s word merges: a news turn without an errand, or a head that moved, is refused', () => {
    const { service, pull } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      const number = pull('Retry refunds')
      const heard = yield* turn(access, 'news', 'Checks passed on #1')
      assert.match(
        yield* merge(access, { pull_request: `#${number}`, head: `head-${number}`, message: heard }),
        /person's message in this turn/,
      )
      const message = yield* turn(access, 'person')
      assert.match(yield* merge(access, { pull_request: `#${number}`, message }), /Name the head you read/)
      assert.match(yield* merge(access, { pull_request: `#${number}`, head: 'an-old-head', message }), /moved on to head-1/)
      assert.match(
        yield* merge(access, { pull_request: `#${number}`, head: `head-${number}`, message, method: 'rebase' }),
        /allows squash, merge/,
      )
      assert.deepStrictEqual(service.merged, [])
    }).pipe(Effect.provide(layer(service)))
  })
})

describe('the coordinator merging through the host’s own queue', () => {
  it.live('GitHub’s merge queue takes it at its head; it is done once a read shows it merged; leave_queue takes another out', () => {
    const { service, pull } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      service.mergeQueue()
      const first = pull('Retry refunds')
      const second = pull('Cap retries')
      const message = yield* turn(access, 'person')
      assert.match(
        yield* merge(access, { pull_request: `#${first}`, head: `head-${first}`, message }),
        /is in main’s merge queue at head-1/,
      )
      // No slot of Althar's: the second goes in beside it.
      assert.match(yield* merge(access, { pull_request: `#${second}`, head: `head-${second}`, message }), /merge queue at head-2/)
      assert.deepStrictEqual(
        service.merged.map((one) => [one.number, one.how, one.head]),
        [
          [first, 'queue', 'head-1'],
          [second, 'queue', 'head-2'],
        ],
      )
      assert.match(yield* callTool(access, 'leave_queue', { pull_request: `#${second}` }), /Took PR #2 out of main’s merge queue/)
      service.mergeByHand(first)
      yield* sweep(access)
      const errands = yield* errandsOf(access)
      assert.match(yield* takeStep(access, errands.get(first)?.id ?? ''), /is merged into main/)
      assert.strictEqual((yield* errandsOf(access)).get(first)?.state, 'done')
      assert.strictEqual((yield* errandsOf(access)).get(second)?.state, 'paused')
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('GitLab merges with auto-merge as the line’s merge, and leave_queue turns it off', () => {
    const { service, pull } = host({ product: 'gitlab' })
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      const first = pull('Retry refunds')
      const message = yield* turn(access, 'person')
      assert.match(
        yield* merge(access, { pull_request: `#${first}`, head: `head-${first}`, message }),
        /Auto-merge is on for MR !1 at head-1, by squash: GitLab 18\.5 \(the fake\) merges it into main/,
      )
      assert.deepStrictEqual(service.merged.at(-1)?.how, 'auto')
      assert.match(yield* callTool(access, 'leave_queue', { pull_request: `#${first}` }), /Turned auto-merge off for MR !1/)
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('a queue that sends one back for a conflict hands it to its lead, rather than putting it in again', () => {
    const { service, pull } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      service.mergeQueue()
      const number = pull('Retry refunds')
      const message = yield* turn(access, 'person')
      yield* merge(access, { pull_request: `#${number}`, head: `head-${number}`, message })
      service.dequeue(number, 'conflict')
      yield* sweep(access)
      assert.match((yield* news(access)).at(-1) ?? '', /main’s merge queue sent it back.*message_lead/)
      assert.strictEqual(service.merged.length, 1)
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('Bitbucket Cloud’s merge queue: once green, the person adds it on its site; leave_queue takes it out through the API', () => {
    const { service, pull } = host({ product: 'bitbucket_cloud' })
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      service.mergeQueue()
      const number = pull('Retry refunds')
      const message = yield* turn(access, 'person')
      assert.match(
        yield* merge(access, { pull_request: `#${number}`, head: `head-${number}`, message }),
        /takes it only from Bitbucket’s site: the person adds it with Add to merge queue on https:\/\/\S+\/pull\/1\./,
      )
      yield* sweep(access)
      assert.match((yield* news(access)).at(-1) ?? '', /Add to merge queue/)
      assert.deepStrictEqual(service.merged, [])
      service.enqueueByHand(number)
      assert.match(yield* callTool(access, 'leave_queue', { pull_request: `#${number}` }), /Took PR #1 out of main’s merge queue/)
      assert.strictEqual((yield* errandsOf(access)).get(number)?.state, 'paused')
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('GitLab, behind main: Althar merges main in from here, and where it can’t push, asks for the merge in a line', () => {
    const { service, pull } = host({ product: 'gitlab' })
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      const number = pull('Retry refunds')
      service.writeTo('main')
      const message = yield* turn(access, 'person')
      assert.match(yield* merge(access, { pull_request: `#${number}`, head: `head-${number}`, message }), /behind main at other-1/)
      yield* sweep(access)
      assert.match(
        (yield* news(access)).at(-1) ?? '',
        /MR !1 must have main’s other-1 merged in before it merges, and Althar can’t merge it in: GitLab gives Althar no way to push to it\. .*message_lead/,
      )
      assert.deepStrictEqual(service.merged, [])
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('GitLab’s merge train takes it at its head, where the project has merge trains', () => {
    const { service, pull } = host({ product: 'gitlab' })
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      service.mergeQueue()
      const number = pull('Cap retries')
      const message = yield* turn(access, 'person')
      assert.match(
        yield* merge(access, { pull_request: `#${number}`, head: `head-${number}`, message }),
        /is in main’s merge train at head-1/,
      )
      assert.deepStrictEqual(service.merged.at(-1), { number, how: 'queue', method: null, head: 'head-1' })
      // In the train, it waits there: nothing more to take until a read shows it merged.
      yield* sweep(access)
      assert.deepStrictEqual(yield* news(access), [])
    }).pipe(Effect.provide(layer(service)))
  })
})
