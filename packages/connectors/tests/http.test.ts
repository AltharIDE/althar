import { assert, describe, it } from '@effect/vitest'
import { Effect, Exit, Schema } from 'effect'

import { ConnectorFailed } from '../src/errors'
import { failureOf, makeHttp } from '../src/http'
import { stubFetch } from './stub'

const Thing = Schema.Struct({ name: Schema.String })
const failure = <A>(exit: Exit.Exit<A, ConnectorFailed>) => {
  assert.isTrue(Exit.isFailure(exit))
  const error = Exit.isFailure(exit) ? exit.cause.reasons.find((reason) => reason._tag === 'Fail') : undefined
  return error !== undefined && error._tag === 'Fail' ? error.error : undefined
}

describe('a call to a service', () => {
  it.effect('signs in with the header asked for on each call, and reads the answer', () =>
    Effect.gen(function* () {
      const { fetch, sent } = stubFetch([['GET', 'https://api.test/thing', { json: { name: 'a' } }]])
      let token = 0
      const http = makeHttp({
        product: 'github',
        fetch,
        authorization: Effect.sync(() => `Bearer t${(token += 1)}`),
        headers: { 'x-api': '1' },
      })
      assert.deepStrictEqual(yield* http.json(Thing, 'GET', 'https://api.test/thing'), { name: 'a' })
      yield* http.json(Thing, 'GET', 'https://api.test/thing')
      assert.deepStrictEqual(
        sent.map((request) => request.headers.authorization),
        ['Bearer t1', 'Bearer t2'],
      )
      assert.strictEqual(sent[0]?.headers['x-api'], '1')
      assert.strictEqual(sent[0]?.headers['user-agent'], 'Althar')
    }),
  )

  it.effect('sends JSON, and takes an empty answer as null', () =>
    Effect.gen(function* () {
      const { fetch, sent } = stubFetch([['POST', 'https://api.test/things', { status: 201, text: '' }]])
      const http = makeHttp({ product: 'github', fetch, authorization: Effect.succeed('Bearer t') })
      assert.isNull(yield* http.json(Schema.Null, 'POST', 'https://api.test/things', { name: 'b' }))
      assert.deepStrictEqual(sent[0]?.body, { name: 'b' })
      assert.strictEqual(sent[0]?.headers['content-type'], 'application/json')
    }),
  )

  it.effect('answers an unchanged resource from its ETag', () =>
    Effect.gen(function* () {
      const { fetch, sent } = stubFetch([
        [
          'GET',
          'https://api.test/thing',
          (request) => (request.headers['if-none-match'] === '"v1"' ? { status: 304 } : { json: { name: 'a' }, headers: { etag: '"v1"' } }),
        ],
      ])
      const http = makeHttp({ product: 'github', fetch, authorization: Effect.succeed('Bearer t') })
      assert.deepStrictEqual(yield* http.cached(Thing, 'https://api.test/thing'), { name: 'a' })
      assert.deepStrictEqual(yield* http.cached(Thing, 'https://api.test/thing'), { name: 'a' })
      assert.deepStrictEqual(
        sent.map((request) => request.headers['if-none-match']),
        [undefined, '"v1"'],
      )
    }),
  )

  it.effect('reads text as it is', () =>
    Effect.gen(function* () {
      const { fetch, sent } = stubFetch([['GET', 'https://api.test/log', { text: 'line 1\nline 2' }]])
      const http = makeHttp({ product: 'github', fetch, authorization: Effect.succeed('Bearer t') })
      assert.strictEqual(yield* http.text('https://api.test/log'), 'line 1\nline 2')
      assert.strictEqual(sent[0]?.headers.accept, '*/*')
    }),
  )

  it.effect('says when the answer is not what was expected', () =>
    Effect.gen(function* () {
      const { fetch } = stubFetch([
        ['GET', 'https://api.test/html', { text: '<html>' }],
        ['GET', 'https://api.test/other', { json: { title: 'x' } }],
      ])
      const http = makeHttp({ product: 'linear', fetch, authorization: Effect.succeed('k') })
      assert.strictEqual(failure(yield* Effect.exit(http.json(Thing, 'GET', 'https://api.test/html')))?.reason, 'invalid_response')
      assert.strictEqual(failure(yield* Effect.exit(http.json(Thing, 'GET', 'https://api.test/other')))?.reason, 'invalid_response')
    }),
  )

  it.live('is unreachable when the network fails, or nothing answers in time', () =>
    Effect.gen(function* () {
      const broken = makeHttp({
        product: 'github',
        fetch: () => Promise.reject(new TypeError('fetch failed')),
        authorization: Effect.succeed('Bearer t'),
      })
      assert.strictEqual(failure(yield* Effect.exit(broken.json(Thing, 'GET', 'https://api.test/thing')))?.reason, 'unreachable')
      const slow = makeHttp({
        product: 'github',
        fetch: () => new Promise(() => {}),
        authorization: Effect.succeed('Bearer t'),
        timeout: 5,
      })
      assert.strictEqual(failure(yield* Effect.exit(slow.json(Thing, 'GET', 'https://api.test/thing')))?.reason, 'unreachable')
      const unreadable = makeHttp({
        product: 'github',
        fetch: async () => ({ status: 200, headers: new Headers(), text: () => Promise.reject(new Error('reset')) }) as unknown as Response,
        authorization: Effect.succeed('Bearer t'),
      })
      assert.strictEqual(failure(yield* Effect.exit(unreadable.text('https://api.test/log')))?.reason, 'unreachable')
    }),
  )

  it.effect('fails as the credential does, without calling', () =>
    Effect.gen(function* () {
      const { fetch, sent } = stubFetch([])
      const http = makeHttp({
        product: 'github',
        fetch,
        authorization: Effect.fail(new ConnectorFailed({ product: 'github', reason: 'unauthorized', message: 'signed out' })),
      })
      assert.strictEqual(failure(yield* Effect.exit(http.json(Thing, 'GET', 'https://api.test/thing')))?.reason, 'unauthorized')
      assert.lengthOf(sent, 0)
    }),
  )
})

