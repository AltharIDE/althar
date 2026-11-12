import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { makeServiceApi, prepareApi } from '../src/api'
import { stubFetch } from './stub'

describe('authenticated service calls', () => {
  it.effect('keeps credentials on the connected origin and returns a next page without truncating its JSON', () =>
    Effect.gen(function* () {
      const { fetch, sent } = stubFetch([
        [
          'GET',
          'https://api.github.com/repos/a/b/issues?page=1',
          {
            json: [{ body: 'x'.repeat(2000) }],
            headers: { link: '<https://api.github.com/repos/a/b/issues?page=2>; rel="next"' },
          },
        ],
      ])
      const api = makeServiceApi('github', {
        fetch,
        apiUrl: 'https://api.github.com',
        webUrl: 'https://github.com',
        credential: Effect.succeed({ kind: 'bearer', token: 'test-token' }),
      })
      const answer = yield* api.request({ path: '/repos/a/b/issues?page=1' })
      assert.deepStrictEqual(answer.body, [{ body: 'x'.repeat(2000) }])
      assert.strictEqual(answer.next, '/repos/a/b/issues?page=2')
      assert.strictEqual(sent[0]?.headers.authorization, 'Bearer test-token')
      assert.strictEqual(sent[0]?.redirect, 'manual')
    }),
  )

  it.effect('refuses URL escapes and protected API families before sending anything', () =>
    Effect.gen(function* () {
      for (const path of [
        'https://evil.test/x',
        '//evil.test/x',
        '/repos/a/b/../secrets',
        '/repos/a/b/%252e%252e/secrets',
        '/repos/a/b/actions/secrets',
        '/repos/a/b/hooks',
        '/repos/a/b/%5csecrets',
        '/repos/a/b/%00secret',
      ]) {
        assert.strictEqual((yield* Effect.flip(prepareApi('github', 'https://api.github.com', { path }))).reason, 'rejected')
      }
      for (const path of [
        '/repos/a/b/contents/a.ts',
        '/repos/a/b/check-runs',
        '/repos/a/b/statuses/abc',
        '/repos/a/b/branches/main/protection',
        '/projects/a%2Fb',
      ]) {
        assert.strictEqual(
          (yield* Effect.flip(prepareApi('github', 'https://api.github.com', { method: 'POST', path }))).reason,
          'rejected',
        )
      }
    }),
  )

  it.effect('parses GraphQL operations, aliases and fragments rather than trusting an HTTP method or a claimed read', () =>
    Effect.gen(function* () {
      assert.isFalse((yield* prepareApi('linear', 'https://api.linear.app', { query: 'query { issues { nodes { id } } }' })).write)
      assert.isTrue(
        (yield* prepareApi('linear', 'https://api.linear.app', {
          query: 'mutation { issueUpdate(id: "x", input: { title: "New" }) { success } }',
        })).write,
      )
      for (const query of [
        'query { viewer { ...Hidden } } fragment Hidden on User { token: apiKeys { nodes { id } } }',
        'mutation { okay: createCommitOnBranch(input: {}) { clientMutationId } }',
        'mutation { okay: updateRepository(input: {}) { clientMutationId } }',
        'mutation { first: issueUpdate(id: "a", input: {}) { success } second: issueUpdate(id: "b", input: {}) { success } }',
        'query A { viewer { id } } mutation B { issueDelete(id: "x") { success } }',
        'subscription { issue { id } }',
        'not graphql',
      ]) {
        assert.strictEqual((yield* Effect.flip(prepareApi('linear', 'https://api.linear.app', { query }))).reason, 'rejected')
      }
    }),
  )

  it.effect('treats an oversized write response as uncertain and keeps self-hosted API roots', () =>
    Effect.gen(function* () {
      const { fetch } = stubFetch([['POST', 'https://api.github.com/repos/a/b/issues', { json: { text: 'x'.repeat(4 * 1024 * 1024) } }]])
      const api = makeServiceApi('github', {
        fetch,
        apiUrl: 'https://api.github.com',
        webUrl: 'https://github.com',
        credential: Effect.succeed({ kind: 'bearer', token: 't' }),
      })
      assert.strictEqual(
        (yield* Effect.flip(api.request({ method: 'POST', path: '/repos/a/b/issues', body: { title: 'Created' } }))).reason,
        'invalid_response',
      )
      assert.strictEqual(
        (yield* prepareApi('gitlab', 'https://gitlab.test/team/api/v4', { query: 'query { currentUser { id } }' })).url,
        'https://gitlab.test/team/api/graphql',
      )
      assert.strictEqual(
        (yield* prepareApi('github', 'https://github.test/api/v3', { query: 'query { viewer { id } }' })).url,
        'https://github.test/api/graphql',
      )
    }),
  )

  it.effect('does not follow a redirect or report a partial GraphQL mutation as successful', () =>
    Effect.gen(function* () {
      const { fetch, sent } = stubFetch([
        ['GET', 'https://api.github.com/issues', { status: 302, headers: { location: 'https://evil.test/' } }],
        ['POST', 'https://api.github.com/graphql', { json: { data: { changed: null }, errors: [{ message: 'failed' }] } }],
      ])
      const api = makeServiceApi('github', {
        fetch,
        apiUrl: 'https://api.github.com',
        webUrl: 'https://github.com',
        credential: Effect.succeed({ kind: 'bearer', token: 't' }),
      })
      yield* Effect.flip(api.request({ path: '/issues' }))
      yield* Effect.flip(api.request({ query: 'mutation { issueUpdate(id: "x", input: {}) { success } }' }))
      assert.lengthOf(sent, 2)
    }),
  )
  it.effect('classifies GraphQL sign-in failures so a connection can renew its credential', () =>
    Effect.gen(function* () {
      const { fetch } = stubFetch([
        [
          'POST',
          'https://api.linear.app/graphql',
          { json: { errors: [{ message: 'Sign in again', extensions: { code: 'UNAUTHENTICATED' } }] } },
        ],
      ])
      const api = makeServiceApi('linear', {
        fetch,
        apiUrl: 'https://api.linear.app',
        webUrl: 'https://linear.app',
        credential: Effect.succeed({ kind: 'key', token: 't' }),
      })
      assert.strictEqual((yield* Effect.flip(api.request({ query: 'query { viewer { id } }' }))).reason, 'unauthorized')
    }),
  )
})
