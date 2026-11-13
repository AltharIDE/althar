import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { makeServiceApi } from '../src/api'
import { stubFetch } from './stub'

describe('issue file uploads', () => {
  for (const product of ['github', 'gitlab'] as const)
    it.effect(`links a ${product} upload to the requested issue, and holds a failed link as uncertain`, () =>
      Effect.gen(function* () {
        const root = product === 'github' ? 'https://api.github.com' : 'https://gitlab.com/api/v4'
        const repository =
          product === 'github'
            ? { id: 1, full_name: 'a/b', default_branch: 'main', html_url: 'https://github.com/a/b' }
            : { id: 1, path_with_namespace: 'a/b', web_url: 'https://gitlab.com/a/b' }
        const projectPath = product === 'github' ? '/repos/a/b' : '/projects/a%2Fb'
        const commentPath = product === 'github' ? '/repos/a/b/issues/12/comments' : '/projects/a%2Fb/issues/12/notes'
        let links = 0
        const { fetch, sent } = stubFetch([
          ['GET', root + projectPath, { json: repository }],
          [
            'POST',
            product === 'github' ? /^https:\/\/uploads\.github\.com\/user-attachments\/assets\?/ : root + '/projects/1/uploads',
            { json: { url: product === 'github' ? 'https://github.com/user-attachments/assets/file' : '/uploads/file/report.txt' } },
          ],
          ['POST', root + commentPath, () => (++links === 1 ? { json: { id: 42 } } : { status: 403, json: { message: 'Forbidden' } })],
        ])
        const api = makeServiceApi(product, {
          apiUrl: root,
          webUrl: product === 'github' ? 'https://github.com' : 'https://gitlab.com',
          fetch,
          credential: Effect.succeed({ kind: 'bearer', token: 't' }),
        })
        assert.deepInclude((yield* api.uploadAttachment('a/b#12', 'report.txt', 'text/plain', new Uint8Array([65]))).body, { linked: true })
        const failed = yield* Effect.flip(api.uploadAttachment('a/b#12', 'report.txt', 'text/plain', new Uint8Array([65])))
        assert.strictEqual(failed.reason, 'invalid_response')
        assert.include(failed.message, 'uploaded')
        assert.isTrue(sent.filter((one) => one.bytes !== undefined).every((one) => one.redirect === 'manual'))
      }),
    )
  for (const product of ['jira_cloud', 'jira_dc', 'trello'] as const)
    it.effect(`uploads a multipart file with the existing ${product} credential and no redirects`, () =>
      Effect.gen(function* () {
        const root =
          product === 'trello' ? 'https://api.trello.com/1' : `https://jira.test/rest/api/${product === 'jira_cloud' ? '3' : '2'}`
        const path = product === 'trello' ? '/cards/DEV-1/attachments' : '/issue/DEV-1/attachments'
        const { fetch, sent } = stubFetch([['POST', root + path, { json: [{ id: 'attachment', filename: 'report.txt' }] }]])
        const api = makeServiceApi(product, {
          apiUrl: root,
          webUrl: 'https://service.test',
          fetch,
          credential: Effect.succeed(
            product === 'trello' ? { kind: 'app', key: 'app-key', token: 'test-token' } : { kind: 'bearer', token: 'test-token' },
          ),
        })
        yield* api.uploadAttachment('DEV-1', 'report.txt', 'text/plain', new TextEncoder().encode('Report bytes'))
        assert.include(sent[0]?.headers['content-type'] ?? '', 'multipart/form-data; boundary=')
        assert.include(new TextDecoder().decode(sent[0]?.bytes), 'filename="report.txt"')
        assert.include(new TextDecoder().decode(sent[0]?.bytes), 'Report bytes')
        assert.strictEqual(sent[0]?.redirect, 'manual')
        assert.include(sent[0]?.headers.authorization ?? '', 'test-token')
        if (product !== 'trello') assert.strictEqual(sent[0]?.headers['x-atlassian-token'], 'no-check')
        assert.notInclude(sent[0]?.url ?? '', 'test-token')
      }),
    )
  it.effect('refuses oversized files and unsafe multipart metadata without sending bytes', () =>
    Effect.gen(function* () {
      const { fetch, sent } = stubFetch([])
      const api = makeServiceApi('jira_cloud', {
        apiUrl: 'https://jira.test/rest/api/3',
        webUrl: 'https://jira.test',
        fetch,
        credential: Effect.succeed({ kind: 'bearer', token: 't' }),
      })
      yield* Effect.flip(api.uploadAttachment('DEV-1', 'report.txt', 'text/plain', new Uint8Array(5 * 1024 * 1024 + 1)))
      yield* Effect.flip(api.uploadAttachment('DEV-1', 'bad\r\nname', 'text/plain', new Uint8Array()))
      assert.lengthOf(sent, 0)
    }),
  )
})
