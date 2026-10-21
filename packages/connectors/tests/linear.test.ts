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

  describe('changing an issue', () => {
    const found = {
      id: 'uuid-231',
      ref: 'MER-231',
      key: 'MER-231',
      title: 'Rate-limit refunds like charges',
      body: '',
      url: 'https://linear.app/meridian/issue/MER-231',
      status: { name: 'In Progress', category: 'started' as const },
      priority: { level: 'high' as const, name: 'High' },
      assignees: [],
      labels: ['payments'],
      container: 'Meridian',
      updatedAt: '2026-10-01T08:00:00.000Z',
    }
    const queryOf = (request: { readonly body: unknown }) => String((request.body as { query: string }).query)
    const team = (items: ReadonlyArray<Record<string, unknown>>) => ({
      json: { data: { issue: { team: { id: 'team-mer', items: { nodes: items } } } } },
    })
    const states = [
      { id: 'state-done', name: 'Done', type: 'completed', position: 4 },
      { id: 'state-todo', name: 'Todo', type: 'unstarted', position: 1 },
      { id: 'state-review', name: 'In Review', type: 'started', position: 3 },
      { id: 'state-progress', name: 'In Progress', type: 'started', position: 2 },
      { id: 'state-shipped', name: 'Shipped', type: 'completed', position: 5 },
    ]

    it('says it changes every field the model has', () => {
      const { tracker } = linear([])
      assert.deepStrictEqual(tracker.capabilities.changes, ['status', 'close', 'priority', 'assignee', 'labels', 'project', 'title'])
    })

    it.effect('lists its team’s states in their order on the board, its people still active, its projects and its labels', () =>
      Effect.gen(function* () {
        const { tracker, sent } = linear([
          [
            'POST',
            URL,
            (request) =>
              queryOf(request).includes('issueLabels')
                ? {
                    json: {
                      data: {
                        issueLabels: {
                          nodes: [
                            { id: 'label-bug', name: 'Bug' },
                            { id: 'label-area', name: 'Area', isGroup: true },
                          ],
                          pageInfo: { hasNextPage: false },
                        },
                      },
                    },
                  }
                : queryOf(request).includes('states(')
                  ? team(states)
                  : queryOf(request).includes('members(')
                    ? team([
                        { id: 'u1', name: 'You Person', displayName: 'you', email: 'you@meridian.dev', active: true },
                        { id: 'u2', name: 'Gone Person', displayName: 'gone', active: false },
                      ])
                    : team([{ id: 'project-q4', name: 'Q4 launch' }]),
          ],
        ])
        assert.deepStrictEqual(
          (yield* tracker.choices(found, 'status')).map((one) => one.name),
          ['Todo', 'In Progress', 'In Review', 'Done', 'Shipped'],
        )
        assert.deepStrictEqual(yield* tracker.choices(found, 'assignee'), [
          { id: 'u1', name: 'You Person', also: ['you', 'you@meridian.dev'] },
        ])
        assert.deepStrictEqual(yield* tracker.choices(found, 'project'), [{ id: 'project-q4', name: 'Q4 launch' }])
        // Its team's labels and the workspace's: a group holds labels, and takes none.
        assert.deepStrictEqual(yield* tracker.choices(found, 'labels'), [{ id: 'label-bug', name: 'Bug' }])
        assert.deepStrictEqual(variablesOf(sent[0]), { id: 'uuid-231' })
        assert.deepStrictEqual(variablesOf(sent.at(-1)), { teamId: 'team-mer', after: null })
      }),
    )

    it.effect('changes every field at once, by Linear’s own ids, and reads the issue as Linear answers', () =>
      Effect.gen(function* () {
        const { tracker, sent } = linear([
          [
            'POST',
            URL,
            {
              json: {
                data: {
                  issueUpdate: {
                    success: true,
                    issue: issue({
                      state: { name: 'In Review', type: 'started' },
                      priority: 4,
                      priorityLabel: 'Low',
                      title: 'Refunds, rate-limited',
                    }),
                  },
                },
              },
            },
          ],
        ])
        const changed = yield* tracker.update(found, {
          status: { id: 'state-review', name: 'In Review' },
          priority: 'low',
          assignee: null,
          labels: { add: [{ id: 'label-bug', name: 'Bug' }], remove: [{ id: 'label-payments', name: 'payments' }] },
          project: { id: 'project-q4', name: 'Q4 launch' },
          title: 'Refunds, rate-limited',
        })
        assert.deepStrictEqual(
          [changed.status, changed.priority, changed.title],
          [{ name: 'In Review', category: 'started' }, { level: 'low', name: 'Low' }, 'Refunds, rate-limited'],
        )
        assert.lengthOf(sent, 1)
        assert.deepStrictEqual(variablesOf(sent[0]), {
          id: 'uuid-231',
          input: {
            title: 'Refunds, rate-limited',
            stateId: 'state-review',
            priority: 4,
            assigneeId: null,
            projectId: 'project-q4',
            addedLabelIds: ['label-bug'],
            removedLabelIds: ['label-payments'],
          },
        })
      }),
    )

    it.effect('closes it into its team’s first completed state on the board, and takes no priority as 0', () =>
      Effect.gen(function* () {
        const { tracker, sent } = linear([
          [
            'POST',
            URL,
            (request) =>
              queryOf(request).includes('states(')
                ? team(states)
                : { json: { data: { issueUpdate: { success: true, issue: issue({ state: { name: 'Done', type: 'completed' } }) } } } },
          ],
        ])
        const closed = yield* tracker.update(found, { close: true, priority: 'none' })
        assert.deepStrictEqual(closed.status, { name: 'Done', category: 'done' })
        assert.deepStrictEqual(variablesOf(sent[1]), { id: 'uuid-231', input: { stateId: 'state-done', priority: 0 } })
      }),
    )

    it.effect('reads it again where Linear changed it without saying how it stands, and fails where it didn’t change it', () =>
      Effect.gen(function* () {
        const { tracker, sent } = linear([
          [
            'POST',
            URL,
            (request) =>
              queryOf(request).includes('issueUpdate')
                ? { json: { data: { issueUpdate: { success: true, issue: null } } } }
                : { json: { data: { issue: issue({ title: 'Retitled' }) } } },
          ],
        ])
        assert.strictEqual((yield* tracker.update(found, { title: 'Retitled' })).title, 'Retitled')
        assert.deepStrictEqual(variablesOf(sent[1]), { id: 'MER-231' })
        const refusing = linear([['POST', URL, { json: { data: { issueUpdate: { success: false } } } }]])
        const refused = yield* Effect.flip(refusing.tracker.update(found, { title: 'Retitled' }))
        assert.deepStrictEqual([refused.reason, refused.message], ['rejected', 'Linear did not change it'])
        // A team with no completed state has nowhere to close it into: nothing is changed.
        const open = linear([['POST', URL, team(states.filter((state) => state.type !== 'completed'))]])
        assert.strictEqual((yield* Effect.flip(open.tracker.update(found, { close: true }))).message, 'Its team has no completed state')
        assert.lengthOf(open.sent, 1)
      }),
    )
  })

  it.effect('files an issue with a priority, as Linear numbers it, and none for no priority', () =>
    Effect.gen(function* () {
      const { tracker, sent } = linear([
        ['POST', URL, { json: { data: { issueCreate: { success: true, issue: issue({ priority: 4, priorityLabel: 'Low' }) } } } }],
      ])
      const filed = yield* tracker.create('team-mer', { title: 'A title', body: '', labels: [], priority: 'low' })
      assert.deepStrictEqual(filed.priority, { level: 'low', name: 'Low' })
      assert.deepStrictEqual(variablesOf(sent[0]), { input: { teamId: 'team-mer', title: 'A title', description: '', priority: 4 } })
      yield* tracker.create('team-mer', { title: 'A title', body: '', labels: [], priority: 'none' })
      assert.deepStrictEqual(variablesOf(sent[1]), { input: { teamId: 'team-mer', title: 'A title', description: '' } })
    }),
  )
})
