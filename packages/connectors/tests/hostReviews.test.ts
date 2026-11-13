import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { postHostReview, reviewCommitMatches } from '../src/hostReviews'
import { makeHttp } from '../src/http'
import { stubFetch, type Route } from './stub'

const head = 'a'.repeat(40)
const baseSha = 'b'.repeat(40)
const fixtures = [
  {
    product: 'gitlab' as const,
    base: 'https://gitlab.test/api/v4/projects/1/merge_requests/2',
    head: { sha: head, author: { id: 1 }, diff_refs: { base_sha: baseSha, start_sha: 'c'.repeat(40), head_sha: head } },
    author: '1',
  },
  {
    product: 'bitbucket_cloud' as const,
    base: 'https://api.bitbucket.org/2.0/repositories/a/b/pullrequests/2',
    head: { source: { commit: { hash: head } }, destination: { commit: { hash: baseSha } }, author: { uuid: '{author}' } },
    author: '{author}',
  },
  {
    product: 'bitbucket_dc' as const,
    base: 'https://bb.test/rest/api/latest/projects/A/repos/b/pull-requests/2',
    head: { fromRef: { latestCommit: head }, toRef: { latestCommit: baseSha }, author: { user: { id: 1 } } },
    author: '1',
  },
] as const
const me = Effect.succeed({ id: 'reviewer', login: 'reviewer', name: 'Reviewer' })
const client = (product: (typeof fixtures)[number]['product'], routes: ReadonlyArray<Route>) => {
  const stub = stubFetch(routes)
  return { ...stub, http: makeHttp({ product, fetch: stub.fetch, authorization: Effect.succeed('Bearer test-token') }) }
}

