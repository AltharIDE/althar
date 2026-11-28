import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CheckState } from '@althar/connectors'
import type { ThreadItem } from '@althar/contracts'
import { type FakeService, type FakeServiceOptions, makeFakeService } from '@althar/connectors/testing'
import { Ids, newId } from '@althar/domain'
import { Ledger } from '@althar/persistence-sqlite'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { errandRecords } from '../src/Errands'
import { errandCardLines } from '../src/errandWords'
import { MergeLine } from '../src/MergeLine'
import { Queries } from '../src/Queries'
import { Projects } from '../src/Projects'
import { timestamp } from '../src/records'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, promptsGot, runtime, until } from './support'

/*
 * The coordinator merging on the person's word (ADR-081, task 5): through
 * the host's own queue, or Althar's line for a branch, one merge at a time,
 * each brought up to date and green first. The line is swept here by hand,
 * and each turn is put in the store as Althar records one, the person's or
 * news's, with no agent: the tools are called over Althar's real MCP server.
 */

/** A fake host whose pull requests' checks, and its branches', a test sets by commit: passed unless said. */
const host = (
  options: Pick<FakeServiceOptions, 'conflictsOf'> & {
    readonly product?: 'github' | 'gitlab' | 'bitbucket_cloud' | 'bitbucket_dc'
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

/** What a task's card says of a merge errand, as its records and the line's last read of it stand. */
const cardSays = (access: ToolAccess, errandId: string) =>
  Effect.map(errandRecords(access.projectId, { errandId }), (records) => errandCardLines(records, null))

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

/** The merge line's cards in the coordinator's thread, as the store keeps them: the item's id, and what it says of each pull request. */
const cards = (access: ToolAccess) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return (yield* sql<{
      id: string
      content: string
    }>`SELECT id, content FROM thread_items WHERE thread_id = ${access.threadId} AND kind = 'merge_line' ORDER BY sequence`).map((row) => ({
      id: row.id,
      ...(JSON.parse(row.content) as {
        branch: string | null
        rows: ReadonlyArray<{ number: number; title: string; url: string; state: string; reason?: string }>
      }),
    }))
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
  it.live('refuses a draft or a closed one, holds one whose checks failed, and merges one into its own branch', () => {
    const { service, checks } = host()
    const { working } = hosted(['meridian', 'api'])
    const add = (title: string, more: { draft?: boolean; target?: string; state?: 'closed' } = {}) =>
      service.addPullRequest({ path: ['meridian', 'api'], title, author: 'you', ...more }).number
    return Effect.gen(function* () {
      const access = yield* opened(working)
      const draft = add('Sketch', { draft: true })
      const other = add('Into release', { target: 'release' })
      const closed = add('Gave up', { state: 'closed' })
      const red = add('Breaks the build')
      checks.set(`head-${red}`, 'failed')
      const message = yield* turn(access, 'person', 'Merge them all')
      const said = (number: number) => merge(access, { pull_request: `#${number}`, head: `head-${number}`, message })
      assert.match(yield* said(draft), /draft/i)
      assert.match(yield* said(closed), /closed/i)
      assert.match(yield* said(red), /checks failed/)
      const into = yield* said(other)
      assert.match(into, /^Merged PR #2 at head-2 into release/)
      yield* sweep(access)
    }).pipe(Effect.provide(layer(service)))
  })

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
      // Its card says where each stands as the line read it: the first merging, the second behind it.
      const waiting = yield* errandsOf(access)
      assert.deepStrictEqual(yield* cardSays(access, waiting.get(first)?.id ?? ''), ['Merging #1'])
      assert.deepStrictEqual(yield* cardSays(access, waiting.get(second)?.id ?? ''), ['Waiting its turn to merge #2'])

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
      // First in line now, its card no longer says it waits behind another.
      assert.notDeepEqual(yield* cardSays(access, b), ['Waiting its turn to merge #2'])
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
      // The line shows as one card that moved in place, never as chat lines.
      const shown = yield* cards(access)
      assert.strictEqual(shown.length, 1)
      assert.deepStrictEqual(
        shown[0]?.rows.map((row) => [row.number, row.state]),
        [
          [first, 'merged'],
          [second, 'merged'],
        ],
      )
      assert.deepStrictEqual(
        (yield* lines(access)).filter((title) => /merge line|^main of/.test(title)),
        [],
      )
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('the line is one card that moves in place, with no line of chat for it', () => {
    const { service, checks, pull } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      service.landLater()
      const first = pull('Retry refunds')
      const second = pull('Cap retries')
      const third = pull('Page on-call')
      checks.set(`head-${third}`, 'running')
      const message = yield* turn(access, 'person')
      for (const number of [first, second, third]) yield* merge(access, { pull_request: `#${number}`, head: `head-${number}`, message })
      yield* sweep(access)
      const [card] = yield* cards(access)
      assert.strictEqual((yield* cards(access)).length, 1)
      // Each pull request in order, by number and title, linked, with where it stands; the branch is the default, so it isn't named.
      assert.deepStrictEqual(
        card?.rows.map((row) => [row.number, row.title, row.state]),
        [
          [first, 'Retry refunds', 'merging'],
          [second, 'Cap retries', 'waiting'],
          [third, 'Page on-call', 'waiting'],
        ],
      )
      assert.isTrue(card?.rows.every((row) => row.url.startsWith('http')))
      assert.strictEqual(card?.branch, null)

      // The first lands: the same card says so, and the next goes.
      service.mergeByHand(first)
      yield* sweep(access)
      yield* sweep(access)
      const after = yield* cards(access)
      assert.strictEqual(after.length, 1)
      assert.strictEqual(after[0]?.id, card?.id)
      assert.strictEqual(after[0]?.rows[0]?.state, 'merged')

      // A sweep that finds nothing new writes nothing.
      const before = JSON.stringify(yield* cards(access))
      yield* sweep(access)
      assert.strictEqual(JSON.stringify(yield* cards(access)), before)

      // No status line went into the thread, and the coordinator's news is as it was: for the agent, not the chat.
      const chat = yield* lines(access)
      assert.deepStrictEqual(
        chat.filter((title) => /merge line|waiting|checks running|merge queue/i.test(title)),
        [],
      )
      assert.deepStrictEqual(
        (yield* news(access)).filter((body) => !body.includes('merge line (news, not the person')),
        [],
      )
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('a merge errand’s lines say what it still has to merge, quietly, for the thread to fold into its merging line', () => {
    const { service, checks, pull } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const access = yield* opened(working)
      service.landLater()
      const first = pull('Retry refunds')
      const second = pull('Cap retries')
      checks.set(`head-${second}`, 'running')
      const message = yield* turn(access, 'person')
      for (const number of [first, second]) yield* merge(access, { pull_request: `#${number}`, head: `head-${number}`, message })
      yield* sweep(access)
      service.mergeByHand(first)
      yield* sweep(access)
      yield* sweep(access)
      const tagged = (yield* sql<{ content: string }>`
        SELECT content FROM thread_items WHERE thread_id = ${access.threadId} AND kind = 'notice' ORDER BY rowid`)
        .map(
          (row) =>
            JSON.parse(row.content) as { title: string; errand?: { id: string; quiet: boolean; merges: ReadonlyArray<{ label: string }> } },
        )
        .filter((note) => note.errand !== undefined)
      // Each kept merge says it moved on, quietly, naming what it waits to merge by its number.
      const kept = tagged.filter((note) => note.title.startsWith('Kept your errand'))
      assert.deepStrictEqual(
        kept.map((note) => [note.errand?.quiet, note.errand?.merges.map((merge) => merge.label)]),
        [
          [true, [`#${first}`]],
          [true, [`#${second}`]],
        ],
      )
      // The host taking the first to land later is the errand moving on too: quiet, the card shows it.
      const taken = tagged.find((note) => note.title.includes('lands it later'))
      assert.strictEqual(taken?.errand?.id, kept[0]?.errand?.id)
      assert.isTrue(tagged.every((note) => note.errand?.quiet === true))
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('calling off the last one on the card, before anything landed, takes it off the card', () => {
    const { service, checks, pull } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const access = yield* opened(working)
      const number = pull('Retry refunds')
      checks.set(`head-${number}`, 'running')
      const message = yield* turn(access, 'person')
      yield* merge(access, { pull_request: `#${number}`, head: `head-${number}`, message })
      yield* sweep(access)
      assert.deepStrictEqual(
        (yield* cards(access))[0]?.rows.map((row) => [row.number, row.state]),
        [[number, 'checks']],
      )
      const [errand] = yield* sql<{ id: string }>`SELECT id FROM errands WHERE thread_id = ${access.threadId}`
      const fresh = yield* turn(access, 'person')
      assert.match(yield* callTool(access, 'cancel_errand', { errand: errand!.id, message: fresh }), /^Called off the errand/)
      yield* sweep(access)
      // The same card, with nothing on its way: the thread's merging line has nothing of it to show.
      const after = yield* cards(access)
      assert.strictEqual(after.length, 1)
      assert.deepStrictEqual(after[0]?.rows, [])
      // And it stays so.
      yield* sweep(access)
      assert.deepStrictEqual((yield* cards(access))[0]?.rows, [])
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('a pull request whose checks failed is sent back on the card, with what to do', () => {
    const { service, checks, pull } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      const first = pull('Retry refunds')
      checks.set(`head-${first}`, 'running')
      const message = yield* turn(access, 'person')
      yield* merge(access, { pull_request: `#${first}`, head: `head-${first}`, message })
      yield* sweep(access)
      assert.strictEqual((yield* cards(access))[0]?.rows[0]?.state, 'checks')
      checks.set(`head-${first}`, 'failed')
      yield* sweep(access)
      const [card] = yield* cards(access)
      assert.strictEqual(card?.rows[0]?.state, 'sent_back')
      assert.match(card?.rows[0]?.reason ?? '', /Checks failed/)
      // The reason doesn't say its number again.
      assert.notMatch(card?.rows[0]?.reason ?? '', /#\d/)
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('a branch that isn’t the default is named on its card', () => {
    const { service, checks } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      const number = service.addPullRequest({
        path: ['meridian', 'api'],
        title: 'Backport the retry fix',
        author: 'you',
        target: 'release',
      }).number
      checks.set(`head-${number}`, 'running')
      const message = yield* turn(access, 'person')
      yield* merge(access, { pull_request: `#${number}`, head: `head-${number}`, message })
      yield* sweep(access)
      const [card] = yield* cards(access)
      assert.strictEqual(card?.branch, 'release')
      assert.deepStrictEqual(
        card?.rows.map((row) => [row.number, row.state]),
        [[number, 'checks']],
      )
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('a later ask, once every pull request on the card has merged, is a card of its own', () => {
    const { service, checks, pull } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      const first = pull('Retry refunds')
      checks.set(`head-${first}`, 'running')
      const message = yield* turn(access, 'person')
      yield* merge(access, { pull_request: `#${first}`, head: `head-${first}`, message })
      yield* sweep(access)
      service.mergeByHand(first)
      yield* sweep(access)
      yield* takeStep(access, (yield* errandsOf(access)).get(first)?.id ?? '')
      yield* sweep(access)
      assert.deepStrictEqual(
        (yield* cards(access)).map((card) => card.rows.map((row) => [row.number, row.state])),
        [[[first, 'merged']]],
      )
      const second = pull('Cap retries')
      checks.set(`head-${second}`, 'running')
      const again = yield* turn(access, 'person', 'Merge #2 too')
      yield* merge(access, { pull_request: `#${second}`, head: `head-${second}`, message: again })
      yield* sweep(access)
      assert.deepStrictEqual(
        (yield* cards(access)).map((card) => card.rows.map((row) => [row.number, row.state])),
        [[[first, 'merged']], [[second, 'checks']]],
      )
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('a pull request that merges the moment it is asked for still gets its row, as merged', () => {
    const { service, pull } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      const first = pull('Retry refunds')
      const message = yield* turn(access, 'person')
      assert.match(yield* merge(access, { pull_request: `#${first}`, head: `head-${first}`, message }), /Merged PR #1/)
      const [card] = yield* cards(access)
      assert.deepStrictEqual(
        card?.rows.map((row) => [row.number, row.title, row.state]),
        [[first, 'Retry refunds', 'merged']],
      )
      assert.isTrue(card?.rows[0]?.url.startsWith('http'))
      // Sweeping after it changes nothing: still the one card.
      yield* sweep(access)
      assert.deepStrictEqual(
        (yield* cards(access)).map((one) => one.rows.map((row) => row.state)),
        [['merged']],
      )
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('a pull request shown waiting that merges when its step is taken, as the last in the line, is shown merged', () => {
    const { service, checks, pull } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      const first = pull('Retry refunds')
      checks.set(`head-${first}`, 'running')
      const message = yield* turn(access, 'person')
      yield* merge(access, { pull_request: `#${first}`, head: `head-${first}`, message })
      yield* sweep(access)
      assert.strictEqual((yield* cards(access))[0]?.rows[0]?.state, 'checks')
      // Green: the coordinator is woken, and takes the step, which merges at once. Nothing waits in the line any more.
      checks.set(`head-${first}`, 'passed')
      yield* sweep(access)
      assert.match(yield* takeStep(access, (yield* errandsOf(access)).get(first)?.id ?? ''), /Merged PR #1/)
      const cardsNow = yield* cards(access)
      assert.strictEqual(cardsNow.length, 1)
      assert.deepStrictEqual(
        cardsNow[0]?.rows.map((row) => [row.number, row.state]),
        [[first, 'merged']],
      )
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('a pull request asked for “now” after the card shows moves ahead of the ones waiting, as it will merge', () => {
    const { service, checks, pull } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      const slow = pull('Retry refunds')
      const slower = pull('Cap retries')
      checks.set(`head-${slow}`, 'running')
      checks.set(`head-${slower}`, 'running')
      const message = yield* turn(access, 'person')
      yield* merge(access, { pull_request: `#${slow}`, head: `head-${slow}`, message })
      yield* merge(access, { pull_request: `#${slower}`, head: `head-${slower}`, message })
      yield* sweep(access)
      assert.deepStrictEqual(
        (yield* cards(access))[0]?.rows.map((row) => row.number),
        [slow, slower],
      )
      const urgent = pull('Fix the outage')
      checks.set(`head-${urgent}`, 'running')
      const again = yield* turn(access, 'person', 'Merge #3 now')
      yield* merge(access, { pull_request: `#${urgent}`, head: `head-${urgent}`, message: again, now: true })
      yield* sweep(access)
      const shown = yield* cards(access)
      assert.strictEqual(shown.length, 1)
      assert.deepStrictEqual(
        shown[0]?.rows.map((row) => row.number),
        [urgent, slow, slower],
      )
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('the thread the desktop reads gets the card as it arrives, moves, and folds, and nothing else of the line', () => {
    const { service, checks, pull } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      const queries = yield* Queries
      const read = () => queries.coordinator(access.projectId).pipe(Effect.map((thread) => thread.items))
      const first = pull('Retry refunds')
      const second = pull('Cap retries')
      checks.set(`head-${first}`, 'running')
      checks.set(`head-${second}`, 'running')
      const message = yield* turn(access, 'person')
      yield* merge(access, { pull_request: `#${first}`, head: `head-${first}`, message })
      yield* merge(access, { pull_request: `#${second}`, head: `head-${second}`, message })
      yield* sweep(access)
      const states = (items: ReadonlyArray<ThreadItem>) =>
        items.flatMap((item) =>
          item.kind === 'merge_line' ? [{ id: item.id, rows: item.content.rows.map((row) => [row.number, row.state]) }] : [],
        )
      const arrived = states(yield* read())
      assert.deepStrictEqual(
        arrived.map((card) => card.rows),
        [
          [
            [first, 'checks'],
            [second, 'waiting'],
          ],
        ],
      )

      // Both go green and land one after the other, as the coordinator takes each step.
      checks.set(`head-${first}`, 'passed')
      checks.set(`head-${second}`, 'passed')
      yield* sweep(access)
      yield* takeStep(access, (yield* errandsOf(access)).get(first)?.id ?? '')
      yield* sweep(access)
      yield* takeStep(access, (yield* errandsOf(access)).get(second)?.id ?? '')
      yield* sweep(access)
      const items = yield* read()
      const folded = states(items)
      // The same card, moved in place, with every row merged: what the desktop folds to one line.
      assert.deepStrictEqual(folded, [
        {
          id: arrived[0]?.id,
          rows: [
            [first, 'merged'],
            [second, 'merged'],
          ],
        },
      ])
      // No line of chat about the line.
      assert.deepStrictEqual(
        items.filter(
          (item) =>
            item.kind === 'notice' && /merge line|waiting|checks running|queue/i.test(String((item.content as { title?: string }).title)),
        ),
        [],
      )
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(layer(service)))))
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
      assert.isTrue((yield* lines(access)).some((title) => title.includes(`main is red at ${landed}: post-merge failed`)))
      assert.include((yield* news(access)).at(-1), 'Main is red')
      // Heard once for a head.
      yield* sweep(access)
      assert.strictEqual((yield* news(access)).filter((body) => body.includes('Main is red')).length, 1)
    }).pipe(Effect.provide(layer(service)))
  })

  for (const state of ['failed', 'cancelled'] as const) {
    it.live(`reports main's ${state} checks without attributing their cause to its latest merge`, () => {
      const { service, checks, pull } = host()
      const { working } = hosted(['meridian', 'api'])
      return Effect.gen(function* () {
        const access = yield* opened(working)
        checks.set(service.branchHeadOf('main'), state)
        const number = pull('Retry refunds')
        const message = yield* turn(access, 'person')
        yield* merge(access, { pull_request: `#${number}`, head: `head-${number}`, message })
        checks.set(service.branchHeadOf('main'), state)
        yield* sweep(access)
        yield* sweep(access)
        const alerts = (yield* news(access)).filter((body) => body.includes('Main is red'))
        assert.lengthOf(alerts, state === 'failed' ? 1 : 0)
        assert.isFalse(alerts.some((body) => body.includes('landed untested together') || body.includes('after #1 merged')))
        if (state === 'failed') assert.include(alerts[0], 'investigate the cause')
      }).pipe(Effect.provide(layer(service)))
    })
  }

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

  it.live('a task’s card hears its merge move on, and says it no longer waits behind another', () => {
    const { service, pull } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const access = yield* opened(working)
      const task = yield* (yield* Projects).createTask({
        envelope: yield* Runtime.envelope('task.create', { title: 'Cap retries' }),
        projectId: access.projectId,
        title: 'Cap retries',
      })
      service.landLater()
      const first = pull('Retry refunds')
      const second = pull('Cap retries')
      const at = new Date().toISOString()
      const url = `https://github.com/meridian/api/pull/${second}`
      yield* sql`INSERT INTO external_links ${sql.insert({ id: 'xlink_c4d0000000000000000000000000000a', projectId: access.projectId, taskId: task.taskId, connectionId: null, product: 'github', kind: 'change', externalId: String(second), ref: String(second), key: String(second), url, snapshot: JSON.stringify({ number: second, title: 'Cap retries', url, state: 'open', draft: false, words: { noun: 'pull request', short: 'PR', prefix: '#' }, repository: ['meridian', 'api'] }), createdAt: at, updatedAt: at })}`
      const message = yield* turn(access, 'person')
      yield* merge(access, { pull_request: `#${first}`, head: `head-${first}`, message })
      yield* merge(access, { pull_request: `#${second}`, head: `head-${second}`, message })
      const queries = yield* Queries
      const ledger = yield* Ledger
      const card = Effect.map(Effect.orDie(queries.board(access.projectId)), (board) =>
        board.tasks.find((one) => one.taskId === task.taskId),
      )
      yield* sweep(access)
      assert.include((yield* card)?.errands ?? [], 'Waiting its turn to merge')
      const cursor = (yield* ledger.changesSince(0, 100_000)).at(-1)?.cursor ?? 0

      // The first lands and is done: the second is first in line, its card told to read again, and it no longer says it waits.
      service.mergeByHand(first)
      yield* sweep(access)
      assert.match(yield* takeStep(access, (yield* errandsOf(access)).get(first)?.id ?? ''), /is merged into main/)
      yield* sweep(access)
      const heard = yield* ledger.changesSince(cursor, 100_000)
      assert.isTrue(heard.some((change) => change.aggregateType === 'task' && change.aggregateId === task.taskId))
      assert.notInclude((yield* card)?.errands ?? [], 'Waiting its turn to merge')
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(layer(service)))))
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

describe('a lead merging its own task’s pull request, on the person’s word in its thread', () => {
  /** The fake host, its pull requests' links on the connected host's address, as a task's link to its own is. */
  const leadsHost = () => {
    const made = host()
    const service: FakeService = {
      ...made.service,
      change: (...args) =>
        Effect.map(made.service.change(...args), (change) => ({ ...change, url: change.url.replace('https://github.com', HOST) })),
    }
    // What it did is read from the fake itself: a copy of it holds what it had then.
    return { ...made, service, did: made.service }
  }

  /** A task following the pull request given, and its lead's last session in the store, ended, on the agent given. */
  const leadOf = (coordinator: ToolAccess, number: number, agentId = 'missing') =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* (yield* Projects).createTask({
        envelope: yield* Runtime.envelope('task.create', { title: 'Retry refunds' }),
        projectId: coordinator.projectId,
        title: 'Retry refunds',
      })
      const [row] = yield* sql<{ slug: string }>`SELECT slug FROM tasks WHERE id = ${task.taskId}`
      const url = `${HOST}/meridian/api/pull/${number}`
      const linkId = yield* newId(Ids.externalLink)
      const at = yield* timestamp
      yield* sql`INSERT INTO external_links ${sql.insert({ id: linkId, projectId: coordinator.projectId, taskId: task.taskId, connectionId: null, product: 'github', kind: 'change', externalId: String(number), ref: String(number), key: String(number), url, snapshot: JSON.stringify({ number, title: 'Retry refunds', url, state: 'open', draft: false, words: { noun: 'pull request', short: 'PR', prefix: '#' }, repository: ['meridian', 'api'] }), listening: 1, createdAt: at, updatedAt: at })}`
      const sessionId = yield* newId(Ids.providerSession)
      yield* sql`INSERT INTO provider_sessions ${sql.insert({ id: sessionId, projectId: coordinator.projectId, threadId: task.threadId, agentId, state: 'completed', startedAt: at, endedAt: at })}`
      const lead: ToolAccess = { role: 'lead', projectId: coordinator.projectId, threadId: task.threadId, sessionId, taskId: task.taskId }
      return { lead, slug: row?.slug ?? '', linkId }
    })

  /** The lead's push of a fix to the pull request, as Althar records its pushes: the new head. */
  const fixPushed = (service: FakeService, coordinator: ToolAccess, number: number, linkId: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const fix = service.pushTo(number)
      yield* sql`INSERT INTO observations ${sql.insert({ id: yield* newId(Ids.observation), projectId: coordinator.projectId, subjectType: 'external_link', subjectId: linkId, kind: 'pushed', payload: JSON.stringify({ id: `pushed:${fix}`, sha: fix }), source: 'althar', observedAt: yield* timestamp })}`
      return fix
    })

  it.live('merges it through a send-back, woken itself for each step, then tags what landed: never the coordinator', () => {
    const { service, checks, pull, did } = leadsHost()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const coordinator = yield* opened(working)
      const number = pull('Retry refunds')
      const { lead, slug, linkId } = yield* leadOf(coordinator, number)
      checks.set(`head-${number}`, 'running')
      const message = yield* turn(lead, 'person', 'See it through to merge, and tag it v1.0.0 after')
      // Named by nothing, the pull request is its own task's.
      assert.match(yield* merge(lead, { head: `head-${number}`, message }), /checks are running/)
      const tagging = yield* callTool(lead, 'keep_errand', {
        message,
        steps: [
          {
            key: 'tag',
            tool: 'push_tag',
            taskId: slug,
            target: 'meridian/api tag v1.0.0',
            request: { tag: 'v1.0.0', commit: `task:${slug}` },
            waits: [{ kind: 'task_merged', target: slug }],
          },
        ],
      })
      assert.match(tagging, /^errand_/)
      yield* sweep(coordinator)
      assert.strictEqual((yield* cards(lead))[0]?.rows[0]?.state, 'checks')

      // Its checks fail: it is sent back, on the card in the lead's own thread, and nothing merges.
      checks.set(`head-${number}`, 'failed')
      yield* sweep(coordinator)
      assert.strictEqual((yield* cards(lead))[0]?.rows[0]?.state, 'sent_back')
      assert.deepStrictEqual(did.merged, [])

      // The lead pushes a fix, green: the line wakes the lead with the step, not the coordinator.
      const fix = yield* fixPushed(service, coordinator, number, linkId)
      yield* sweep(coordinator)
      const errand = (yield* errandsOf(lead)).get(number)?.id ?? ''
      assert.include((yield* news(lead)).at(-1), `merge_pull_request with errand "${errand}" and step "merge"`)
      assert.match(yield* takeStep(lead, errand), /^Merged PR #1 at /)
      assert.deepStrictEqual(
        did.merged.map((one) => [one.number, one.head]),
        [[number, fix]],
      )
      assert.strictEqual((yield* errandsOf(lead)).get(number)?.state, 'done')

      // Merged, its tag's step wakes the lead in turn, which tags the landed commit on that errand's word alone.
      yield* sweep(coordinator)
      const said = (yield* news(lead)).at(-1) ?? ''
      assert.include(said, `Errand ${tagging}, step tag`)
      yield* turn(lead, 'news', said)
      assert.match(
        yield* callTool(lead, 'push_tag', {
          tag: 'v1.0.0',
          commit: `task:${slug}`,
          repository: 'meridian/api',
          errand: tagging,
          step: 'tag',
        }),
        /^Pushed the tag v1\.0\.0 on merge-1 on meridian\/api/,
      )
      assert.deepStrictEqual(
        did.tagsPushed.map((one) => [one.name, one.commit]),
        [['v1.0.0', `merge-${number}`]],
      )
      // The coordinator heard none of it.
      assert.deepStrictEqual(yield* news(coordinator), [])
    }).pipe(Effect.provide(layer(service)))
  })

  it.live(
    'merges or tags only on the person’s word: news alone does nothing; their word merges another of the project’s and tags on the host',
    () => {
      const { service, pull, did } = leadsHost()
      const { working } = hosted(['meridian', 'api'])
      return Effect.gen(function* () {
        const coordinator = yield* opened(working)
        const number = pull('Retry refunds')
        const { lead } = yield* leadOf(coordinator, number)
        const heard = yield* turn(lead, 'news', 'Checks passed on #1: merge it')
        assert.match(yield* merge(lead, { head: `head-${number}`, message: heard }), /person's message in this turn/)
        assert.match(yield* callTool(lead, 'push_tag', { tag: 'v1.0.0', message: heard }), /person's message in this turn/)
        assert.deepStrictEqual(did.merged, [])
        assert.deepStrictEqual(did.tagsPushed, [])
        // Another of the project's, where the person asks for it by its number.
        const other = pull('Cap retries')
        const message = yield* turn(lead, 'person', 'Merge #2 as well')
        assert.match(yield* merge(lead, { pull_request: `#${other}`, head: `head-${other}`, message }), /^Merged PR #2/)
        // Their word for a tag the lead didn't make: Althar makes it on the host, on main's latest.
        assert.match(yield* callTool(lead, 'push_tag', { tag: 'v1.0.0', message }), /^Pushed the tag v1\.0\.0 on /)
        assert.deepStrictEqual(
          did.tagsPushed.map((one) => one.name),
          ['v1.0.0'],
        )
      }).pipe(Effect.provide(layer(service)))
    },
  )

  it.live('a merge its lead kept wakes that lead after a restart, starting it again', () => {
    const { service, checks, pull } = leadsHost()
    const { working } = hosted(['meridian', 'api'])
    const database = join(mkdtempSync(join(tmpdir(), 'althar-lead-merge-')), 'althar.db')
    const keychain = new Map<string, string>()
    const number = pull('Retry refunds')
    checks.set(`head-${number}`, 'running')
    return Effect.gen(function* () {
      const { coordinator, lead } = yield* Effect.gen(function* () {
        const coordinator = yield* opened(working)
        const { lead } = yield* leadOf(coordinator, number, 'lead-agent')
        const message = yield* turn(lead, 'person', 'Merge it once it’s green')
        assert.match(yield* merge(lead, { head: `head-${number}`, message }), /checks are running/)
        return { coordinator, lead }
      }).pipe(Effect.provide(layer(service, database, keychain)))
      yield* Effect.gen(function* () {
        checks.set(`head-${number}`, 'passed')
        yield* sweep(coordinator)
        const errand = (yield* errandsOf(lead)).get(number)?.id ?? ''
        assert.include((yield* news(lead)).at(-1), `errand "${errand}"`)
        assert.deepStrictEqual(yield* news(coordinator), [])
        // Its lead had no session: it is started again on its agent, and reads the step as its turn.
        yield* until(
          Effect.sync(() => promptsGot.filter((one) => one.agentId === 'lead-agent')),
          (got) => got.some((one) => one.text.includes(`errand "${errand}"`)),
        )
      }).pipe(Effect.provide(layer(service, database, keychain)))
    })
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

  it.live('Bitbucket Cloud’s merge queue takes it by its merge, at the head read just before; leave_queue takes it out', () => {
    const { service, pull } = host({ product: 'bitbucket_cloud' })
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      service.mergeQueue()
      const number = pull('Retry refunds')
      const message = yield* turn(access, 'person')
      assert.match(yield* merge(access, { pull_request: `#${number}`, head: `head-${number}`, message }), /merge queue/)
      assert.deepInclude(service.merged.at(-1), { number, how: 'queue', head: `head-${number}` })
      assert.match(yield* callTool(access, 'leave_queue', { pull_request: `#${number}` }), /Took PR #1 out of main’s merge queue/)
      assert.strictEqual((yield* errandsOf(access)).get(number)?.state, 'paused')
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('GitHub’s update-branch read back before it landed: a later read finds the head it made, and the errand goes on', () => {
    const { service, pull } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      service.readBackLater()
      const number = pull('Retry refunds')
      service.writeTo('main')
      const message = yield* turn(access, 'person')
      yield* merge(access, { pull_request: `#${number}`, head: `head-${number}`, message })
      yield* sweep(access)
      assert.deepStrictEqual(service.updated, [number])
      yield* sweep(access)
      const errand = (yield* errandsOf(access)).get(number)?.id ?? ''
      assert.strictEqual((yield* errandsOf(access)).get(number)?.state, 'open')
      assert.match(yield* takeStep(access, errand), /Merged PR #1/)
      assert.deepInclude(service.merged.at(-1), { number, head: `head-${number}+other-1` })
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('GitLab, behind main: brought up to date by a merge pushed plainly, and merged at the head it made', () => {
    const { service, pull } = host({ product: 'gitlab' })
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      const number = pull('Retry refunds')
      service.writeTo('main')
      const message = yield* turn(access, 'person')
      assert.match(yield* merge(access, { pull_request: `#${number}`, head: `head-${number}`, message }), /behind main at other-1/)
      yield* sweep(access)
      // update_branch's merge of main in, never a rebase: GitLab has no call for it, so a copy of Althar's pushes it.
      const made = `head-${number}+other-1`
      assert.deepStrictEqual(service.branchesUpdated, [{ number, head: made }])
      yield* sweep(access)
      const errand = (yield* errandsOf(access)).get(number)?.id ?? ''
      assert.include((yield* news(access)).at(-1), `errand "${errand}"`)
      // GitLab's auto-merge is the line's merge, at the head Althar made.
      assert.match(yield* takeStep(access, errand), /Auto-merge is on for MR !1/)
      assert.deepInclude(service.merged.at(-1), { number, how: 'auto', head: made })
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('GitHub refuses to update a branch: it steps out of line, said to its lead once, and the next goes ahead', () => {
    const { service, pull } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      const first = pull('Retry refunds')
      service.writeTo('main')
      const second = pull('Cap retries')
      const message = yield* turn(access, 'person')
      assert.match(yield* merge(access, { pull_request: `#${first}`, head: `head-${first}`, message }), /behind main at other-1/)
      // As for a fork whose author doesn't allow edits by maintainers.
      service.failNext('updateBranch', 'forbidden', undefined, 403)
      yield* sweep(access)
      yield* sweep(access)
      assert.deepStrictEqual(service.updated, [])
      const said = (yield* news(access)).filter((body) => body.includes('can’t merge it in'))
      assert.strictEqual(said.length, 1)
      assert.match(said[0] ?? '', /GitHub won’t let Althar’s account update its branch .*message_lead/)
      assert.match(yield* merge(access, { pull_request: `#${second}`, head: `head-${second}`, message }), /Merged PR #2/)
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('GitHub can’t find the branch to update: it steps out of line, said to its lead once', () => {
    const { service, pull } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      const number = pull('Retry refunds')
      service.writeTo('main')
      const message = yield* turn(access, 'person')
      yield* merge(access, { pull_request: `#${number}`, head: `head-${number}`, message })
      service.failNext('updateBranch', 'not_found', undefined, 404)
      yield* sweep(access)
      yield* sweep(access)
      const said = (yield* news(access)).filter((body) => body.includes('refused to update its branch'))
      assert.strictEqual(said.length, 1)
      assert.match(said[0] ?? '', /GitHub refused to update its branch.*message_lead/)
    }).pipe(Effect.provide(layer(service)))
  })

  it.live('GitHub doesn’t answer an update: said once without the lead, and tried again later', () => {
    const { service, pull } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      const number = pull('Retry refunds')
      service.writeTo('main')
      const message = yield* turn(access, 'person')
      yield* merge(access, { pull_request: `#${number}`, head: `head-${number}`, message })
      service.failNext('updateBranch', 'unreachable', undefined, 502)
      yield* sweep(access)
      yield* sweep(access)
      const said = (yield* news(access)).filter((body) => body.includes('can’t merge it in'))
      assert.strictEqual(said.length, 1)
      assert.include(said[0], 'Althar tries again in a few minutes')
      assert.notInclude(said[0], 'message_lead')
      assert.deepStrictEqual(service.updated, [])
    }).pipe(Effect.provide(layer(service)))
  })

  it.live(
    'GitLab, behind main, on a fork Althar may not push to: it steps out of line, said to its lead once, and the next goes ahead',
    () => {
      const { service, pull } = host({ product: 'gitlab' })
      const { working } = hosted(['meridian', 'api'])
      return Effect.gen(function* () {
        const access = yield* opened(working)
        const first = service.addPullRequest({
          path: ['meridian', 'api'],
          title: 'Retry refunds',
          author: 'ana',
          fork: ['ana', 'api'],
        }).number
        service.writeTo('main')
        const second = pull('Cap retries')
        const message = yield* turn(access, 'person')
        assert.match(yield* merge(access, { pull_request: `#${first}`, head: `head-${first}`, message }), /behind main at other-1/)
        yield* sweep(access)
        yield* sweep(access)
        const said = (yield* news(access)).filter((body) => body.includes('can’t merge it in'))
        assert.strictEqual(said.length, 1)
        assert.match(
          said[0] ?? '',
          /MR !1 must have main’s other-1 merged in before it merges, and Althar can’t merge it in: The account may not push to .* on the author’s fork\. .*message_lead/,
        )
        // Out of line, it holds no slot: the next, up to date, merges at once.
        assert.match(yield* merge(access, { pull_request: `#${second}`, head: `head-${second}`, message }), /Auto-merge is on for MR !2/)
        assert.strictEqual((yield* errandsOf(access)).get(first)?.state, 'open')
      }).pipe(Effect.provide(layer(service)))
    },
  )

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
