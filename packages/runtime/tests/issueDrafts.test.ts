import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { IssueDraftCard } from '@althar/contracts'
import { ConnectorFailed, makeLinear, products } from '@althar/connectors'
import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { migrations } from '@althar/persistence-sqlite'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connectors } from '../src/Config'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { coordinatorNews, modelNamer } from '../src/coordinatorNews'
import { NotFound } from '../src/errors'
import { Instance } from '../src/Instance'
import { DraftClosed, DraftUntitled, IssueDrafts, refusedDraft } from '../src/IssueDrafts'
import { Issues } from '../src/Issues'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { transcript } from '../src/threads'
import { type ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, items, listTools, repository, runtime, turns, until } from './support'

/*
 * Issues the coordinator drafts (docs/architecture/06, "Drafting issues"):
 * a card in its thread, filed only when the person says, changed or
 * discarded before that, and what became of it told to the coordinator.
 */

type Services = { readonly github?: FakeService; readonly linear?: FakeService; readonly trello?: FakeService }

const withQueries = (services: Services, database = ':memory:') =>
  Queries.layer.pipe(Layer.provideMerge(runtime(database, {}, { connectors: fakeConnectors(services) })))

const connect = (product: 'github' | 'linear' | 'trello', webUrl?: string) =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    return yield* connections.connectToken({
      product,
      token: 't',
      actorId: instance.personId,
      ...(product === 'trello' ? { key: 'k'.repeat(32) } : {}),
      ...(webUrl === undefined ? {} : { webUrl }),
    })
  })

/** A project, at a folder of its own or one given, and the coordinator as its tools see it. */
const project = (path = repository()) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const coordinator = yield* Coordinator
    const opened = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
    const threadId = yield* coordinator.thread(opened.projectId)
    const access: ToolAccess = {
      role: 'coordinator',
      projectId: opened.projectId,
      threadId,
      sessionId: 'coordinator-session',
      taskId: null,
    }
    return { projectId: opened.projectId as ProjectId, threadId, access }
  })

/** The issue drafts' cards in a project's coordinator thread, as its screen reads them. */
const cardsOf = (projectId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const snapshot = yield* Effect.orDie(queries.coordinator(projectId))
    return snapshot.items.flatMap((item): ReadonlyArray<IssueDraftCard> => (item.kind === 'issue_draft' ? [item.content] : []))
  })

const linearWith = (...teams: ReadonlyArray<{ readonly id: string; readonly key: string; readonly name: string }>) => {
  const linear = makeFakeService({ product: 'linear' })
  for (const team of teams) linear.addContainer(team)
  return linear
}

const MERIDIAN = { id: 'team-1', key: 'MER', name: 'Meridian' }
const PLATFORM = { id: 'team-2', key: 'PLT', name: 'Platform' }

