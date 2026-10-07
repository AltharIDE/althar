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
})
