import { makeServiceApi } from '@althar/connectors'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { bitbucketThreadRequest, reviewerRequest } from '../src/integrationHostTools'

describe('adding pull request reviewers', () => {
  it.effect('resolves and reopens Bitbucket conversations without changing their text', () =>
    Effect.gen(function* () {
      const api = makeServiceApi('bitbucket_dc', {
        apiUrl: 'https://host.test/rest/api/latest',
        webUrl: 'https://host.test',
        credential: Effect.succeed({ kind: 'bearer', token: 'test-token' }),
        fetch: async () => new Response(JSON.stringify({ version: 4, text: 'Original comment' })),
      })
      assert.deepStrictEqual(yield* bitbucketThreadRequest('bitbucket_dc', api, '/pulls/1', '42', true), {
        method: 'PUT',
        path: '/pulls/1/comments/42',
        body: { version: 4, state: 'RESOLVED' },
      })
      assert.deepStrictEqual(yield* bitbucketThreadRequest('bitbucket_cloud', api, '/pulls/1', '42', false), {
        method: 'DELETE',
        path: '/pulls/1/comments/42/resolve',
        body: {},
      })
    }),
  )
  for (const fixture of [
    {
      product: 'gitlab' as const,
      current: { reviewers: [{ id: 12 }, { id: 21 }] },
      asked: ['21', '34'],
      expected: { reviewer_ids: [12, 21, 34] },
    },
    {
      product: 'bitbucket_cloud' as const,
      current: { reviewers: [{ uuid: '{ada}' }, { uuid: '{bea}' }] },
      asked: ['{bea}', '{cy}'],
      expected: { reviewers: [{ uuid: '{ada}' }, { uuid: '{bea}' }, { uuid: '{cy}' }] },
    },
    {
      product: 'bitbucket_dc' as const,
      current: { version: 7, reviewers: [{ user: { name: 'ada' } }, { user: { name: 'bea' } }] },
      asked: ['bea', 'cy'],
      expected: { version: 7, reviewers: [{ user: { name: 'ada' } }, { user: { name: 'bea' } }, { user: { name: 'cy' } }] },
    },
  ])
    it.effect(`preserves existing reviewers and deduplicates additions on ${fixture.product}`, () =>
      Effect.gen(function* () {
        const api = makeServiceApi(fixture.product, {
          apiUrl: 'https://host.test/api',
          webUrl: 'https://host.test',
          credential: Effect.succeed({ kind: 'bearer', token: 'test-token' }),
          fetch: async () => new Response(JSON.stringify(fixture.current)),
        })
        const request = yield* reviewerRequest(fixture.product, api, '/pulls/1', fixture.asked, [])
        assert.strictEqual(request.method, 'PUT')
        assert.deepStrictEqual(request.body, fixture.expected)
      }),
    )
})
