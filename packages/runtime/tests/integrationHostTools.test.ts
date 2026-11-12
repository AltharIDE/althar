import { makeServiceApi } from '@althar/connectors'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { reviewerRequest } from '../src/integrationHostTools'

describe('adding pull request reviewers', () => {
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