describe('a failed answer', () => {
  const at = Date.parse('2026-10-01T09:00:00.000Z')
  const headers = (entries: Record<string, string> = {}) => new Headers(entries)

  it('is classified by its status', () => {
    assert.strictEqual(failureOf('github', 401, headers(), '', at).reason, 'unauthorized')
    assert.strictEqual(failureOf('github', 403, headers(), '', at).reason, 'forbidden')
    assert.strictEqual(failureOf('github', 404, headers(), '', at).reason, 'not_found')
    assert.strictEqual(failureOf('github', 410, headers(), '', at).reason, 'not_found')
    assert.strictEqual(failureOf('github', 422, headers(), '', at).reason, 'rejected')
    assert.strictEqual(failureOf('github', 502, headers(), '', at).reason, 'unreachable')
  })

  it('keeps what the service said', () => {
    assert.strictEqual(
      failureOf(
        'github',
        422,
        headers(),
        JSON.stringify({ message: 'Validation Failed', errors: [{ message: 'A pull request already exists' }] }),
        at,
      ).message,
      'Validation Failed: A pull request already exists',
    )
    assert.strictEqual(failureOf('github', 422, headers(), JSON.stringify({ errors: ['bad branch'] }), at).message, 'bad branch')
    assert.strictEqual(failureOf('linear', 400, headers(), JSON.stringify({ error: 'invalid_grant' }), at).message, 'invalid_grant')
    // Trello says it in a line of plain words; a page says nothing worth keeping.
    assert.strictEqual(failureOf('trello', 400, headers(), 'invalid token', at).message, 'invalid token')
    assert.strictEqual(failureOf('github', 502, headers(), '<html><body>Bad gateway</body></html>', at).message, '502')
    assert.strictEqual(failureOf('github', 500, headers(), 'oops\nat line 2', at).message, '500')
    assert.strictEqual(failureOf('github', 500, headers(), JSON.stringify({}), at).message, '500')
  })

  it('is rate limited, with when to try again, by whichever header the service sends', () => {
    const later = failureOf('github', 429, headers({ 'retry-after': '30' }), '', at)
    assert.strictEqual(later.reason, 'rate_limited')
    assert.strictEqual(later.retryAt, '2026-10-01T09:00:30.000Z')
    const exhausted = failureOf(
      'github',
      403,
      headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(at / 1000 + 60) }),
      '',
      at,
    )
    assert.strictEqual(exhausted.reason, 'rate_limited')
    assert.strictEqual(exhausted.retryAt, '2026-10-01T09:01:00.000Z')
    assert.strictEqual(
      failureOf('linear', 429, headers({ 'x-ratelimit-requests-reset': String(at + 5000) }), '', at).retryAt,
      '2026-10-01T09:00:05.000Z',
    )
    assert.isUndefined(failureOf('linear', 429, headers(), '', at).retryAt)
  })
})

