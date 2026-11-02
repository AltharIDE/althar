import { assert, describe, it } from '@effect/vitest'
import { Effect, Exit, Schema } from 'effect'

import { ConnectorFailed } from '../src/errors'
import { ETAG_TEXT_KEPT, ETAGS_KEPT, failureOf, makeHttp } from '../src/http'
import type { Product } from '../src/model'
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

  it.effect('keeps the answers asked for most lately, so a URL no longer asked for stops being kept', () =>
    Effect.gen(function* () {
      const { fetch, sent } = stubFetch([
        [
          'GET',
          /^https:\/\/api\.test\/commits\//,
          (request) =>
            request.headers['if-none-match'] === `"${request.url}"`
              ? { status: 304 }
              : { json: { name: request.url }, headers: { etag: `"${request.url}"` } },
        ],
      ])
      const http = makeHttp({ product: 'github', fetch, authorization: Effect.succeed('Bearer t') })
      const url = (i: number) => `https://api.test/commits/${i}/checks`
      for (let i = 0; i < ETAGS_KEPT; i++) yield* http.cached(Thing, url(i))
      // The first is asked for again, so it is the second that goes when one more comes.
      yield* http.cached(Thing, url(0))
      yield* http.cached(Thing, url(ETAGS_KEPT))
      sent.length = 0
      yield* http.cached(Thing, url(0))
      yield* http.cached(Thing, url(1))
      assert.deepStrictEqual(
        sent.map((request) => request.headers['if-none-match']),
        [`"${url(0)}"`, undefined],
      )
    }),
  )

  it.effect('keeps no more of the answers’ text than its bound', () =>
    Effect.gen(function* () {
      const big = 'x'.repeat(ETAG_TEXT_KEPT / 2)
      const { fetch, sent } = stubFetch([
        [
          'GET',
          /^https:\/\/api\.test\/big\//,
          (request) =>
            request.headers['if-none-match'] === `"${request.url}"`
              ? { status: 304 }
              : { json: { name: big }, headers: { etag: `"${request.url}"` } },
        ],
      ])
      const http = makeHttp({ product: 'github', fetch, authorization: Effect.succeed('Bearer t') })
      yield* http.cached(Thing, 'https://api.test/big/1')
      yield* http.cached(Thing, 'https://api.test/big/2')
      sent.length = 0
      assert.deepStrictEqual(yield* http.cached(Thing, 'https://api.test/big/2'), { name: big })
      yield* http.cached(Thing, 'https://api.test/big/1')
      assert.deepStrictEqual(
        sent.map((request) => request.headers['if-none-match']),
        ['"https://api.test/big/2"', undefined],
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

  it.effect('follows a text’s redirects itself, signed in only on the service’s own origin', () =>
    Effect.gen(function* () {
      const { fetch, sent } = stubFetch([
        ['GET', 'https://api.test/log', { status: 301, headers: { location: '/moved/log' } }],
        ['GET', 'https://api.test/moved/log', { status: 302, headers: { location: 'https://storage.test/log?sig=s' } }],
        ['GET', 'https://storage.test/log?sig=s', { text: 'line 1' }],
      ])
      const http = makeHttp({ product: 'github', fetch, authorization: Effect.succeed('Bearer t'), headers: { 'x-api': '1' } })
      assert.strictEqual(yield* http.text('https://api.test/log'), 'line 1')
      assert.deepStrictEqual(
        sent.map((request) => [request.url, request.headers.authorization, request.headers['x-api'], request.redirect]),
        [
          ['https://api.test/log', 'Bearer t', '1', 'manual'],
          ['https://api.test/moved/log', 'Bearer t', '1', 'manual'],
          ['https://storage.test/log?sig=s', undefined, undefined, 'manual'],
        ],
      )
    }),
  )

  it.effect('says where a redirected text was refused, and stops following a loop', () =>
    Effect.gen(function* () {
      const { fetch } = stubFetch([
        ['GET', 'https://api.test/log', { status: 302, headers: { location: 'https://storage.test/log' } }],
        ['GET', 'https://storage.test/log', { status: 401, text: '<?xml version="1.0"?>\n<Error/>' }],
        ['GET', 'https://api.test/round', { status: 302, headers: { location: 'https://api.test/round' } }],
      ])
      const http = makeHttp({ product: 'github', fetch, authorization: Effect.succeed('Bearer t') })
      // Refused there, it is the signed address that was, not Althar's sign-in, which never went there.
      const refused = failure(yield* Effect.exit(http.text('https://api.test/log')))
      assert.strictEqual(refused?.reason, 'rejected')
      assert.strictEqual(refused?.message, 'storage.test answered 401')
      assert.strictEqual(failure(yield* Effect.exit(http.text('https://api.test/round')))?.reason, 'invalid_response')
    }),
  )

  it.effect('reads an answer’s headers, which is all some answers say', () =>
    Effect.gen(function* () {
      const { fetch } = stubFetch([
        ['GET', 'https://api.test/who', { json: {}, headers: { 'x-ausername': 'dana' } }],
        ['GET', 'https://api.test/gone', { status: 404, text: '' }],
      ])
      const http = makeHttp({ product: 'bitbucket_dc', fetch, authorization: Effect.succeed('Bearer t') })
      assert.strictEqual((yield* http.headers('https://api.test/who')).get('x-ausername'), 'dana')
      assert.strictEqual(failure(yield* Effect.exit(http.headers('https://api.test/gone')))?.reason, 'not_found')
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
        fetch: async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new Error('reset'))
              },
            }),
          ),
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

  /**
   * Each service's own failure, as it sends it, and the words Althar keeps:
   * a row each, so that merging one connector's handling with another's can't
   * quietly drop one. A new connector adds its rows here.
   */
  const said: ReadonlyArray<{ readonly product: Product; readonly status: number; readonly body: string; readonly words: string }> = [
    {
      product: 'github',
      status: 422,
      body: JSON.stringify({ message: 'Validation Failed', errors: [{ message: 'A pull request already exists' }] }),
      words: 'Validation Failed: A pull request already exists',
    },
    { product: 'github', status: 422, body: JSON.stringify({ errors: ['bad branch'] }), words: 'bad branch' },
    { product: 'linear', status: 400, body: JSON.stringify({ error: 'invalid_grant' }), words: 'invalid_grant' },
    // GitLab: a list of messages, messages by field, and OAuth's description.
    {
      product: 'gitlab',
      status: 409,
      body: JSON.stringify({ message: ['Another open merge request already exists for this source branch: !4'] }),
      words: 'Another open merge request already exists for this source branch: !4',
    },
    {
      product: 'gitlab',
      status: 400,
      body: JSON.stringify({ message: { title: ["can't be blank"], base: ['Branch is missing'] } }),
      words: "title can't be blank; Branch is missing",
    },
    {
      product: 'gitlab',
      status: 401,
      body: JSON.stringify({ error: 'invalid_token', error_description: 'Token was revoked.' }),
      words: 'Token was revoked.',
    },
    // Jira: its messages, or what it says of each field.
    {
      product: 'jira_dc',
      status: 404,
      body: JSON.stringify({ errorMessages: ['Issue Does Not Exist'], errors: {} }),
      words: 'Issue Does Not Exist',
    },
    {
      product: 'jira_cloud',
      status: 400,
      body: JSON.stringify({ errorMessages: [], errors: { comment: 'Comment body can not be empty!' } }),
      words: 'Comment body can not be empty!',
    },
    // Bitbucket Cloud: a message, and what it is about, in words or, for missing scopes, as data.
    {
      product: 'bitbucket_cloud',
      status: 404,
      body: JSON.stringify({ error: { message: 'Not Found', detail: 'Log in step {1} does not exist.' } }),
      words: 'Not Found: Log in step {1} does not exist.',
    },
    {
      product: 'bitbucket_cloud',
      status: 400,
      body: JSON.stringify({ type: 'error', error: { message: 'There are no changes to be pulled' } }),
      words: 'There are no changes to be pulled',
    },
    {
      product: 'bitbucket_cloud',
      status: 403,
      body: JSON.stringify({
        type: 'error',
        error: {
          message: 'Your credentials lack one or more required privilege scopes.',
          detail: { granted: ['account'], required: ['workspace'] },
        },
      }),
      words: 'Your credentials lack one or more required privilege scopes.',
    },
    { product: 'bitbucket_cloud', status: 400, body: JSON.stringify({ error: { message: '' } }), words: '400' },
    // Nothing worth keeping: the status says it.
    { product: 'gitlab', status: 400, body: JSON.stringify({ message: [7, null] }), words: '400' },
    // Trello: a line of plain words. A page, or more than a line, says nothing worth keeping.
    { product: 'trello', status: 400, body: 'invalid token', words: 'invalid token' },
    { product: 'github', status: 502, body: '<html><body>Bad gateway</body></html>', words: '502' },
    { product: 'github', status: 500, body: 'oops\nat line 2', words: '500' },
    // JSON of a shape no service here uses is not words to show, nor its text.
    { product: 'github', status: 500, body: JSON.stringify({ errors: 'odd' }), words: '500' },
    { product: 'github', status: 500, body: JSON.stringify(['odd']), words: '500' },
    { product: 'github', status: 500, body: JSON.stringify({}), words: '500' },
  ]
  for (const { product, status, body, words } of said)
    it(`keeps what ${product} said in a ${status}: ${words}`, () => {
      assert.strictEqual(failureOf(product, status, headers(), body, at).message, words)
    })

  /** Each service's way of saying when to try again, a row each, as above. */
  const resets: ReadonlyArray<{
    readonly product: Product
    readonly status: number
    readonly sent: Record<string, string>
    readonly retryAt: string | undefined
  }> = [
    { product: 'github', status: 429, sent: { 'retry-after': '30' }, retryAt: '2026-10-01T09:00:30.000Z' },
    {
      product: 'github',
      status: 403,
      sent: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(at / 1000 + 60) },
      retryAt: '2026-10-01T09:01:00.000Z',
    },
    { product: 'linear', status: 429, sent: { 'x-ratelimit-requests-reset': String(at + 5000) }, retryAt: '2026-10-01T09:00:05.000Z' },
    { product: 'gitlab', status: 429, sent: { 'ratelimit-reset': String(at / 1000 + 90) }, retryAt: '2026-10-01T09:01:30.000Z' },
    // Bitbucket's is the seconds left, not a time.
    { product: 'bitbucket_cloud', status: 429, sent: { 'x-ratelimit-reset': '2374' }, retryAt: '2026-10-01T09:39:34.000Z' },
    { product: 'linear', status: 429, sent: {}, retryAt: undefined },
  ]
  for (const { product, status, sent, retryAt } of resets)
    it(`is rate limited by ${product}'s ${Object.keys(sent).join(' and ') || 'bare'} ${status}, until ${retryAt ?? 'it says'}`, () => {
      const failure = failureOf(product, status, headers(sent), '', at)
      assert.strictEqual(failure.reason, 'rate_limited')
      assert.strictEqual(failure.retryAt, retryAt)
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
    [{ message: 'Your token has not been granted the required scopes to execute this query.', type: 'INSUFFICIENT_SCOPES' }, 'forbidden'],
    [{ message: 'Gone', type: 'NOT_FOUND' }, 'not_found'],
    [{ message: 'Entity not found', extensions: { type: 'entity not found' } }, 'rejected'],
    [{ message: 'Bad input' }, 'rejected'],
  ] as const)('classifies its error %j as %s', ([error, reason]) =>
    Effect.gen(function* () {
      const { http } = graphql({ status: 400, json: { errors: [error] } })
      assert.strictEqual(failure(yield* Effect.exit(http.graphql(Schema.Unknown, 'https://api.test/graphql', 'query')))?.reason, reason)
    }),
  )

  it.effect('classifies a service failing as it worked as unreachable, not refused: a 5xx, or an internal error', () =>
    Effect.gen(function* () {
      const reasonOf = (answer: Parameters<typeof graphql>[0]) =>
        Effect.map(
          Effect.exit(graphql(answer).http.graphql(Schema.Unknown, 'https://api.test/graphql', 'mutation')),
          (exit) => failure(exit)?.reason,
        )
      assert.strictEqual(yield* reasonOf({ status: 500, json: { errors: [{ message: 'Internal error' }] } }), 'unreachable')
      assert.strictEqual(
        yield* reasonOf({ status: 200, json: { errors: [{ message: 'Oops', extensions: { code: 'INTERNAL_SERVER_ERROR' } }] } }),
        'unreachable',
      )
      // A refusal in a 5xx is still the service failing: a mutation may have gone through.
      assert.strictEqual(yield* reasonOf({ status: 503, json: { errors: [{ message: 'Bad input' }] } }), 'unreachable')
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

it.effect('caps streamed downloads even without content-length and preserves binary bytes', () =>
  Effect.gen(function* () {
    let cancelled = false
    const http = makeHttp({
      product: 'github',
      authorization: Effect.succeed('Bearer secret'),
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([0, 255, 80]))
              controller.enqueue(new Uint8Array(10))
            },
            cancel() {
              cancelled = true
            },
          }),
        ),
    })
    const error = yield* Effect.flip(http.bytes('https://api.test/file', 4))
    assert.include(error.message, 'size cap')
    assert.equal(error.reason, 'rejected')
    assert.equal(error.sizeLimit, 4)
    assert.isTrue(cancelled)
    const binary = makeHttp({
      product: 'github',
      authorization: Effect.succeed('Bearer secret'),
      fetch: async () => new Response(new Uint8Array([0, 255, 80])),
    })
    assert.deepEqual([...(yield* binary.bytes('https://api.test/file', 4))], [0, 255, 80])
  }),
)
