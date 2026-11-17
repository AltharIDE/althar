import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { makeServiceApi } from '../src/api'
import { issueCommentRequest, readIssueDiscussion } from '../src/issueDiscussion'
import type { Product } from '../src/model'
import { stubFetch, type Route, variablesOf } from './stub'

const at = (product: Product, root: string, routes: ReadonlyArray<Route>) => {
  const { fetch, sent } = stubFetch(routes)
  return {
    api: makeServiceApi(product, { fetch, apiUrl: root, webUrl: root, credential: Effect.succeed({ kind: 'bearer', token: 't' }) }),
    sent,
  }
}

describe('complete issue discussions', () => {
  it.effect('reports an invalid continuation instead of silently losing older comments', () =>
    Effect.gen(function* () {
      const { api } = at('linear', 'https://api.linear.app', [
        [
          'POST',
          'https://api.linear.app/graphql',
          { json: { data: { issue: { comments: { nodes: [{ id: 'c' }], pageInfo: { hasNextPage: true, endCursor: null } } } } } },
        ],
      ])
      assert.strictEqual((yield* Effect.flip(readIssueDiscussion('linear', api, { id: 'i', ref: 'DEV-1' }))).reason, 'invalid_response')
    }),
  )
  it.effect('keeps long Linear comments, thread roots and a continuation beyond ten comments', () =>
    Effect.gen(function* () {
      const comments = Array.from({ length: 25 }, (_, i) => ({ id: `c${i}`, body: `line\n\n${'x'.repeat(2000)}`, parent: { id: 'root' } }))
      const { api, sent } = at('linear', 'https://api.linear.app', [
        [
          'POST',
          'https://api.linear.app/graphql',
          { json: { data: { issue: { comments: { nodes: comments, pageInfo: { hasNextPage: true, endCursor: 'next' } } } } } },
        ],
      ])
      const answer = yield* readIssueDiscussion('linear', api, { id: 'i1', ref: 'DEV-1' }, { limit: 25, cursor: 'before' })
      assert.deepStrictEqual(answer, { comments, next: 'next' })
      assert.deepStrictEqual(variablesOf(sent[0]), { id: 'i1', first: 25, after: 'before' })
    }),
  )

  it.effect('pages GitHub and GitLab discussions with stable comment IDs', () =>
    Effect.gen(function* () {
      for (const product of ['github', 'gitlab'] as const) {
        const root = product === 'github' ? 'https://api.github.com' : 'https://gitlab.com/api/v4'
        const path =
          product === 'github'
            ? '/repos/a/b/issues/12/comments?per_page=2&page=2'
            : '/projects/a%2Fb/issues/12/discussions?per_page=2&page=2'
        const comments = [
          { id: 3, body: 'three' },
          { id: 4, body: 'four' },
        ]
        const { api } = at(product, root, [
          [
            'GET',
            root + path,
            {
              json:
                product === 'github'
                  ? comments
                  : comments.map((note) => ({ id: `thread-${note.id}`, individual_note: false, notes: [note] })),
            },
          ],
        ])
        assert.deepStrictEqual(yield* readIssueDiscussion(product, api, { id: 'i', ref: 'a/b#12' }, { cursor: '2', limit: 2 }), {
          comments: product === 'github' ? comments : comments.map((note) => ({ ...note, threadId: `thread-${note.id}` })),
          next: '3',
        })
        assert.strictEqual(
          (yield* Effect.flip(readIssueDiscussion(product, api, { id: 'i', ref: 'a/b#12' }, { cursor: 'bad' }))).reason,
          'rejected',
        )
      }
    }),
  )

  it.effect('pages Jira by its returned offset and total and preserves ADF Markdown', () =>
    Effect.gen(function* () {
      const { api } = at('jira_cloud', 'https://jira.test/rest/api/3', [
        [
          'GET',
          'https://jira.test/rest/api/3/issue/DEV-1/comment?orderBy=created&startAt=20&maxResults=20',
          {
            json: {
              startAt: 20,
              total: 41,
              comments: [
                {
                  id: 'c',
                  body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Full text' }] }] },
                },
              ],
            },
          },
        ],
      ])
      const page = yield* readIssueDiscussion('jira_cloud', api, { id: 'i', ref: 'DEV-1' }, { cursor: '20', limit: 20 })
      assert.strictEqual(page.next, '21')
      assert.strictEqual(page.comments[0]?.['body'], 'Full text')
    }),
  )

  it.effect('continues Trello from its last action, and ends an empty page', () =>
    Effect.gen(function* () {
      const { api } = at('trello', 'https://api.trello.com/1', [
        [
          'GET',
          'https://api.trello.com/1/cards/card/actions?filter=commentCard&limit=1&memberCreator=true&before=cursor',
          { json: [{ id: 'next', data: { text: 'Full text' } }] },
        ],
        ['GET', 'https://api.trello.com/1/cards/card/actions?filter=commentCard&limit=1&memberCreator=true&before=next', { json: [] }],
      ])
      assert.strictEqual(
        (yield* readIssueDiscussion('trello', api, { id: 'card', ref: 'card' }, { cursor: 'cursor', limit: 1 })).next,
        'next',
      )
      assert.isNull((yield* readIssueDiscussion('trello', api, { id: 'card', ref: 'card' }, { cursor: 'next', limit: 1 })).next)
    }),
  )

  it.effect('addresses edits and native replies rather than posting a new root comment', () =>
    Effect.gen(function* () {
      const issue = { id: 'i', ref: 'a/b#12' }
      const linear = yield* issueCommentRequest('linear', issue, 'Reply', { parent: 'root' })
      assert.deepStrictEqual(linear.variables, { input: { issueId: 'i', body: 'Reply', parentId: 'root' } })
      const edit = yield* issueCommentRequest('github', issue, 'Edited', { id: '42' })
      assert.deepStrictEqual(edit, { method: 'PATCH', path: '/repos/a/b/issues/comments/42', body: { body: 'Edited' } })
      assert.strictEqual((yield* Effect.flip(issueCommentRequest('github', issue, 'Reply', { parent: '42' }))).reason, 'rejected')
      assert.deepStrictEqual(yield* issueCommentRequest('gitlab', issue, 'Reply', { parent: 'thread-id' }), {
        method: 'POST',
        path: '/projects/a%2Fb/issues/12/discussions/thread-id/notes',
        body: { body: 'Reply' },
      })
      const jira = yield* issueCommentRequest('jira_cloud', { id: 'i', ref: 'DEV-1' }, '**Edited**', { id: '42' })
      assert.strictEqual(jira.path, '/issue/DEV-1/comment/42')
      assert.strictEqual(
        (yield* issueCommentRequest('trello', { id: 'card', ref: 'card' }, 'Edited', { id: 'c' })).path,
        '/cards/card/actions/c/comments',
      )
    }),
  )
})
