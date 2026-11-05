import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import type { Credential } from '../src/credential'
import { categoryOf, filterOf, makeLinear } from '../src/linear'
import type { IssueQuery } from '../src/model'
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

const organization = { name: 'Meridian', urlKey: 'meridian' }

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
      const viewer: Route = [
        'POST',
        URL,
        { json: { data: { viewer: { id: 'u1', name: 'You Person', displayName: 'you' }, organization } } },
      ]
      const key = linear([viewer])
      assert.deepStrictEqual(yield* key.tracker.account, {
        id: 'u1',
        login: 'you',
        name: 'You Person',
        workspace: { key: 'meridian', name: 'Meridian' },
      })
      assert.strictEqual(key.sent[0]?.headers.authorization, 'lin_api_k')
      const oauth = linear([['POST', URL, { json: { data: { viewer: { id: 'u1', name: 'You Person' }, organization } } }]], {
        kind: 'bearer',
        token: 'oauth',
      })
      assert.strictEqual((yield* oauth.tracker.account).login, 'You Person')
      assert.strictEqual(oauth.sent[0]?.headers.authorization, 'Bearer oauth')
    }),
  )

  it.effect('reads the one workspace a token reaches, by the key its links carry', () =>
    Effect.gen(function* () {
      const fnt = linear([
        [
          'POST',
          URL,
          { json: { data: { viewer: { id: 'u9', name: 'Mate', displayName: 'mate' }, organization: { name: 'FNT', urlKey: 'fnt' } } } },
        ],
      ])
      assert.deepStrictEqual((yield* fnt.tracker.account).workspace, { key: 'fnt', name: 'FNT' })
      assert.match(JSON.stringify(fnt.sent[0]?.body), /organization \{ name urlKey \}/)
      // An answer without its workspace isn't one Althar can tell apart from another's.
      const bare = linear([['POST', URL, { json: { data: { viewer: { id: 'u9', name: 'Mate' } } } }]])
      assert.strictEqual((yield* Effect.flip(bare.tracker.account)).reason, 'invalid_response')
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
        project: null,
        milestone: null,
        cycle: null,
        parent: null,
        due: null,
        estimate: null,
      })
      assert.deepStrictEqual(variablesOf(sent[0]), { id: 'MER-231' })
      // A key as typed is Linear's own, upper-cased; anything else, such as a UUID, goes as it is.
      yield* tracker.issue('mer-231')
      yield* tracker.issue('5f1c2b3a-6d4e-4f00-8a11-0000000000e7')
      assert.deepStrictEqual(sent.slice(1).map(variablesOf), [{ id: 'MER-231' }, { id: '5f1c2b3a-6d4e-4f00-8a11-0000000000e7' }])
    }),
  )

  it.effect('reads its project, milestone, cycle, parent, due day and estimate, and no type or components', () =>
    Effect.gen(function* () {
      const { tracker, sent } = linear([
        [
          'POST',
          URL,
          {
            json: {
              data: {
                issue: issue({
                  project: { id: 'project-q4', name: 'Q4 launch' },
                  projectMilestone: { id: 'milestone-beta', name: 'Beta' },
                  cycle: { number: 42, name: 'Hardening' },
                  parent: { identifier: 'MER-200', title: 'Refunds' },
                  dueDate: '2026-11-30',
                  estimate: 3,
                }),
              },
            },
          },
        ],
      ])
      const read = yield* tracker.issue('MER-231')
      assert.deepInclude(read, {
        project: { id: 'project-q4', name: 'Q4 launch' },
        milestone: { id: 'milestone-beta', name: 'Beta' },
        cycle: 'Hardening',
        parent: { key: 'MER-200', title: 'Refunds' },
        due: '2026-11-30',
        estimate: 3,
      })
      // Linear has neither: absent, not none.
      assert.isFalse('type' in read || 'components' in read)
      assert.match(
        JSON.stringify(sent[0]?.body),
        /project \{ id name \} projectMilestone \{ id name \} cycle \{ number name \} parent \{ identifier title \} dueDate estimate/,
      )
      // A cycle without a name goes by its number.
      const unnamed = linear([['POST', URL, { json: { data: { issue: issue({ cycle: { number: 43, name: null } }) } } }]])
      assert.strictEqual((yield* unnamed.tracker.issue('MER-231')).cycle, 'Cycle 43')
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
      assert.deepStrictEqual(
        [bare.project, bare.milestone, bare.cycle, bare.parent, bare.due, bare.estimate],
        [null, null, null, null, null, null],
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

  it.effect('finds issues as a query narrows them, newest change first', () =>
    Effect.gen(function* () {
      const { tracker, sent } = linear([
        [
          'POST',
          URL,
          {
            json: {
              data: {
                issues: {
                  nodes: [issue(), issue({ identifier: 'MER-232', assignee: null, state: { name: 'Done', type: 'completed' } })],
                  pageInfo: { hasNextPage: false, endCursor: 'c2' },
                },
              },
            },
          },
        ],
      ])
      const found = yield* tracker.find({ text: ' refunds ', container: 'team-mer', state: 'open', mine: true, limit: 10 })
      assert.deepStrictEqual(
        found.issues.map((one) => [one.key, one.status.category, one.assignees.length]),
        [
          ['MER-231', 'started', 1],
          ['MER-232', 'done', 0],
        ],
      )
      assert.isNull(found.next)
      assert.match(
        JSON.stringify(sent[0]?.body),
        /issues\(first: \$first, after: \$after, orderBy: updatedAt, filter: \$filter\) \{ nodes \{ \.\.\.IssueFields \} pageInfo \{ hasNextPage endCursor \} \}/,
      )
      assert.deepStrictEqual(variablesOf(sent[0]), {
        first: 10,
        filter: {
          and: [
            { team: { id: { eq: 'team-mer' } } },
            { state: { type: { nin: ['completed', 'canceled'] } } },
            { assignee: { isMe: { eq: true } } },
            { or: [{ title: { containsIgnoreCase: 'refunds' } }, { description: { containsIgnoreCase: 'refunds' } }] },
          ],
        },
      })
      // Closed is done or cancelled; all, whoever has it, anywhere, narrows nothing; and a page is held to Linear's most.
      yield* tracker.find({ state: 'closed', limit: 5 })
      yield* tracker.find({ text: '  ', state: 'all', mine: false, limit: 1000 })
      assert.deepStrictEqual(sent.slice(1).map(variablesOf), [
        { first: 5, filter: { and: [{ state: { type: { in: ['completed', 'canceled'] } } }] } },
        { first: 250, filter: {} },
      ])
    }),
  )

  it('narrows a search by each filter, as Linear’s IssueFilter takes it', () => {
    const narrowed = (query: Partial<IssueQuery>) => filterOf({ state: 'all', limit: 10, ...query })
    assert.deepStrictEqual(narrowed({ labels: ['payments', ' Bug '] }), {
      and: [{ labels: { some: { name: { eqIgnoreCase: 'payments' } } } }, { labels: { some: { name: { eqIgnoreCase: 'Bug' } } } }],
    })
    // A status by its name, or any of a category's: each category by its state type.
    assert.deepStrictEqual(
      narrowed({ status: { names: ['In Review'], categories: ['triage', 'backlog', 'todo', 'started', 'done', 'cancelled'] } }),
      {
        and: [
          {
            or: [
              { state: { name: { eqIgnoreCase: 'In Review' } } },
              { state: { type: { in: ['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled'] } } },
            ],
          },
        ],
      },
    )
    assert.deepStrictEqual(narrowed({ status: { names: ['In Review', 'QA'], categories: [] } }), {
      and: [{ or: [{ state: { name: { eqIgnoreCase: 'In Review' } } }, { state: { name: { eqIgnoreCase: 'QA' } } }] }],
    })
    assert.deepStrictEqual(narrowed({ status: { names: [], categories: [] } }), {})
    assert.deepStrictEqual(narrowed({ project: 'Q4 launch', milestone: 'Beta' }), {
      and: [{ project: { name: { eqIgnoreCase: 'Q4 launch' } } }, { projectMilestone: { name: { eqIgnoreCase: 'Beta' } } }],
    })
    // A cycle under way, by number, or by name.
    assert.deepStrictEqual(
      ['Current', '42', 'Hardening'].map((cycle) => narrowed({ cycle })),
      [
        { and: [{ cycle: { isActive: { eq: true } } }] },
        { and: [{ cycle: { number: { eq: 42 } } }] },
        { and: [{ cycle: { name: { eqIgnoreCase: 'Hardening' } } }] },
      ],
    )
    // Assigned to no one, or to someone by name, display name or email.
    assert.deepStrictEqual(narrowed({ assignee: null }), { and: [{ assignee: { null: true } }] })
    assert.deepStrictEqual(narrowed({ assignee: ' @ana ' }), {
      and: [
        {
          assignee: {
            or: [{ name: { containsIgnoreCase: 'ana' } }, { displayName: { eqIgnoreCase: 'ana' } }, { email: { eqIgnoreCase: 'ana' } }],
          },
        },
      ],
    })
    assert.deepStrictEqual(narrowed({ priority: ['urgent', 'low', 'none'] }), { and: [{ priority: { in: [1, 4, 0] } }] })
    assert.deepStrictEqual(narrowed({ parent: 'mer-200' }), {
      and: [{ parent: { team: { key: { eqIgnoreCase: 'MER' } }, number: { eq: 200 } } }],
    })
    // A day is from its start, in UTC.
    assert.deepStrictEqual(narrowed({ updatedSince: '2026-11-01' }), { and: [{ updatedAt: { gte: '2026-11-01T00:00:00.000Z' } }] })
    assert.deepStrictEqual(narrowed({ updatedSince: '2026-11-01T10:30:00+02:00' }), {
      and: [{ updatedAt: { gte: '2026-11-01T08:30:00.000Z' } }],
    })
    // Keys by their team's, each team's numbers together; one that isn't Linear's is left out.
    assert.deepStrictEqual(narrowed({ keys: ['MER-231', 'mer-232', 'OPS-7', '#12', 'MER-231'] }), {
      and: [
        {
          or: [
            { team: { key: { eqIgnoreCase: 'MER' } }, number: { in: [231, 232] } },
            { team: { key: { eqIgnoreCase: 'OPS' } }, number: { in: [7] } },
          ],
        },
      ],
    })
    // Nothing to find: no key Linear's, or a parent that isn't one.
    assert.isNull(narrowed({ keys: ['#12', 'abc123'] }))
    assert.isNull(narrowed({ parent: 'refunds' }))
    assert.deepStrictEqual(narrowed({ keys: [] }), {})
  })

  it.effect('reads on from where a page stopped, by Linear’s cursor', () =>
    Effect.gen(function* () {
      const { tracker, sent } = linear([
        [
          'POST',
          URL,
          (request) => ({
            json: {
              data: {
                issues:
                  (variablesOf(request) as { after?: string }).after === undefined
                    ? { nodes: [issue()], pageInfo: { hasNextPage: true, endCursor: 'cursor-1' } }
                    : { nodes: [issue({ identifier: 'MER-232' })], pageInfo: { hasNextPage: false, endCursor: 'cursor-2' } },
              },
            },
          }),
        ],
      ])
      const first = yield* tracker.find({ state: 'open', limit: 1 })
      assert.deepStrictEqual([first.issues.map((one) => one.key), first.next], [['MER-231'], 'cursor-1'])
      const second = yield* tracker.find({ state: 'open', limit: 1, cursor: 'cursor-1' })
      assert.deepStrictEqual([second.issues.map((one) => one.key), second.next], [['MER-232'], null])
      assert.deepInclude(variablesOf(sent[1]) as object, { first: 1, after: 'cursor-1' })
    }),
  )

  it.effect('finds nothing, unasked, by keys none of which is Linear’s, and refuses a parent that isn’t a key', () =>
    Effect.gen(function* () {
      const { tracker, sent } = linear([])
      assert.deepStrictEqual(yield* tracker.find({ state: 'all', keys: ['#12', 'meridian/api#3'], limit: 10 }), { issues: [], next: null })
      const refused = yield* Effect.flip(tracker.find({ state: 'all', parent: 'Refunds', limit: 10 }))
      assert.deepStrictEqual([refused.product, refused.reason], ['linear', 'rejected'])
      assert.match(refused.message, /Refunds/)
      assert.lengthOf(sent, 0)
    }),
  )

  it.effect('reads an issue’s latest comments, oldest first, by who wrote them', () =>
    Effect.gen(function* () {
      const { tracker, sent } = linear([
        [
          'POST',
          URL,
          {
            json: {
              data: {
                issue: {
                  comments: {
                    nodes: [
                      { body: 'Merged', createdAt: '2026-10-03T08:00:00.000Z', user: { id: 'u2', name: 'Ana Ruiz', displayName: 'ana' } },
                      { body: 'Linked a PR', createdAt: '2026-10-02T08:00:00.000Z', user: null },
                      { body: 'Picked up', createdAt: '2026-10-01T08:00:00.000Z', user: { id: 'u1', name: 'You Person' } },
                    ],
                  },
                },
              },
            },
          },
        ],
      ])
      const read = yield* tracker.comments(
        {
          id: 'uuid-231',
          ref: 'MER-231',
          key: 'MER-231',
          title: 't',
          body: '',
          url: '',
          status: { name: 'Todo', category: 'todo' },
          priority: null,
          assignees: [],
          labels: [],
          container: null,
          updatedAt: '',
        },
        3,
      )
      assert.deepStrictEqual(read, [
        { author: { id: 'u1', login: 'You Person', name: 'You Person', bot: false }, body: 'Picked up', at: '2026-10-01T08:00:00.000Z' },
        { author: null, body: 'Linked a PR', at: '2026-10-02T08:00:00.000Z' },
        { author: { id: 'u2', login: 'ana', name: 'Ana Ruiz', bot: false }, body: 'Merged', at: '2026-10-03T08:00:00.000Z' },
      ])
      assert.deepStrictEqual(variablesOf(sent[0]), { id: 'uuid-231', first: 3 })
      assert.match(JSON.stringify(sent[0]?.body), /comments\(first: \$first, orderBy: createdAt\)/)
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

  it.effect('refuses a comment or a link Linear says it didn’t take, never taking it as done', () =>
    Effect.gen(function* () {
      const { tracker } = linear([
        [
          'POST',
          URL,
          (request) => ({
            json: {
              data: String((request.body as { query: string }).query).includes('commentCreate')
                ? { commentCreate: { success: false } }
                : { attachmentLinkURL: { success: false } },
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
      const commented = yield* Effect.flip(tracker.comment(found, 'Picked up'))
      assert.deepInclude(commented, { reason: 'rejected', message: 'Linear did not post the comment' })
      const linked = yield* Effect.flip(tracker.link(found, { url: 'https://github.com/meridian/api/pull/12', title: 'PR #12' }))
      assert.deepInclude(linked, { reason: 'rejected', message: 'Linear did not link it' })
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
    const team = (items: ReadonlyArray<Record<string, unknown>>, next?: string) => ({
      json: {
        data: {
          issue: {
            team: {
              id: 'team-mer',
              items: { nodes: items, pageInfo: next === undefined ? { hasNextPage: false } : { hasNextPage: true, endCursor: next } },
            },
          },
        },
      },
    })
    const states = [
      { id: 'state-done', name: 'Done', type: 'completed', position: 4 },
      { id: 'state-todo', name: 'Todo', type: 'unstarted', position: 1 },
      { id: 'state-review', name: 'In Review', type: 'started', position: 3 },
      { id: 'state-progress', name: 'In Progress', type: 'started', position: 2 },
      { id: 'state-shipped', name: 'Shipped', type: 'completed', position: 5 },
    ]

    it('says it changes every field Linear has, files with most of them, and assigns an issue to one person', () => {
      const { tracker } = linear([])
      assert.deepStrictEqual(tracker.capabilities.changes, [
        'status',
        'close',
        'priority',
        'assignee',
        'labels',
        'project',
        'milestone',
        'cycle',
        'parent',
        'estimate',
        'due',
        'title',
        'description',
      ])
      assert.deepStrictEqual(tracker.capabilities.creates, [
        'status',
        'assignee',
        'project',
        'milestone',
        'cycle',
        'parent',
        'estimate',
        'due',
      ])
      assert.strictEqual(tracker.capabilities.assignees, 'one')
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
        assert.deepStrictEqual(variablesOf(sent[0]), { id: 'uuid-231', after: null })
        assert.deepStrictEqual(variablesOf(sent.at(-1)), { teamId: 'team-mer', after: null })
      }),
    )

    it.effect('reads its team’s people and projects page by page, so one past the first page is there', () =>
      Effect.gen(function* () {
        const { tracker, sent } = linear([
          [
            'POST',
            URL,
            (request) => {
              const after = (variablesOf(request) as { after?: string | null }).after ?? null
              if (queryOf(request).includes('members('))
                return after === null
                  ? team([{ id: 'u1', name: 'You Person', active: true }], 'cursor-1')
                  : team([{ id: 'u251', name: 'Ana Ruiz', displayName: 'ana', active: true }])
              return after === null ? team([{ id: 'project-q4', name: 'Q4 launch' }], 'cursor-1') : team([{ id: 'project-q5', name: 'Q5' }])
            },
          ],
        ])
        assert.deepStrictEqual(
          (yield* tracker.choices(found, 'assignee')).map((one) => one.name),
          ['You Person', 'Ana Ruiz'],
        )
        assert.deepStrictEqual(
          (yield* tracker.choices(found, 'project')).map((one) => one.name),
          ['Q4 launch', 'Q5'],
        )
        assert.deepStrictEqual(sent.map(variablesOf), [
          { id: 'uuid-231', after: null },
          { id: 'uuid-231', after: 'cursor-1' },
          { id: 'uuid-231', after: null },
          { id: 'uuid-231', after: 'cursor-1' },
        ])
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
          milestone: { id: 'milestone-beta', name: 'Beta', in: 'project-q4' },
          cycle: { id: 'cycle-42', name: 'Cycle 42' },
          parent: { id: 'uuid-200', ref: 'MER-200', key: 'MER-200' },
          estimate: 3,
          due: '2026-11-30',
          title: 'Refunds, rate-limited',
          description: 'Refunds go through the limiter.',
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
            projectMilestoneId: 'milestone-beta',
            cycleId: 'cycle-42',
            parentId: 'uuid-200',
            estimate: 3,
            dueDate: '2026-11-30',
            description: 'Refunds go through the limiter.',
            addedLabelIds: ['label-bug'],
            removedLabelIds: ['label-payments'],
          },
        })
      }),
    )

    it.effect('takes off a milestone, cycle, parent, estimate and due day, and puts it in a milestone’s project with it', () =>
      Effect.gen(function* () {
        const { tracker, sent } = linear([['POST', URL, { json: { data: { issueUpdate: { success: true, issue: issue() } } } }]])
        yield* tracker.update(found, { milestone: null, cycle: null, parent: null, estimate: null, due: null })
        assert.deepStrictEqual((variablesOf(sent[0]) as { input: unknown }).input, {
          projectMilestoneId: null,
          cycleId: null,
          parentId: null,
          estimate: null,
          dueDate: null,
        })
        // A milestone is in one project: without a project said, the issue goes into its own; with one said, that one.
        yield* tracker.update(found, { milestone: { id: 'milestone-beta', name: 'Beta', in: 'project-q4' } })
        yield* tracker.update(found, {
          project: { id: 'project-q5', name: 'Q5' },
          milestone: { id: 'milestone-beta', name: 'Beta', in: 'project-q4' },
        })
        yield* tracker.update(found, { milestone: { id: 'milestone-loose', name: 'Loose' } })
        assert.deepStrictEqual(
          sent.slice(1).map((request) => (variablesOf(request) as { input: unknown }).input),
          [
            { projectId: 'project-q4', projectMilestoneId: 'milestone-beta' },
            { projectId: 'project-q5', projectMilestoneId: 'milestone-beta' },
            { projectMilestoneId: 'milestone-loose' },
          ],
        )
      }),
    )

    it.effect('assigns it to the one person added, in place of whoever had it, and unassigns it only when its own is taken off', () =>
      Effect.gen(function* () {
        const { tracker, sent } = linear([['POST', URL, { json: { data: { issueUpdate: { success: true, issue: issue() } } } }]])
        const you = { id: 'u1', name: 'You Person' }
        const ana = { id: 'u2', name: 'Ana Ruiz' }
        const sam = { id: 'u3', name: 'Sam Rivera' }
        const assigned = { ...found, assignees: [{ id: 'u1', login: 'you', name: 'You Person', bot: false }] }
        for (const assignee of [
          // Added in place of whoever had it: the last added, where several are.
          { add: [ana], remove: [] },
          { add: [ana, sam], remove: [you] },
          // Its own taken off, with no one added: no one has it.
          { add: [], remove: [you] },
          // Someone who hasn't it taken off: it stays with its own.
          { add: [], remove: [ana] },
          null,
        ])
          yield* tracker.update(assigned, { assignee })
        assert.deepStrictEqual(
          sent.map((request) => (variablesOf(request) as { input: unknown }).input),
          [{ assigneeId: 'u2' }, { assigneeId: 'u3' }, { assigneeId: null }, {}, { assigneeId: null }],
        )
      }),
    )

    it.effect('lists its team’s projects’ milestones and its cycles not past, before an issue is filed in it', () =>
      Effect.gen(function* () {
        const { tracker, sent } = linear([
          [
            'POST',
            URL,
            (request) => {
              const after = (variablesOf(request) as { after?: string | null }).after ?? null
              // A team's own, or an issue's team's, as asked.
              const page = (nodes: ReadonlyArray<unknown>, next?: string) => {
                const team = {
                  items: { nodes, pageInfo: next === undefined ? { hasNextPage: false } : { hasNextPage: true, endCursor: next } },
                }
                return { json: { data: queryOf(request).includes('issue(id') ? { issue: { team } } : { team } } }
              }
              if (queryOf(request).includes('cycles('))
                return page([
                  { id: 'cycle-43', number: 43, name: null, isActive: false, isNext: true },
                  { id: 'cycle-42', number: 42, name: 'Hardening', isActive: true, isNext: false },
                  { id: 'cycle-44', number: 44, isActive: false, isNext: false },
                ])
              return after === null
                ? page(
                    [
                      { id: 'project-q4', name: 'Q4 launch', projectMilestones: { nodes: [{ id: 'milestone-beta', name: 'Beta' }] } },
                      { id: 'project-none', name: 'Unplanned', projectMilestones: { nodes: [] } },
                    ],
                    'cursor-1',
                  )
                : page([{ id: 'project-q5', name: 'Q5', projectMilestones: { nodes: [{ id: 'milestone-ga', name: 'GA' }] } }])
            },
          ],
        ])
        assert.deepStrictEqual(yield* tracker.choicesIn('team-mer', 'milestone'), [
          { id: 'milestone-beta', name: 'Beta', in: 'project-q4', also: ['Q4 launch / Beta'] },
          { id: 'milestone-ga', name: 'GA', in: 'project-q5', also: ['Q5 / GA'] },
        ])
        assert.deepStrictEqual(sent.slice(0, 2).map(variablesOf), [
          { id: 'team-mer', after: null },
          { id: 'team-mer', after: 'cursor-1' },
        ])
        assert.include(queryOf(sent[0] as { body: unknown }), 'team(id: $id) { items: projects(first: 50, after: $after)')
        assert.include(queryOf(sent[0] as { body: unknown }), 'projectMilestones(first: 50) { nodes { id name } }')
        // By number and by name, and the one under way and the next by those words.
        assert.deepStrictEqual(yield* tracker.choicesIn('team-mer', 'cycle'), [
          { id: 'cycle-42', name: 'Hardening', also: ['42', 'current'] },
          { id: 'cycle-43', name: 'Cycle 43', also: ['43', 'next'] },
          { id: 'cycle-44', name: 'Cycle 44', also: ['44'] },
        ])
        assert.include(queryOf(sent.at(-1) as { body: unknown }), 'cycles(first: 100, after: $after, filter: { isPast: { eq: false } })')
        // An issue's own: its team's, read through it.
        yield* tracker.choices(found, 'cycle')
        assert.deepStrictEqual(variablesOf(sent.at(-1)), { id: 'uuid-231', after: null })
        assert.include(queryOf(sent.at(-1) as { body: unknown }), 'issue(id: $id) { team { items: cycles(')
      }),
    )

    it.effect('lists a team’s states, people, projects and labels by its id, as for an issue in it', () =>
      Effect.gen(function* () {
        const { tracker, sent } = linear([
          [
            'POST',
            URL,
            (request) => {
              const items = (nodes: ReadonlyArray<unknown>) => ({
                json: { data: { team: { items: { nodes, pageInfo: { hasNextPage: false } } } } },
              })
              if (queryOf(request).includes('issueLabels'))
                return { json: { data: { issueLabels: { nodes: [{ id: 'label-bug', name: 'Bug' }], pageInfo: { hasNextPage: false } } } } }
              if (queryOf(request).includes('states(')) return items(states)
              if (queryOf(request).includes('members(')) return items([{ id: 'u1', name: 'You Person', displayName: 'you', active: true }])
              return items([{ id: 'project-q4', name: 'Q4 launch' }])
            },
          ],
        ])
        assert.deepStrictEqual(
          (yield* tracker.choicesIn('team-mer', 'status')).map((one) => one.name),
          ['Todo', 'In Progress', 'In Review', 'Done', 'Shipped'],
        )
        assert.deepStrictEqual(yield* tracker.choicesIn('team-mer', 'assignee'), [{ id: 'u1', name: 'You Person', also: ['you'] }])
        assert.deepStrictEqual(yield* tracker.choicesIn('team-mer', 'project'), [{ id: 'project-q4', name: 'Q4 launch' }])
        assert.deepStrictEqual(yield* tracker.choicesIn('team-mer', 'labels'), [{ id: 'label-bug', name: 'Bug' }])
        // The team is known: its labels are read without asking for it first.
        assert.lengthOf(sent, 4)
        assert.deepStrictEqual(sent.map(variablesOf), [
          { id: 'team-mer', after: null },
          { id: 'team-mer', after: null },
          { id: 'team-mer', after: null },
          { teamId: 'team-mer', after: null },
        ])
      }),
    )

    it.effect('refuses a type or components, which Linear hasn’t, in words to pass on, asking Linear nothing', () =>
      Effect.gen(function* () {
        const { tracker, sent } = linear([])
        const type = yield* Effect.flip(tracker.choicesIn('team-mer', 'type'))
        assert.deepInclude(type, {
          reason: 'rejected',
          message: 'Althar can’t change an issue’s type here: Linear has no issue types: a label says what kind it is',
        })
        const components = yield* Effect.flip(tracker.choices(found, 'components'))
        assert.deepInclude(components, { reason: 'rejected' })
        assert.match(components.message, /Linear has no components/)
        assert.lengthOf(sent, 0)
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

  it.effect('files an issue with its status, assignee, project, milestone, cycle, parent, estimate and due day at once', () =>
    Effect.gen(function* () {
      const { tracker, sent } = linear([['POST', URL, { json: { data: { issueCreate: { success: true, issue: issue() } } } }]])
      yield* tracker.create('team-mer', {
        title: 'A title',
        body: '',
        labels: [],
        fields: {
          status: { id: 'state-todo', name: 'Todo' },
          assignee: { add: [{ id: 'u2', name: 'Ana Ruiz' }], remove: [] },
          project: { id: 'project-q4', name: 'Q4 launch' },
          milestone: { id: 'milestone-beta', name: 'Beta', in: 'project-q4' },
          cycle: { id: 'cycle-42', name: 'Hardening' },
          parent: { id: 'uuid-200', ref: 'MER-200', key: 'MER-200' },
          estimate: 3,
          due: '2026-11-30',
        },
      })
      assert.deepStrictEqual(variablesOf(sent[0]), {
        input: {
          teamId: 'team-mer',
          title: 'A title',
          description: '',
          stateId: 'state-todo',
          assigneeId: 'u2',
          projectId: 'project-q4',
          projectMilestoneId: 'milestone-beta',
          cycleId: 'cycle-42',
          parentId: 'uuid-200',
          estimate: 3,
          dueDate: '2026-11-30',
        },
      })
      // A milestone alone puts it in the milestone's project; nothing taken off a new issue is said.
      yield* tracker.create('team-mer', {
        title: 'A title',
        body: '',
        labels: [],
        fields: { milestone: { id: 'milestone-beta', name: 'Beta', in: 'project-q4' }, assignee: null, cycle: null, estimate: null },
      })
      assert.deepStrictEqual(variablesOf(sent[1]), {
        input: { teamId: 'team-mer', title: 'A title', description: '', projectId: 'project-q4', projectMilestoneId: 'milestone-beta' },
      })
    }),
  )

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