describe('issue drafts', () => {
  it.live('are a card the coordinator drafts, filed only when the person says, then told to the coordinator', () => {
    const linear = linearWith(MERIDIAN)
    return Effect.gen(function* () {
      yield* connect('linear')
      const { projectId, threadId, access } = yield* project()
      const drafts = yield* IssueDrafts
      const instance = yield* Instance

      const said = yield* callTool(access, 'draft_issue', {
        title: 'Refunds skip the rate limiter',
        description: 'Charges go through it; refunds don’t.',
        labels: ['payments', ' payments ', ''],
      })
      assert.match(
        said,
        /^Drafted the issue “Refunds skip the rate limiter” on Linear, in Meridian\. Nothing is filed until the person files it/,
      )
      // Nothing reached the tracker.
      assert.lengthOf(linear.created, 0)
      const [card] = yield* cardsOf(projectId)
      assert.deepStrictEqual(card && { ...card, draftId: '' }, {
        draftId: '',
        product: 'linear',
        tracker: 'Linear',
        container: 'Meridian',
        title: 'Refunds skip the rate limiter',
        body: 'Charges go through it; refunds don’t.',
        labels: ['payments'],
        priority: null,
        state: 'pending',
        error: null,
        issue: null,
      })
      // Asked again with the same title, unsure the first worked, it is the same draft.
      yield* callTool(access, 'draft_issue', { title: 'refunds skip the rate limiter' })
      assert.lengthOf(yield* cardsOf(projectId), 1)

      // Filed, the issue is on the tracker, and the card shows its key and link.
      const filed = yield* drafts.file(card?.draftId ?? '', instance.personId)
      assert.strictEqual(filed.state, 'filed')
      assert.lengthOf(linear.created, 1)
      assert.deepStrictEqual(
        linear.created.map((issue) => ({ title: issue.title, body: issue.body, labels: issue.labels })),
        [{ title: 'Refunds skip the rate limiter', body: 'Charges go through it; refunds don’t.', labels: ['payments'] }],
      )
      const [shown] = yield* cardsOf(projectId)
      assert.strictEqual(shown?.state, 'filed')
      assert.strictEqual(shown?.issue?.key, 'MER-1')
      assert.strictEqual(shown?.issue?.url, linear.created[0]?.url)
      // Filed once: pressing again files nothing more, and it can't change.
      const again = yield* Effect.flip(drafts.file(card?.draftId ?? '', instance.personId))
      assert.instanceOf(again, DraftClosed)
      assert.lengthOf(linear.created, 1)
      assert.instanceOf(
        yield* Effect.flip(drafts.change(card?.draftId ?? '', { title: 'x', body: '', labels: [] }, instance.personId)),
        DraftClosed,
      )

      // A task drafted from it later reads it by its key, through the connection that filed it.
      const issues = yield* Issues
      assert.strictEqual((yield* issues.read('mer-1', projectId)).title, 'Refunds skip the rate limiter')
      assert.match(
        yield* callTool(access, 'draft_task', { title: 'Rate-limit refunds', issue: 'MER-1' }),
        /^Drafted rate-limit-refunds, from MER-1\./,
      )

      // Its thread, read as text, says where it stands.
      assert.match(
        (yield* transcript(threadId, 10_000)).text,
        /\[issue draft\] Refunds skip the rate limiter \(filed, MER-1 https:\/\/linear\.app\//,
      )
    }).pipe(Effect.provide(withQueries({ linear })))
  })

  it.live('drafted before priorities still show, with none, once the store is migrated', () => {
    const linear = linearWith(MERIDIAN)
    return Effect.gen(function* () {
      yield* connect('linear')
      const sql = yield* SqlClient.SqlClient
      const { projectId, access } = yield* project()
      yield* callTool(access, 'draft_issue', { title: 'Refunds skip the rate limiter' })
      // Its card as a thread kept it before priorities: it reads as nothing, until the store is migrated.
      yield* sql`UPDATE thread_items SET content = json_remove(content, '$.priority') WHERE kind = 'issue_draft'`
      assert.lengthOf(yield* cardsOf(projectId), 0)
      const changes = migrations.find((migration) => migration.key === '0040_issue_changes') ?? assert.fail('no migration')
      for (const statement of changes.statements.filter((each) => each.startsWith('UPDATE thread_items'))) yield* sql.unsafe(statement)
      const [card] = yield* cardsOf(projectId)
      assert.deepInclude(card, { title: 'Refunds skip the rate limiter', priority: null, state: 'pending' })
    }).pipe(Effect.provide(withQueries({ linear })))
  })

  it.live('can be changed before filing, and discarded, which files nothing', () => {
    const linear = linearWith(MERIDIAN)
    return Effect.gen(function* () {
      yield* connect('linear')
      const { projectId, access } = yield* project()
      const drafts = yield* IssueDrafts
      const instance = yield* Instance

      yield* callTool(access, 'draft_issue', { title: 'Flaky checkout test', description: 'Fails one run in ten.' })
      const [first] = yield* cardsOf(projectId)
      yield* drafts.change(
        first?.draftId ?? '',
        { title: ' Flaky checkout e2e ', body: 'Fails on CI.', labels: ['ci', 'ci'] },
        instance.personId,
      )
      const [changed] = yield* cardsOf(projectId)
      assert.deepStrictEqual(
        [changed?.title, changed?.body, changed?.labels, changed?.state],
        ['Flaky checkout e2e', 'Fails on CI.', ['ci'], 'pending'],
      )
      assert.instanceOf(
        yield* Effect.flip(drafts.change(first?.draftId ?? '', { title: '  ', body: '', labels: [] }, instance.personId)),
        DraftUntitled,
      )
      yield* drafts.file(first?.draftId ?? '', instance.personId)
      assert.deepStrictEqual(
        linear.created.map((issue) => [issue.title, issue.body, issue.labels]),
        [['Flaky checkout e2e', 'Fails on CI.', ['ci']]],
      )

      yield* callTool(access, 'draft_issue', { title: 'Rename the env var' })
      const second = (yield* cardsOf(projectId)).find((card) => card.title === 'Rename the env var')
      yield* drafts.discard(second?.draftId ?? '', instance.personId)
      assert.strictEqual((yield* cardsOf(projectId)).find((card) => card.title === 'Rename the env var')?.state, 'discarded')
      assert.lengthOf(linear.created, 1)
      assert.instanceOf(yield* Effect.flip(drafts.file(second?.draftId ?? '', instance.personId)), DraftClosed)
      assert.instanceOf(yield* Effect.flip(drafts.discard(second?.draftId ?? '', instance.personId)), DraftClosed)
      assert.lengthOf(linear.created, 1)
    }).pipe(Effect.provide(withQueries({ linear })))
  })

  it.live('say why one wasn’t filed, and file it when tried again', () => {
    const linear = linearWith(MERIDIAN)
    return Effect.gen(function* () {
      yield* connect('linear')
      const { projectId, access } = yield* project()
      const drafts = yield* IssueDrafts
      const instance = yield* Instance
      yield* callTool(access, 'draft_issue', { title: 'Retry webhooks' })
      const [card] = yield* cardsOf(projectId)

      linear.failNext('create', 'forbidden')
      assert.strictEqual((yield* drafts.file(card?.draftId ?? '', instance.personId)).state, 'failed')
      const [failed] = yield* cardsOf(projectId)
      assert.strictEqual(failed?.state, 'failed')
      assert.match(failed?.error ?? '', /^Linear says this account may not file issues there/)
      assert.lengthOf(linear.created, 0)

      linear.failNext('create', 'rate_limited')
      yield* drafts.file(card?.draftId ?? '', instance.personId)
      assert.match((yield* cardsOf(projectId))[0]?.error ?? '', /asks Althar to wait/)
      linear.failNext('create', 'rejected')
      yield* drafts.file(card?.draftId ?? '', instance.personId)
      assert.match((yield* cardsOf(projectId))[0]?.error ?? '', /fake create failed/i)

      // Changed while it stands failed, then tried again: filed as it now reads.
      yield* drafts.change(card?.draftId ?? '', { title: 'Retry webhooks with backoff', body: '', labels: [] }, instance.personId)
      assert.strictEqual((yield* drafts.file(card?.draftId ?? '', instance.personId)).state, 'filed')
      const [filed] = yield* cardsOf(projectId)
      assert.deepStrictEqual([filed?.state, filed?.error, filed?.issue?.key], ['filed', null, 'MER-1'])
      assert.deepStrictEqual(
        linear.created.map((issue) => issue.title),
        ['Retry webhooks with backoff'],
      )
    }).pipe(Effect.provide(withQueries({ linear })))
  })

  it.live('are perhaps filed, not unfiled, when the tracker’s answer is lost or unreadable', () => {
    const linear = linearWith(MERIDIAN)
    return Effect.gen(function* () {
      yield* connect('linear')
      const { projectId, access } = yield* project()
      const drafts = yield* IssueDrafts
      const instance = yield* Instance
      yield* callTool(access, 'draft_issue', { title: 'Retry webhooks' })
      const [card] = yield* cardsOf(projectId)
      for (const reason of ['unreachable', 'invalid_response'] as const) {
        linear.failNext('create', reason)
        assert.strictEqual((yield* drafts.file(card?.draftId ?? '', instance.personId)).state, 'uncertain')
        const [shown] = yield* cardsOf(projectId)
        assert.strictEqual(shown?.state, 'uncertain')
        assert.strictEqual(
          shown?.error,
          'Its answer was lost, so Althar can’t tell whether Linear filed it. Look on Linear before you file it again.',
        )
      }
      // Once the person has looked, it can still be changed, discarded, or filed again; never on its own.
      assert.lengthOf(linear.created, 0)
      yield* drafts.change(card?.draftId ?? '', { title: 'Retry webhooks, again', body: '', labels: [] }, instance.personId)
      assert.strictEqual((yield* drafts.file(card?.draftId ?? '', instance.personId)).state, 'filed')
      assert.lengthOf(linear.created, 1)
    }).pipe(Effect.provide(withQueries({ linear })))
  })

  it.live('are perhaps filed when Linear itself says it filed one without saying which, or fails inside', () => {
    // Linear's own adapter, over a stand-in for its API: what it answers is each case's.
    let answer: { readonly status: number; readonly body: unknown } = { status: 200, body: {} }
    const fetch = (_url: string, init?: RequestInit) => {
      const { query } = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { query?: string }
      const said = query?.includes('teams(')
        ? { status: 200, body: { data: { teams: { nodes: [MERIDIAN], pageInfo: { hasNextPage: false, endCursor: null } } } } }
        : query?.includes('viewer')
          ? { status: 200, body: { data: { viewer: { id: '1', name: 'You', displayName: 'you' } } } }
          : answer
      return Promise.resolve(
        new Response(JSON.stringify(said.body), { status: said.status, headers: { 'content-type': 'application/json' } }),
      )
    }
    const linear = linearWith(MERIDIAN)
    const connectors = Layer.succeed(
      Connectors,
      Connectors.of({
        products: [{ ...products.linear, make: (options) => ({ tracker: makeLinear({ ...options, fetch }) }), access: linear.access }],
        fetch: () => Promise.reject(new Error('No network in tests')),
        clientIds: {},
        callbackPort: 0,
        cliToken: () => Effect.succeed(null),
      }),
    )
    return Effect.gen(function* () {
      yield* connect('linear')
      const { projectId, access } = yield* project()
      const drafts = yield* IssueDrafts
      const instance = yield* Instance
      yield* callTool(access, 'draft_issue', { title: 'Retry webhooks' })
      const [card] = yield* cardsOf(projectId)
      const stateAfter = (status: number, body: unknown) =>
        Effect.gen(function* () {
          answer = { status, body }
          return (yield* drafts.file(card?.draftId ?? '', instance.personId)).state
        })
      assert.strictEqual(yield* stateAfter(200, { data: { issueCreate: { success: true, issue: null } } }), 'uncertain')
      assert.strictEqual(yield* stateAfter(200, { data: { issueCreate: { success: true } } }), 'uncertain')
      assert.strictEqual(yield* stateAfter(500, { errors: [{ message: 'Internal error' }] }), 'uncertain')
      assert.strictEqual(
        yield* stateAfter(200, { errors: [{ message: 'Oops', extensions: { code: 'INTERNAL_SERVER_ERROR' } }] }),
        'uncertain',
      )
      // A refusal Linear answers with files nothing.
      assert.strictEqual(yield* stateAfter(200, { data: { issueCreate: { success: false, issue: null } } }), 'failed')
      assert.strictEqual(
        yield* stateAfter(400, { errors: [{ message: 'Title is too long', extensions: { code: 'INVALID_INPUT' } }] }),
        'failed',
      )
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { connectors })))))
  })

  it.live('fail to file while the tracker wants signing in again, or once its connection is gone', () => {
    const linear = linearWith(MERIDIAN)
    return Effect.gen(function* () {
      const connection = yield* connect('linear')
      const { projectId, access } = yield* project()
      const drafts = yield* IssueDrafts
      const instance = yield* Instance
      yield* callTool(access, 'draft_issue', { title: 'Retry webhooks' })
      const [card] = yield* cardsOf(projectId)
      // Refused, and refused again on Althar's second look: the sign-in is no good.
      linear.failNext('create', 'unauthorized')
      linear.failNext('account', 'unauthorized')
      yield* drafts.file(card?.draftId ?? '', instance.personId)
      assert.match((yield* cardsOf(projectId))[0]?.error ?? '', /^Linear didn’t take Althar’s sign-in\. Sign in again in Settings/)
      // Until it is signed in again, Althar doesn't ask.
      yield* drafts.file(card?.draftId ?? '', instance.personId)
      assert.match((yield* cardsOf(projectId))[0]?.error ?? '', /^Linear didn’t take Althar’s sign-in/)
      yield* (yield* Connections).remove(connection.id, instance.personId)
      yield* drafts.file(card?.draftId ?? '', instance.personId)
      assert.match((yield* cardsOf(projectId))[0]?.error ?? '', /^The connection to Linear is gone/)
      assert.lengthOf(linear.created, 0)
    }).pipe(Effect.provide(withQueries({ linear })))
  })

  it.live('go where the project’s issues come from, or where the coordinator says', () => {
    const { working } = hosted()
    const github = makeFakeService({ pushUrl: () => '' })
    github.addRepository(['meridian', 'api'])
    github.addRepository(['meridian', 'web'])
    const linear = linearWith(MERIDIAN, PLATFORM)
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      yield* connect('linear')
      const { projectId, access } = yield* project(working)
      const named = (title: string) =>
        Effect.map(cardsOf(projectId), (cards) => {
          const card = cards.find((one) => one.title === title)
          return `${card?.tracker ?? ''} / ${card?.container ?? ''}`
        })

      // Nothing named, and no issue yet: the project's own repository.
      yield* callTool(access, 'draft_issue', { title: 'On the repository' })
      assert.strictEqual(yield* named('On the repository'), 'GitHub / meridian/api')
      // A tracker named with several places, none named: Althar says which it has.
      assert.strictEqual(
        yield* callTool(access, 'draft_issue', { title: 'Somewhere on Linear', tracker: 'linear' }),
        'Say where on Linear it goes, as container: MER (Meridian), PLT (Platform).',
      )
      yield* callTool(access, 'draft_issue', { title: 'On Platform', tracker: 'Linear', container: 'plt' })
      assert.strictEqual(yield* named('On Platform'), 'Linear / Platform')
      yield* callTool(access, 'draft_issue', { title: 'On the web', tracker: 'github', container: 'meridian/web' })
      assert.strictEqual(yield* named('On the web'), 'GitHub / meridian/web')
      assert.strictEqual(
        yield* callTool(access, 'draft_issue', { title: 'Nowhere', tracker: 'Linear', container: 'Payments' }),
        'Linear has nowhere called Payments for issues. It has: MER (Meridian), PLT (Platform).',
      )
      assert.strictEqual(
        yield* callTool(access, 'draft_issue', { title: 'On Jira', tracker: 'jira' }),
        'No tracker called jira is connected. Connected: GitHub, Linear.',
      )
      assert.strictEqual(yield* callTool(access, 'draft_issue', { title: '  ' }), 'Give the issue a title.')
      assert.match(yield* callTool(access, 'draft_issue', { title: 7 }), /couldn't read that/)
      github.failNext('containers', 'unreachable')
      assert.match(yield* callTool(access, 'draft_issue', { title: 'Unasked' }), /^Althar couldn't ask the tracker where issues go/)

      // Once one is filed on Linear, that is where the project's issues come from.
      const drafts = yield* IssueDrafts
      const instance = yield* Instance
      const platform = (yield* cardsOf(projectId)).find((card) => card.title === 'On Platform')
      yield* drafts.file(platform?.draftId ?? '', instance.personId)
      yield* callTool(access, 'draft_issue', { title: 'After one was filed' })
      assert.strictEqual(yield* named('After one was filed'), 'Linear / Platform')
    }).pipe(Effect.provide(withQueries({ github, linear })))
  })

  it.live('tell two connections of one tracker apart, by site, and keep a draft per place', () => {
    // Two GitHub servers, each its own service: one has acme/tools, both have meridian/api.
    const ours = makeFakeService({ pushUrl: () => '' })
    ours.addRepository(['meridian', 'api'])
    const theirs = makeFakeService({ pushUrl: () => '' })
    theirs.addRepository(['meridian', 'api'])
    theirs.addRepository(['acme', 'tools'])
    const connectors = Layer.succeed(
      Connectors,
      Connectors.of({
        products: [
          {
            ...products.github,
            make: (options) => {
              const service = options.webUrl.includes('ghe.test') ? theirs : ours
              return { host: service, tracker: service }
            },
            access: ours.access,
          },
        ],
        fetch: () => Promise.reject(new Error('No network in tests')),
        clientIds: {},
        callbackPort: 0,
        cliToken: () => Effect.succeed(null),
      }),
    )
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      yield* connect('github', 'https://ghe.test')
      const { projectId, access } = yield* project()
      const trackerOf = (title: string) =>
        Effect.map(cardsOf(projectId), (cards) => {
          const card = cards.find((one) => one.title === title)
          return `${card?.tracker ?? ''} / ${card?.container ?? ''}`
        })
      // Nothing to choose by: which is asked, by the names that tell them apart.
      assert.strictEqual(
        yield* callTool(access, 'draft_issue', { title: 'Anywhere' }),
        'Say which tracker it goes on, as tracker: GitHub (ghe.test), GitHub (github.test).',
      )
      // A repository only one of them has goes there, and the card says which.
      yield* callTool(access, 'draft_issue', { title: 'Tools', tracker: 'GitHub', container: 'acme/tools' })
      assert.strictEqual(yield* trackerOf('Tools'), 'GitHub (ghe.test) / acme/tools')
      yield* callTool(access, 'draft_issue', { title: 'Tools elsewhere', container: 'acme/tools' })
      assert.strictEqual(yield* trackerOf('Tools elsewhere'), 'GitHub (ghe.test) / acme/tools')
      // One both have is asked about, never guessed; named by site, it is clear.
      assert.strictEqual(
        yield* callTool(access, 'draft_issue', { title: 'Api', tracker: 'github', container: 'meridian/api' }),
        'Say which tracker it goes on, as tracker: GitHub (ghe.test), GitHub (github.test).',
      )
      yield* callTool(access, 'draft_issue', { title: 'Api', tracker: 'https://ghe.test/', container: 'meridian/api' })
      assert.strictEqual(yield* trackerOf('Api'), 'GitHub (ghe.test) / meridian/api')
      // The same title for another place is another draft, not the first one again.
      yield* callTool(access, 'draft_issue', { title: 'Api', tracker: 'GitHub (github.test)', container: 'meridian/api' })
      const apis = (yield* cardsOf(projectId)).filter((card) => card.title === 'Api').map((card) => card.tracker)
      assert.deepStrictEqual(apis, ['GitHub (ghe.test)', 'GitHub (github.test)'])
      // For the same place, it is the first again.
      yield* callTool(access, 'draft_issue', { title: 'api', tracker: 'ghe.test', container: 'meridian/api' })
      assert.lengthOf(
        (yield* cardsOf(projectId)).filter((card) => card.title.toLowerCase() === 'api'),
        2,
      )
      // Nowhere by that name on either: what each has.
      assert.strictEqual(
        yield* callTool(access, 'draft_issue', { title: 'Lost', container: 'acme/lost' }),
        'No connected tracker has anywhere called acme/lost for issues. They have: GitHub (ghe.test): meridian/api, GitHub (ghe.test): acme/tools, GitHub (github.test): meridian/api.',
      )
      // Filed, it is on the server it was drafted for.
      const drafts = yield* IssueDrafts
      const instance = yield* Instance
      const tools = (yield* cardsOf(projectId)).find((card) => card.title === 'Tools')
      yield* drafts.file(tools?.draftId ?? '', instance.personId)
      assert.deepStrictEqual([theirs.created.map((issue) => issue.title), ours.created.length], [['Tools'], 0])
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { connectors })))))
  })

  it.live('say so when there is nowhere to draft one, or no single place to choose', () => {
    const linear = linearWith(MERIDIAN, PLATFORM)
    const trello = makeFakeService({ product: 'trello' })
    return Effect.gen(function* () {
      const { access } = yield* project()
      assert.match(yield* callTool(access, 'draft_issue', { title: 'Lost' }), /^The person has no tracker connected to Althar/)
      yield* connect('linear')
      assert.strictEqual(
        yield* callTool(access, 'draft_issue', { title: 'Which team' }),
        'Say where on Linear it goes, as container: MER (Meridian), PLT (Platform).',
      )
      yield* connect('trello')
      assert.strictEqual(
        yield* callTool(access, 'draft_issue', { title: 'Which tracker' }),
        'Say which tracker it goes on, as tracker: Linear, Trello.',
      )
      // A tracker with nowhere this account can file.
      assert.strictEqual(
        yield* callTool(access, 'draft_issue', { title: 'On Trello', tracker: 'trello' }),
        "This account can't file issues anywhere on Trello.",
      )
    }).pipe(Effect.provide(withQueries({ linear, trello })))
  })

  it.live('go where the one tracker that has the place named is, though another couldn’t say where its issues go', () => {
    const linear = linearWith(MERIDIAN, PLATFORM)
    const trello = makeFakeService({ product: 'trello' })
    trello.addContainer({ id: 'board-1', name: 'Roadmap' })
    return Effect.gen(function* () {
      yield* connect('linear')
      yield* connect('trello')
      const { projectId, access } = yield* project()
      trello.failNext('containers', 'unreachable')
      assert.match(
        yield* callTool(access, 'draft_issue', { title: 'On Platform', container: 'PLT' }),
        /^Drafted the issue “On Platform” on Linear, in Platform\./,
      )
      // Asked of one tracker alone, its failure to say stands.
      trello.failNext('containers', 'unreachable')
      assert.match(
        yield* callTool(access, 'draft_issue', { title: 'On the roadmap', tracker: 'trello', container: 'Roadmap' }),
        /^Althar couldn't ask the tracker where issues go/,
      )
      const [card] = yield* cardsOf(projectId)
      assert.deepInclude(card, { tracker: 'Linear', container: 'Platform', title: 'On Platform' })
      assert.lengthOf(yield* cardsOf(projectId), 1)
    }).pipe(Effect.provide(withQueries({ linear, trello })))
  })

  it.live('take a tracker or a place named as nothing as not named, and list the first twenty places where there are more', () => {
    const many = Array.from({ length: 25 }, (_, index) => ({ id: `team-${index + 1}`, key: `T${index + 1}`, name: `Team ${index + 1}` }))
    const linear = linearWith(...many)
    return Effect.gen(function* () {
      yield* connect('linear')
      const { access } = yield* project()
      const asked = yield* callTool(access, 'draft_issue', { title: 'Somewhere', tracker: ' ', container: '' })
      assert.isTrue(asked.startsWith('Say where on Linear it goes, as container: T1 (Team 1), T2 (Team 2), '), asked)
      assert.isTrue(asked.endsWith('T20 (Team 20), and 5 more.'), asked)
    }).pipe(Effect.provide(withQueries({ linear })))
  })

  it.live('say a tracker’s refusal in Althar’s words where the tracker gave none of its own', () => {
    const fake = linearWith(MERIDIAN)
    const refusals: Array<ConnectorFailed['reason']> = ['forbidden', 'rejected']
    // A tracker that refuses without a word, as some answer a 403 or a 422.
    const linear: FakeService = {
      ...fake,
      create: () => Effect.fail(new ConnectorFailed({ product: 'linear', reason: refusals.shift() ?? 'rejected', message: '' })),
    }
    return Effect.gen(function* () {
      yield* connect('linear')
      const { projectId, access } = yield* project()
      const drafts = yield* IssueDrafts
      const instance = yield* Instance
      yield* callTool(access, 'draft_issue', { title: 'Retry webhooks' })
      const [card] = yield* cardsOf(projectId)
      assert.deepInclude(yield* drafts.file(card?.draftId ?? '', instance.personId), {
        state: 'failed',
        error: 'Linear says this account may not file issues there',
      })
      assert.deepInclude(yield* drafts.file(card?.draftId ?? '', instance.personId), { state: 'failed', error: 'Linear refused it.' })
    }).pipe(Effect.provide(withQueries({ linear })))
  })

  it.live('are filed once when the person presses File twice at once', () => {
    const fake = linearWith(MERIDIAN)
    // A tracker that takes a moment to file one, as a real one does.
    const linear: FakeService = {
      ...fake,
      create: (container, issue) => Effect.andThen(Effect.sleep('300 millis'), fake.create(container, issue)),
    }
    return Effect.gen(function* () {
      yield* connect('linear')
      const { projectId, access } = yield* project()
      const drafts = yield* IssueDrafts
      const instance = yield* Instance
      yield* callTool(access, 'draft_issue', { title: 'Retry webhooks' })
      const [card] = yield* cardsOf(projectId)
      const both = yield* Effect.all(
        [drafts.file(card?.draftId ?? '', instance.personId), drafts.file(card?.draftId ?? '', instance.personId)],
        { concurrency: 'unbounded' },
      )
      assert.sameMembers(
        both.map((one) => one.state),
        ['filing', 'filed'],
      )
      assert.lengthOf(fake.created, 1)
      assert.strictEqual((yield* cardsOf(projectId))[0]?.state, 'filed')
    }).pipe(Effect.provide(withQueries({ linear })))
  })

  it.live('that aren’t there can’t be filed or discarded', () => {
    const linear = linearWith(MERIDIAN)
    return Effect.gen(function* () {
      const drafts = yield* IssueDrafts
      const instance = yield* Instance
      assert.instanceOf(yield* Effect.flip(drafts.file('draft_none', instance.personId)), NotFound)
      assert.instanceOf(yield* Effect.flip(drafts.discard('draft_none', instance.personId)), NotFound)
      // A failure that isn't about where it goes reaches the tool as it is.
      const other = new Error('The store is busy')
      assert.strictEqual(refusedDraft(other), other)
    }).pipe(Effect.provide(withQueries({ linear })))
  })

  it.live('tell the coordinator what the person did with them', () => {
    const linear = linearWith(MERIDIAN)
    return Effect.gen(function* () {
      yield* connect('linear')
      const sql = yield* SqlClient.SqlClient
      const { projectId, threadId, access } = yield* project()
      const drafts = yield* IssueDrafts
      const instance = yield* Instance
      const coordinator = yield* Coordinator
      // It has spoken once: what it hears is what came after.
      yield* coordinator.say({
        envelope: yield* Runtime.envelope('thread.send', { body: 'Hello.' }),
        threadId,
        body: 'Hello.',
        disposition: 'after_current',
      })
      yield* until(
        sql<{ state: string }>`SELECT state FROM turn_deliveries WHERE thread_id = ${threadId}`,
        (rows) => rows.length > 0 && rows.every((row) => row.state !== 'pending' && row.state !== 'delivered'),
      )
      const draftOf = (title: string) =>
        Effect.gen(function* () {
          yield* callTool(access, 'draft_issue', { title })
          return (yield* cardsOf(projectId)).find((card) => card.title === title)?.draftId ?? ''
        })
      const filed = yield* draftOf('Refunds skip the limiter')
      yield* drafts.change(filed, { title: 'Refunds skip the rate limiter', body: '', labels: [] }, instance.personId)
      yield* drafts.file(filed, instance.personId)
      yield* drafts.discard(yield* draftOf('Rename the env var'), instance.personId)
      yield* drafts.change(yield* draftOf('Flaky test'), { title: 'Flaky checkout test', body: '', labels: [] }, instance.personId)
      const failing = yield* draftOf('Retry webhooks')
      linear.failNext('create', 'unreachable')
      yield* drafts.file(failing, instance.personId)
      // Perhaps filed, then discarded: still perhaps on the tracker.
      const doubted = yield* draftOf('Doubted')
      linear.failNext('create', 'invalid_response')
      yield* drafts.file(doubted, instance.personId)
      yield* drafts.discard(doubted, instance.personId)
      const refused = yield* draftOf('Refused')
      linear.failNext('create', 'rejected')
      yield* drafts.file(refused, instance.personId)
      // Left alone, a draft says nothing.
      yield* draftOf('Untouched')

      const news = (yield* coordinatorNews(threadId, projectId, yield* modelNamer)) ?? ''
      assert.match(news, /^Since you last spoke, in Althar:\n/)
      assert.match(
        news,
        /- The issue “Refunds skip the rate limiter” \(you drafted it as “Refunds skip the limiter”\) is filed on Linear, in Meridian, as MER-1: https:\/\/linear\.app\/\S+\. The person changed it before filing it\./,
      )
      assert.include(news, '- The person discarded the issue “Rename the env var”: nothing was filed.')
      assert.include(
        news,
        '- The person discarded the issue “Doubted” without filing it again. An earlier try may have reached Linear before its answer was lost, so it may be there; Althar doesn’t know.',
      )
      assert.notInclude(news, '“Doubted”: nothing was filed')
      assert.include(
        news,
        '- The person changed the issue you drafted (you drafted it as “Flaky test”): it now reads “Flaky checkout test”, and waits on them to file it.',
      )
      assert.include(
        news,
        '- The issue “Retry webhooks” may or may not be on Linear: Its answer was lost, so Althar can’t tell whether Linear filed it. Look on Linear before you file it again. The person decides once they have looked.',
      )
      assert.include(
        news,
        '- The issue “Refused” couldn’t be filed on Linear: The fake create failed (rejected) The person can file it again from its card.',
      )
      assert.notInclude(news, 'Untouched')
      assert.match(news, /Speak of these issues as they are now, not as you drafted them\.$/)
    }).pipe(Effect.provide(withQueries({ linear })))
  })

  it.live('left being filed when Althar closed are said to be uncertain, not filed again', () => {
    const linear = linearWith(MERIDIAN)
    const database = join(mkdtempSync(join(tmpdir(), 'althar-drafts-')), 'althar.sqlite')
    return Effect.gen(function* () {
      const projectId = yield* Effect.gen(function* () {
        yield* connect('linear')
        const { projectId, access } = yield* project()
        yield* callTool(access, 'draft_issue', { title: 'Half filed' })
        const sql = yield* SqlClient.SqlClient
        // As if Althar closed while the tracker was being asked.
        yield* sql`UPDATE issue_drafts SET state = 'filing'`
        return projectId
      }).pipe(Effect.provide(withQueries({ linear }, database)))
      yield* Effect.gen(function* () {
        const [card] = yield* cardsOf(projectId)
        assert.strictEqual(card?.state, 'uncertain')
        assert.strictEqual(card?.error, 'Althar closed while filing this. Look on Linear for it before you file it again.')
        assert.lengthOf(linear.created, 0)
      }).pipe(Effect.provide(withQueries({ linear }, database)))
    })
  })

  describe('of a task’s lead', () => {
    /** A task started with a lead at work, and the lead's tools as it is given them. */
    const led = (title: string) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const { projectId, access } = yield* project()
        assert.match(yield* callTool(access, 'start_task', { title, description: 'Wait.', lead: { agent: 'claude-code' } }), /^Started /)
        const [task] = yield* sql<{ id: string; threadId: string }>`
          SELECT k.id, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task' WHERE k.title = ${title}`
        const [session] = yield* sql<{ id: string }>`SELECT id FROM provider_sessions WHERE thread_id = ${task?.threadId ?? ''}`
        const lead: ToolAccess = {
          role: 'lead',
          projectId,
          threadId: task?.threadId ?? '',
          sessionId: session?.id ?? '',
          taskId: task?.id ?? null,
        }
        return { projectId, task: task ?? assert.fail('no task'), lead }
      })

    /** The issue drafts' cards in a thread, as the store has them. */
    const cardsIn = (threadId: string) =>
      Effect.map(items(threadId), (all) =>
        all.flatMap((item) => (item.kind === 'issue_draft' ? [item.content as unknown as IssueDraftCard] : [])),
      )

    it.live('are a card in the task’s thread, put the task in Needs you, and tell the lead its key once filed', () => {
      const linear = linearWith(MERIDIAN)
      return Effect.gen(function* () {
        yield* connect('linear')
        const queries = yield* Queries
        const drafts = yield* IssueDrafts
        const instance = yield* Instance
        const { projectId, task, lead } = yield* led('Add a retry')
        // The lead can look for duplicates and draft; a reviewer only reads.
        assert.includeMembers(yield* listTools(lead), ['draft_issue', 'find_issues', 'read_issue'])
        const reviewer = yield* listTools({ ...lead, role: 'reviewer' })
        assert.includeMembers(reviewer, ['read_issue'])
        assert.notInclude(reviewer, 'draft_issue')
        assert.notInclude(reviewer, 'find_issues')

        // What the project says waits, less the calls open on it: what the lead's drafts add.
        const waitingOnDrafts = Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [calls] = yield* sql<{
            n: number
          }>`SELECT count(*) AS n FROM attention_requests WHERE project_id = ${projectId} AND state = 'open'`
          const shown = (yield* queries.projects).projects.find((one) => one.id === projectId)?.waiting ?? -1
          return shown - (calls?.n ?? 0)
        })
        assert.match(yield* callTool(lead, 'find_issues'), /^The person has no open issues/)
        const said = yield* callTool(lead, 'draft_issue', { title: 'Refunds skip the limiter', description: 'Found while here.' })
        assert.match(
          said,
          /^Drafted the issue “Refunds skip the limiter” on Linear, in Meridian\. Nothing is filed until the person files it/,
        )
        yield* callTool(lead, 'draft_issue', { title: 'Checkout logs no request ids' })

        // The cards are in the task's thread, not the coordinator's; nothing reached the tracker.
        const cards = yield* cardsIn(task.threadId)
        assert.deepStrictEqual(
          cards.map((card) => [card.title, card.state]),
          [
            ['Refunds skip the limiter', 'pending'],
            ['Checkout logs no request ids', 'pending'],
          ],
        )
        assert.lengthOf(yield* cardsOf(projectId), 0)
        assert.lengthOf(linear.created, 0)
        // The task waits on the person while drafts do, and the project counts it.
        assert.strictEqual((yield* queries.card(task.id)).phase, 'waiting')
        assert.strictEqual(yield* waitingOnDrafts, 2)

        // The person files one, discards the other: the lead hears the key and link of the one filed.
        const [first, second] = cards
        const filed = yield* drafts.file(first?.draftId ?? '', instance.personId)
        assert.strictEqual(filed.issue?.key, 'MER-1')
        yield* drafts.discard(second?.draftId ?? '', instance.personId)
        // With its drafts dealt with, only a call open on the task (a CI run can have one the lead raised) keeps it waiting.
        const sql = yield* SqlClient.SqlClient
        const [open] = yield* sql<{ n: number }>`SELECT count(*) AS n FROM attention_requests WHERE task_id = ${task.id} AND state = 'open'`
        if ((open?.n ?? 0) === 0) assert.notStrictEqual((yield* queries.card(task.id)).phase, 'waiting')
        assert.strictEqual(yield* waitingOnDrafts, 0)
        const prompts = yield* until(
          turns(task.threadId),
          (all) =>
            all.some((turn) => turn.prompt?.includes('MER-1') === true) && all.some((turn) => turn.prompt?.includes('discarded') === true),
        )
        const heard = prompts.map((turn) => turn.prompt ?? '').join('\n')
        assert.include(
          heard,
          `The person filed your issue “Refunds skip the limiter” on Linear, in Meridian, as MER-1: ${filed.issue?.url}`,
        )
        assert.include(heard, 'The person discarded your issue “Checkout logs no request ids”: nothing was filed')
        // The coordinator doesn't hear of the lead's issues as if it had drafted them.
        assert.notInclude((yield* coordinatorNews(task.threadId, projectId, yield* modelNamer)) ?? '', 'Refunds skip the limiter')
        assert.notInclude(
          (yield* coordinatorNews((yield* project(repository())).threadId, projectId, yield* modelNamer)) ?? '',
          'Refunds skip the limiter',
        )
      }).pipe(Effect.provide(withQueries({ linear })))
    })

    /** What Althar has queued for a thread to read, quietly, as the lead will when it is resumed. */
    const queuedFor = (threadId: string) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{
          body: string
        }>`SELECT body FROM user_inputs WHERE thread_id = ${threadId} AND state = 'queued' ORDER BY sequence`
        return rows.map((row) => row.body).join('\n')
      })

    it.live('are told to a lead that isn’t running: its outcome waits in the queue for when it is resumed', () => {
      const linear = linearWith(MERIDIAN)
      return Effect.gen(function* () {
        yield* connect('linear')
        const drafts = yield* IssueDrafts
        const instance = yield* Instance
        const { task, lead } = yield* led('Add a retry')
        yield* callTool(lead, 'draft_issue', { title: 'Refunds skip the limiter' })
        // The person stops the lead, then files the card.
        yield* (yield* Sessions).stop(task.threadId)
        const [card] = yield* cardsIn(task.threadId)
        const filed = yield* drafts.file(card?.draftId ?? '', instance.personId)
        assert.strictEqual(filed.issue?.key, 'MER-1')
        assert.include(
          yield* queuedFor(task.threadId),
          `The person filed your issue “Refunds skip the limiter” on Linear, in Meridian, as MER-1: ${filed.issue?.url}`,
        )
      }).pipe(Effect.provide(withQueries({ linear })))
    })

    it.live('discarded after a filing ended unsure aren’t said to be nowhere: the issue may be on the tracker', () => {
      const linear = linearWith(MERIDIAN)
      return Effect.gen(function* () {
        yield* connect('linear')
        const drafts = yield* IssueDrafts
        const instance = yield* Instance
        const { task, lead } = yield* led('Add a retry')
        yield* callTool(lead, 'draft_issue', { title: 'Doubted' })
        yield* callTool(lead, 'draft_issue', { title: 'Refused' })
        const [doubted, refused] = yield* cardsIn(task.threadId)
        yield* (yield* Sessions).stop(task.threadId)
        // One whose answer was lost, one the tracker plainly refused.
        linear.failNext('create', 'invalid_response')
        yield* drafts.file(doubted?.draftId ?? '', instance.personId)
        linear.failNext('create', 'rejected')
        yield* drafts.file(refused?.draftId ?? '', instance.personId)
        yield* drafts.discard(doubted?.draftId ?? '', instance.personId)
        yield* drafts.discard(refused?.draftId ?? '', instance.personId)
        const heard = yield* queuedFor(task.threadId)
        assert.include(
          heard,
          'The person discarded your issue “Doubted” in Althar, but an attempt to file it ended unsure, so it may be on Linear, in Meridian, all the same.',
        )
        assert.include(heard, 'The person discarded your issue “Refused”: nothing was filed')
        assert.notInclude(heard, '“Doubted”: nothing was filed')
      }).pipe(Effect.provide(withQueries({ linear })))
    })

    it.live('go beside the issue the task came from, unless the lead names a place', () => {
      const linear = linearWith(MERIDIAN, PLATFORM)
      linear.addIssue({ ref: 'PLT-7', title: 'Queue stalls' })
      return Effect.gen(function* () {
        yield* connect('linear')
        const { projectId, task, lead } = yield* led('Unstall the queue')
        // With two teams and no issue behind the task, the lead is asked where.
        assert.match(yield* callTool(lead, 'draft_issue', { title: 'Too early' }), /^Say where on Linear it goes, as container: /)
        yield* (yield* Issues).attach({ projectId: projectId as ProjectId, taskId: task.id, issue: 'PLT-7' })
        assert.match(yield* callTool(lead, 'draft_issue', { title: 'Retries are unbounded' }), /in Platform\./)
        assert.match(yield* callTool(lead, 'draft_issue', { title: 'Dashboards are slow', container: 'MER' }), /in Meridian\./)
        // A lead on a review of someone else's pull request has no such tool.
        const reviewing = yield* callTool({ ...lead, role: 'reviewer' }, 'draft_issue', { title: 'Nope' })
        assert.notMatch(reviewing, /^Drafted/)
      }).pipe(Effect.provide(withQueries({ linear })))
    })
  })
})
