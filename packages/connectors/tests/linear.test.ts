import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import type { Credential } from '../src/credential'
import { categoryOf, makeLinear } from '../src/linear'
import { type Route, stubFetch, variablesOf } from './stub'

const URL = 'https://api.linear.app/graphql'

const linear = (routes: ReadonlyArray<Route>, credential: Credential = { kind: 'key', token: 'lin_api_k' }) => {
  const { fetch, sent } = stubFetch(routes)
  return {
    tracker: makeLinear({ fetch, apiUrl: 'https://api.linear.app/', webUrl: 'https://linear.app', credential: Effect.succeed(credential) }),
    sent,
  }
}

const issue = (overrides: Record<string, unknown> = {}) => ({
  id: 'uuid-231',
  identifier: 'MER-231',
  title: 'Rate-limit refunds like charges',
  description: 'Refunds skip the limiter.',
  url: 'https://linear.app/meridian/issue/MER-231/rate-limit-refunds',
  priority: 2,
  priorityLabel: 'High',
  updatedAt: '2026-10-01T08:00:00.000Z',
  state: { name: 'In Progress', type: 'started' },
  assignee: { id: 'u1', name: 'You Person', displayName: 'you' },
  labels: { nodes: [{ name: 'payments' }] },
  team: { key: 'MER', name: 'Meridian' },
  ...overrides,
})