describe('a GraphQL call', () => {
  const graphql = (answer: Parameters<typeof stubFetch>[0][number][2]) => {
    const { fetch, sent } = stubFetch([['POST', 'https://api.test/graphql', answer]])
    return { http: makeHttp({ product: 'linear', fetch, authorization: Effect.succeed('k') }), sent }
  }

  it.effect('sends its query and variables, and reads its data', () =>
    Effect.gen(function* () {
      const { http, sent } = graphql({ json: { data: { viewer: { name: 'a' } } } })
      const data = yield* http.graphql(Schema.Struct({ viewer: Thing }), 'https://api.test/graphql', 'query { viewer { name } }', {
        first: 1,
      })
      assert.deepStrictEqual(data, { viewer: { name: 'a' } })
      assert.deepStrictEqual(sent[0]?.body, { query: 'query { viewer { name } }', variables: { first: 1 } })
    }),
  )

  it.effect.each([
    [{ message: 'Authentication required', extensions: { code: 'AUTHENTICATION_ERROR' } }, 'unauthorized'],
    [{ message: 'Slow down', extensions: { code: 'RATELIMITED' } }, 'rate_limited'],
    [{ message: 'No', type: 'FORBIDDEN' }, 'forbidden'],
    [{ message: 'Gone', type: 'NOT_FOUND' }, 'not_found'],
    [{ message: 'Entity not found', extensions: { type: 'entity not found' } }, 'rejected'],
    [{ message: 'Bad input' }, 'rejected'],
  ] as const)('classifies its error %j as %s', ([error, reason]) =>
    Effect.gen(function* () {
      const { http } = graphql({ status: 400, json: { errors: [error] } })
      assert.strictEqual(failure(yield* Effect.exit(http.graphql(Schema.Unknown, 'https://api.test/graphql', 'query')))?.reason, reason)
    }),
  )

  it.effect('fails as HTTP does when the answer is not GraphQL', () =>
    Effect.gen(function* () {
      const { http } = graphql({ status: 401, text: 'Unauthorized' })
      assert.strictEqual(
        failure(yield* Effect.exit(http.graphql(Schema.Unknown, 'https://api.test/graphql', 'query')))?.reason,
        'unauthorized',
      )
      const html = graphql({ text: '<html>' })
      assert.strictEqual(
        failure(yield* Effect.exit(html.http.graphql(Schema.Unknown, 'https://api.test/graphql', 'query')))?.reason,
        'invalid_response',
      )
      const odd = graphql({ json: { data: { viewer: 1 } } })
      assert.strictEqual(
        failure(yield* Effect.exit(odd.http.graphql(Schema.Struct({ viewer: Thing }), 'https://api.test/graphql', 'query')))?.reason,
        'invalid_response',
      )
      const refused = graphql({ status: 500, json: { data: null } })
      assert.strictEqual(
        failure(yield* Effect.exit(refused.http.graphql(Schema.Unknown, 'https://api.test/graphql', 'query')))?.reason,
        'unreachable',
      )
    }),
  )
})