describe('posting reviews on GitLab and Bitbucket', () => {
  for (const fixture of [fixtures[1], fixtures[2]])
    it.effect(`requests changes through ${fixture.product}'s native verdict endpoint`, () =>
      Effect.gen(function* () {
        const path = fixture.product === 'bitbucket_dc' ? `${fixture.base}/participants/reviewer` : `${fixture.base}/request-changes`
        const { http, sent } = client(fixture.product, [
          ['GET', fixture.base, { json: fixture.head }],
          [fixture.product === 'bitbucket_dc' ? 'PUT' : 'POST', path, { json: {} }],
        ])
        yield* postHostReview(fixture.product, http, fixture.base, { event: 'request_changes', body: '', commit: head, comments: [] }, me)
        assert.deepStrictEqual(
          sent.find((one) => one.url === path)?.body,
          fixture.product === 'bitbucket_dc' ? { status: 'NEEDS_WORK', lastReviewedCommit: head } : {},
        )
      }),
    )
  for (const fixture of fixtures) {
    it.effect(`posts a summary and a commit-bound approval on ${fixture.product}`, () =>
      Effect.gen(function* () {
        const verdict = fixture.product === 'bitbucket_dc' ? `${fixture.base}/participants/reviewer` : `${fixture.base}/approve`
        const { http, sent } = client(fixture.product, [
          ['GET', fixture.base, { json: fixture.head }],
          ['POST', `${fixture.base}/${fixture.product === 'gitlab' ? 'notes' : 'comments'}`, { json: { id: 7 } }],
          [fixture.product === 'bitbucket_dc' ? 'PUT' : 'POST', verdict, { json: {} }],
        ])
        assert.deepStrictEqual(
          yield* postHostReview(
            fixture.product,
            http,
            fixture.base,
            { event: 'approve', body: 'Reviewed', commit: head, comments: [] },
            me,
          ),
          { id: '7', url: null },
        )
        const posted = sent.find((one) => one.url === verdict)
        assert.deepStrictEqual(
          posted?.body,
          fixture.product === 'gitlab'
            ? { sha: head }
            : fixture.product === 'bitbucket_dc'
              ? { status: 'APPROVED', lastReviewedCommit: head }
              : {},
        )
      }),
    )
    it.effect(`refuses a moved head and self-approval before any writes on ${fixture.product}`, () =>
      Effect.gen(function* () {
        const { http, sent } = client(fixture.product, [['GET', fixture.base, { json: fixture.head }]])
        const review = { event: 'approve' as const, body: 'Reviewed', commit: head, comments: [] }
        assert.match(
          (yield* Effect.flip(postHostReview(fixture.product, http, fixture.base, { ...review, commit: baseSha }, me))).message,
          /head moved/,
        )
        assert.match(
          (yield* Effect.flip(
            postHostReview(
              fixture.product,
              http,
              fixture.base,
              review,
              Effect.succeed({ id: fixture.author, login: 'author', name: null }),
            ),
          )).message,
          /own change/,
        )
        assert.isTrue(sent.every((one) => one.method === 'GET'))
      }),
    )
  }
  it.effect('anchors GitLab comments to renamed files, with both coordinates for context lines', () =>
    Effect.gen(function* () {
      const f = fixtures[0]
      const { http, sent } = client('gitlab', [
        ['GET', f.base, { json: f.head }],
        [
          'GET',
          `${f.base}/diffs?per_page=100&page=1`,
          { json: [{ old_path: 'old.ts', new_path: 'new.ts', diff: '@@ -8,2 +8,3 @@\n context\n+new\n rest' }] },
        ],
        ['POST', `${f.base}/discussions`, { json: { id: 'discussion' } }],
      ])
      yield* postHostReview(
        'gitlab',
        http,
        f.base,
        {
          event: 'comment',
          body: '',
          commit: head,
          comments: [
            { path: 'new.ts', line: 8, body: 'Context' },
            { path: 'new.ts', line: 9, body: 'New line' },
          ],
        },
        me,
      )
      const writes = sent.filter((one) => one.method === 'POST')
      assert.deepInclude(writes[0]?.body, {
        position: {
          position_type: 'text',
          base_sha: baseSha,
          start_sha: 'c'.repeat(40),
          head_sha: head,
          old_path: 'old.ts',
          new_path: 'new.ts',
          new_line: 8,
          old_line: 8,
        },
      })
      assert.deepInclude(writes[1]?.body, {
        position: {
          position_type: 'text',
          base_sha: baseSha,
          start_sha: 'c'.repeat(40),
          head_sha: head,
          old_path: 'old.ts',
          new_path: 'new.ts',
          new_line: 9,
        },
      })
    }),
  )
  it.effect('uses GitLab’s native request-changes mutation and treats a later failure as a partial review', () =>
    Effect.gen(function* () {
      const f = fixtures[0]
      const { http, sent } = client('gitlab', [
        ['GET', f.base, { json: f.head }],
        ['POST', `${f.base}/notes`, { json: { id: 7 } }],
        ['POST', 'https://gitlab.test/api/graphql', { json: { data: { mergeRequestRequestChanges: { errors: [] } } } }],
        ['POST', `${f.base}/approve`, { status: 403, json: { message: 'Forbidden' } }],
      ])
      const review = { event: 'request_changes' as const, body: 'Fix retries', commit: head, comments: [] }
      yield* postHostReview('gitlab', http, f.base, review, me, { url: 'https://gitlab.test/api/graphql', project: 'a/b', number: 2 })
      assert.deepInclude(sent.find((one) => one.url.endsWith('/graphql'))?.body, { variables: { path: 'a/b', iid: '2' } })
      const partial = yield* Effect.flip(postHostReview('gitlab', http, f.base, { ...review, event: 'approve' }, me))
      assert.strictEqual(partial.reason, 'invalid_response')
      assert.include(partial.message, 'do not repeat')
    }),
  )
  it.effect('refuses an invalid GitLab line before posting any part of a review', () =>
    Effect.gen(function* () {
      const f = fixtures[0]
      const { http, sent } = client('gitlab', [
        ['GET', f.base, { json: f.head }],
        ['GET', `${f.base}/diffs?per_page=100&page=1`, { json: [] }],
      ])
      yield* Effect.flip(
        postHostReview(
          'gitlab',
          http,
          f.base,
          { event: 'approve', body: 'Reviewed', commit: head, comments: [{ path: 'absent', line: 1, body: 'No' }] },
          me,
        ),
      )
      assert.isTrue(sent.every((one) => one.method === 'GET'))
    }),
  )
  it.effect('uses Data Center’s diff segments for the line’s actual anchor type', () =>
    Effect.gen(function* () {
      const f = fixtures[2]
      const { http, sent } = client('bitbucket_dc', [
        ['GET', f.base, { json: f.head }],
        [
          'GET',
          `${f.base}/diff/new.ts?withComments=false`,
          {
            json: { diffs: [{ source: { toString: 'old.ts' }, hunks: [{ segments: [{ type: 'ADDED', lines: [{ destination: 9 }] }] }] }] },
          },
        ],
        ['POST', `${f.base}/comments`, { json: { id: 8 } }],
      ])
      yield* postHostReview(
        'bitbucket_dc',
        http,
        f.base,
        { event: 'comment', body: '', commit: head, comments: [{ path: 'new.ts', line: 9, body: 'Changed' }] },
        me,
      )
      assert.deepInclude(sent.find((one) => one.method === 'POST')?.body, {
        anchor: {
          diffType: 'EFFECTIVE',
          fileType: 'TO',
          lineType: 'ADDED',
          fromHash: baseSha,
          toHash: head,
          path: 'new.ts',
          srcPath: 'old.ts',
          line: 9,
        },
      })
    }),
  )
  it.effect('does not approve a head that moved after a comment was posted', () =>
    Effect.gen(function* () {
      const f = fixtures[1]
      let reads = 0
      const { http, sent } = client('bitbucket_cloud', [
        ['GET', f.base, () => ({ json: { ...f.head, source: { commit: { hash: ++reads <= 2 ? head : baseSha } } } })],
        ['POST', `${f.base}/comments`, { json: { id: 7 } }],
      ])
      const failed = yield* Effect.flip(
        postHostReview('bitbucket_cloud', http, f.base, { event: 'approve', body: 'Reviewed', commit: head, comments: [] }, me),
      )
      assert.strictEqual(failed.reason, 'invalid_response')
      assert.isFalse(sent.some((one) => one.url.endsWith('/approve')))
    }),
  )
  it.effect('matches a full reviewed commit against an abbreviated provider hash, never an unrelated or short user value', () =>
    Effect.sync(() => {
      assert.isTrue(reviewCommitMatches(head, head.slice(0, 12)))
      assert.isFalse(reviewCommitMatches(head, baseSha.slice(0, 12)))
      assert.isFalse(reviewCommitMatches(head.slice(0, 7), head.slice(0, 12)))
    }),
  )
})