describe('Linear', () => {
  it('reads a state’s type as a category', () => {
    assert.deepStrictEqual(['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled', 'other'].map(categoryOf), [
      'triage',
      'backlog',
      'todo',
      'started',
      'done',
      'cancelled',
      'todo',
    ])
  })

  it.effect('sends a personal key as it is, and an OAuth token as a bearer', () =>
    Effect.gen(function* () {
      const viewer: Route = ['POST', URL, { json: { data: { viewer: { id: 'u1', name: 'You Person', displayName: 'you' } } } }]
      const key = linear([viewer])
      assert.deepStrictEqual(yield* key.tracker.account, { id: 'u1', login: 'you', name: 'You Person' })
      assert.strictEqual(key.sent[0]?.headers.authorization, 'lin_api_k')
      const oauth = linear([['POST', URL, { json: { data: { viewer: { id: 'u1', name: 'You Person' } } } }]], {
        kind: 'bearer',
        token: 'oauth',
      })
      assert.strictEqual((yield* oauth.tracker.account).login, 'You Person')
      assert.strictEqual(oauth.sent[0]?.headers.authorization, 'Bearer oauth')
    }),
  )

  it.effect('reads an issue by its identifier, in any case', () =>
    Effect.gen(function* () {
      const { tracker, sent } = linear([['POST', URL, { json: { data: { issue: issue() } } }]])
      assert.deepStrictEqual(yield* tracker.issue('MER-231'), {
        id: 'uuid-231',
        ref: 'MER-231',
        key: 'MER-231',
        title: 'Rate-limit refunds like charges',
        body: 'Refunds skip the limiter.',
        url: 'https://linear.app/meridian/issue/MER-231/rate-limit-refunds',
        status: { name: 'In Progress', category: 'started' },
        priority: { level: 'high', name: 'High' },
        assignees: [{ id: 'u1', login: 'you', name: 'You Person', bot: false }],
        labels: ['payments'],
        container: 'Meridian',
        updatedAt: '2026-10-01T08:00:00.000Z',
      })
      assert.deepStrictEqual(variablesOf(sent[0]), { id: 'MER-231' })
      // A key as typed is Linear's own, upper-cased; anything else, such as a UUID, goes as it is.
      yield* tracker.issue('mer-231')
      yield* tracker.issue('5f1c2b3a-6d4e-4f00-8a11-0000000000e7')
      assert.deepStrictEqual(sent.slice(1).map(variablesOf), [{ id: 'MER-231' }, { id: '5f1c2b3a-6d4e-4f00-8a11-0000000000e7' }])
    }),
  )

  it.effect('reads an issue with little filled in', () =>
    Effect.gen(function* () {
      const { tracker } = linear([
        [
          'POST',
          URL,
          {
            json: {
              data: {
                issue: issue({
                  description: null,
                  priority: null,
                  priorityLabel: null,
                  state: null,
                  assignee: null,
                  labels: undefined,
                  team: null,
                }),
              },
            },
          },
        ],
      ])
      const bare = yield* tracker.issue('MER-231')
      assert.deepStrictEqual(
        [bare.body, bare.status, bare.priority, bare.assignees, bare.labels, bare.container],
        ['', { name: 'Todo', category: 'todo' }, { level: 'none', name: 'No priority' }, [], [], null],
      )
    }),
  )

  it.effect('lists the account’s open issues', () =>
    Effect.gen(function* () {
      const { tracker, sent } = linear([
        [
          'POST',
          URL,
          {
            json: {
              data: {
                viewer: { assignedIssues: { nodes: [issue(), issue({ identifier: 'MER-232', priority: 4, priorityLabel: 'Low' })] } },
              },
            },
          },
        ],
      ])
      const mine = yield* tracker.mine({ limit: 5 })
      assert.deepStrictEqual(
        mine.map((found) => [found.key, found.priority?.level]),
        [
          ['MER-231', 'high'],
          ['MER-232', 'low'],
        ],
      )
      assert.deepStrictEqual(variablesOf(sent[0]), { first: 5 })
      yield* tracker.mine()
      assert.deepStrictEqual(variablesOf(sent[1]), { first: 50 })
    }),
  )

  it.effect('comments on an issue and links a pull request to it', () =>
    Effect.gen(function* () {
      const { tracker, sent } = linear([
        [
          'POST',
          URL,
          (request) => ({
            json: {
              data: String((request.body as { query: string }).query).includes('commentCreate')
                ? { commentCreate: { success: true } }
                : { attachmentLinkURL: { success: true } },
            },
          }),
        ],
      ])
      const found = {
        id: 'uuid-231',
        ref: 'MER-231',
        key: 'MER-231',
        title: 't',
        body: '',
        url: '',
        status: { name: 'Todo', category: 'todo' as const },
        priority: null,
        assignees: [],
        labels: [],
        container: null,
        updatedAt: '',
      }
      yield* tracker.comment(found, 'Picked up')
      yield* tracker.link(found, { url: 'https://github.com/meridian/api/pull/12', title: 'PR #12' })
      assert.deepStrictEqual(sent.map(variablesOf), [
        { issueId: 'uuid-231', body: 'Picked up' },
        { issueId: 'uuid-231', url: 'https://github.com/meridian/api/pull/12', title: 'PR #12' },
      ])
      assert.isTrue(tracker.capabilities.links)
    }),
  )

  describe('moving an issue to In Progress', () => {
    const todo = {
      id: 'uuid-231',
      ref: 'MER-231',
      key: 'MER-231',
      title: 't',
      body: '',
      url: '',
      status: { name: 'Todo', category: 'todo' as const },
      priority: null,
      assignees: [],
      labels: [],
      container: null,
      updatedAt: '',
    }
    const states = [
      { id: 's-review', name: 'In Review', type: 'started', position: 3 },
      { id: 's-todo', name: 'Todo', type: 'unstarted', position: 1 },
      { id: 's-progress', name: 'In Progress', type: 'started', position: 2 },
      { id: 's-done', name: 'Done', type: 'completed', position: 4 },
    ]
    const board = (nodes: ReadonlyArray<unknown>, updated: unknown = { issueUpdate: { success: true } }): Route => [
      'POST',
      URL,
      (request) => ({
        json: {
          data: String((request.body as { query: string }).query).includes('issueUpdate')
            ? updated
            : { issue: { team: { states: { nodes } } } },
        },
      }),
    ]

    it.effect('moves it into its team’s first started state on the board, not one further along', () =>
      Effect.gen(function* () {
        const { tracker, sent } = linear([board(states)])
        assert.deepStrictEqual(yield* tracker.start(todo), { moved: true, status: { name: 'In Progress', category: 'started' } })
        assert.deepStrictEqual(sent.map(variablesOf), [{ id: 'uuid-231' }, { id: 'uuid-231', stateId: 's-progress' }])
        assert.isTrue(tracker.capabilities.starts)
      }),
    )

    it.effect('moves one from triage or the backlog too', () =>
      Effect.gen(function* () {
        for (const category of ['triage', 'backlog'] as const) {
          const { tracker } = linear([board(states)])
          assert.isTrue((yield* tracker.start({ ...todo, status: { name: category, category } })).moved)
        }
      }),
    )

    it.effect('leaves one started, done or cancelled as it is, asking Linear nothing', () =>
      Effect.gen(function* () {
        const { tracker, sent } = linear([board(states)])
        for (const status of [
          { name: 'In Review', category: 'started' as const },
          { name: 'Done', category: 'done' as const },
          { name: 'Canceled', category: 'cancelled' as const },
        ]) {
          assert.deepStrictEqual(yield* tracker.start({ ...todo, status }), { moved: false, status })
        }
        assert.lengthOf(sent, 0)
      }),
    )

    it.effect('fails when its team has no started state, or Linear doesn’t move it, or refuses', () =>
      Effect.gen(function* () {
        const none = linear([board(states.filter((state) => state.type !== 'started'))])
        const stateless = yield* Effect.flip(none.tracker.start(todo))
        assert.deepStrictEqual([stateless.reason, stateless.message], ['rejected', 'Its team has no started state'])
        assert.lengthOf(none.sent, 1)
        const unmoved = yield* Effect.flip(linear([board(states, { issueUpdate: { success: false } })]).tracker.start(todo))
        assert.strictEqual(unmoved.reason, 'rejected')
        const refused = yield* Effect.flip(
          linear([
            ['POST', URL, { status: 400, json: { errors: [{ message: 'You don’t have access', extensions: { code: 'FORBIDDEN' } }] } }],
          ]).tracker.start(todo),
        )
        assert.deepStrictEqual([refused.reason, refused.message], ['forbidden', 'You don’t have access'])
      }),
    )
  })

  it.effect('says when the key is no longer good', () =>
    Effect.gen(function* () {
      const { tracker } = linear([
        [
          'POST',
          URL,
          {
            status: 400,
            json: { errors: [{ message: 'Authentication required, not authenticated', extensions: { code: 'AUTHENTICATION_ERROR' } }] },
          },
        ],
      ])
      assert.strictEqual((yield* Effect.flip(tracker.issue('MER-1'))).reason, 'unauthorized')
    }),
  )
  it.effect('lists the teams an issue can be filed in', () =>
    Effect.gen(function* () {
      const { tracker, sent } = linear([
        [
          'POST',
          URL,
          {
            json: {
              data: {
                teams: {
                  nodes: [
                    { id: 'team-mer', key: 'MER', name: 'Meridian' },
                    { id: 'team-pay', key: 'PAY', name: 'Payments' },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: 'cursor-pay' },
                },
              },
            },
          },
        ],
      ])
      assert.deepStrictEqual(yield* tracker.containers(), [
        { id: 'team-mer', key: 'MER', name: 'Meridian' },
        { id: 'team-pay', key: 'PAY', name: 'Payments' },
      ])
      assert.include(JSON.stringify(sent[0]?.body), 'teams(first: 100, after: $after)')
      assert.deepStrictEqual(variablesOf(sent[0]), { after: null })
      assert.lengthOf(sent, 1)
    }),
  )

  it.effect('follows the teams page after page, by the cursor after each, while Linear says there are more', () =>
    Effect.gen(function* () {
      const { tracker, sent } = linear([
        [
          'POST',
          URL,
          (request) => ({
            json: {
              data: {
                teams:
                  (variablesOf(request) as { after: string | null }).after === null
                    ? {
                        nodes: [{ id: 'team-mer', key: 'MER', name: 'Meridian' }],
                        pageInfo: { hasNextPage: true, endCursor: 'cursor-mer' },
                      }
                    : { nodes: [{ id: 'team-pay', key: 'PAY', name: 'Payments' }], pageInfo: { hasNextPage: false, endCursor: null } },
              },
            },
          }),
        ],
      ])
      assert.deepStrictEqual(
        (yield* tracker.containers()).map((team) => team.key),
        ['MER', 'PAY'],
      )
      assert.deepStrictEqual(sent.map(variablesOf), [{ after: null }, { after: 'cursor-mer' }])
    }),
  )

  it.effect('files an issue in a team, with the labels it has by those names, in any case', () =>
    Effect.gen(function* () {
      const { tracker, sent } = linear([
        [
          'POST',
          URL,
          (request) => ({
            json: {
              data: String((request.body as { query: string }).query).includes('issueLabels')
                ? {
                    issueLabels: {
                      nodes: [
                        { id: 'label-payments', name: 'Payments', isGroup: false },
                        { id: 'label-payments-again', name: 'payments' },
                        { id: 'label-area', name: 'Area', isGroup: true },
                        { id: 'label-bug', name: 'Bug' },
                      ],
                      pageInfo: { hasNextPage: false },
                    },
                  }
                : { issueCreate: { success: true, issue: issue({ assignee: null, labels: { nodes: [{ name: 'Payments' }] } }) } },
            },
          }),
        ],
      ])
      const filed = yield* tracker.create('team-mer', {
        title: 'Rate-limit refunds like charges',
        body: 'Refunds skip the limiter.',
        labels: ['payments', 'area', 'Nonesuch', 'PAYMENTS'],
      })
      assert.deepStrictEqual([filed.key, filed.labels, filed.assignees], ['MER-231', ['Payments'], []])
      assert.deepStrictEqual(variablesOf(sent[0]), { teamId: 'team-mer', after: null })
      // A name with no label, or only a group's, is left off; a name asked twice is one label.
      assert.deepStrictEqual(variablesOf(sent[1]), {
        input: {
          teamId: 'team-mer',
          title: 'Rate-limit refunds like charges',
          description: 'Refunds skip the limiter.',
          labelIds: ['label-payments'],
        },
      })
    }),
  )

  it.effect('files an issue without asking for labels when it has none, and says when Linear doesn’t file it', () =>
    Effect.gen(function* () {
      const { tracker, sent } = linear([['POST', URL, { json: { data: { issueCreate: { success: false, issue: null } } } }]])
      const refused = yield* Effect.flip(tracker.create('team-mer', { title: 'A title', body: '', labels: [] }))
      assert.deepStrictEqual([refused.reason, refused.message], ['rejected', 'Linear did not file the issue'])
      assert.lengthOf(sent, 1)
      // Filed by Linear's word, without saying which: unreadable, never refused; and an internal error mid-mutation is no refusal either.
      const unsaid = linear([['POST', URL, { json: { data: { issueCreate: { success: true, issue: null } } } }]])
      const lost = yield* Effect.flip(unsaid.tracker.create('team-mer', { title: 'A title', body: '', labels: [] }))
      assert.deepStrictEqual([lost.reason, lost.message], ['invalid_response', 'Linear filed the issue without saying which'])
      const omitted = linear([['POST', URL, { json: { data: { issueCreate: { success: true } } } }]])
      assert.strictEqual(
        (yield* Effect.flip(omitted.tracker.create('team-mer', { title: 'A title', body: '', labels: [] }))).reason,
        'invalid_response',
      )
      const internal = linear([['POST', URL, { status: 500, json: { errors: [{ message: 'Internal error' }] } }]])
      assert.strictEqual(
        (yield* Effect.flip(internal.tracker.create('team-mer', { title: 'A title', body: '', labels: [] }))).reason,
        'unreachable',
      )
      assert.deepStrictEqual(variablesOf(sent[0]), { input: { teamId: 'team-mer', title: 'A title', description: '' } })
      // Labels asked for that the team has none of: the issue is filed with none.
      const bare = linear([
        [
          'POST',
          URL,
          (request) => ({
            json: {
              data: String((request.body as { query: string }).query).includes('issueLabels')
                ? { issueLabels: { nodes: [], pageInfo: { hasNextPage: false } } }
                : { issueCreate: { success: true, issue: issue() } },
            },
          }),
        ],
      ])
      yield* bare.tracker.create('team-mer', { title: 'A title', body: '', labels: ['nonesuch'] })
      assert.deepStrictEqual(variablesOf(bare.sent[1]), { input: { teamId: 'team-mer', title: 'A title', description: '' } })
    }),
  )

  it.effect('reads a team’s labels page after page before it files, and files nothing when they can’t be read', () =>
    Effect.gen(function* () {
      const { tracker, sent } = linear([
        [
          'POST',
          URL,
          (request) => {
            const query = String((request.body as { query: string }).query)
            const after = (variablesOf(request) as { after?: string | null }).after
            return {
              json: {
                data: !query.includes('issueLabels')
                  ? { issueCreate: { success: true, issue: issue() } }
                  : after === null
                    ? {
                        issueLabels: {
                          nodes: [{ id: 'label-bug', name: 'Bug' }],
                          pageInfo: { hasNextPage: true, endCursor: 'cursor-bug' },
                        },
                      }
                    : {
                        issueLabels: {
                          nodes: [{ id: 'label-payments', name: 'Payments' }],
                          pageInfo: { hasNextPage: false, endCursor: null },
                        },
                      },
              },
            }
          },
        ],
      ])
      yield* tracker.create('team-mer', { title: 'A title', body: '', labels: ['payments'] })
      assert.deepStrictEqual(variablesOf(sent[1]), { teamId: 'team-mer', after: 'cursor-bug' })
      assert.deepStrictEqual(variablesOf(sent[2]), {
        input: { teamId: 'team-mer', title: 'A title', description: '', labelIds: ['label-payments'] },
      })
      const failing = linear([['POST', URL, { status: 500, json: { errors: [{ message: 'Internal error' }] } }]])
      yield* Effect.flip(failing.tracker.create('team-mer', { title: 'A title', body: '', labels: ['payments'] }))
      assert.lengthOf(failing.sent, 1)
    }),
  )
})
