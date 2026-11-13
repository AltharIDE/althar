import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { parse } from 'graphql'

import { makeServiceApi } from '../src/api'
import {
  LINEAR_RESOURCES,
  linearRelationChange,
  linearRelationsRequest,
  linearResourceRequest,
  type LinearResource,
} from '../src/linearResources'
import { stubFetch, variablesOf } from './stub'

describe('Linear workspace resources', () => {
  it('builds reads, paginated lists, creates and updates from the resource’s exact GraphQL contract', () => {
    for (const entity of Object.keys(LINEAR_RESOURCES) as Array<LinearResource>) {
      for (const action of ['list', 'read', 'save'] as const) {
        const request = linearResourceRequest(entity, action, {
          id: 'id',
          cursor: 'after',
          limit: 10,
          filter: { id: { eq: 'id' } },
          data: { content: 'Markdown\n\n"Quoted"' },
        })
        assert.doesNotThrow(() => parse(request.query ?? ''))
        assert.notInclude(request.query ?? '', '"Quoted"')
        assert.include(request.query ?? '', LINEAR_RESOURCES[entity].fields)
      }
      assert.include(linearResourceRequest(entity, 'save', {}).query ?? '', `${LINEAR_RESOURCES[entity].result}Create`)
      assert.include(linearResourceRequest(entity, 'save', { id: 'x' }).query ?? '', `${LINEAR_RESOURCES[entity].result}Update`)
    }
  })

  it('distinguishes the incoming blockers from outgoing blocks and preserves duplicate direction', () => {
    assert.include(linearRelationsRequest('DEV-1', 'incoming', 'cursor').query ?? '', 'inverseRelations')
    assert.include(linearRelationsRequest('DEV-1', 'outgoing').query ?? '', 'result: relations')
    assert.deepStrictEqual(linearRelationChange('a', 'b', 'blocked_by').variables, {
      input: { issueId: 'b', relatedIssueId: 'a', type: 'blocks' },
    })
    assert.deepStrictEqual(linearRelationChange('duplicate', 'original', 'duplicate').variables, {
      input: { issueId: 'duplicate', relatedIssueId: 'original', type: 'duplicate' },
    })
    assert.deepStrictEqual(linearRelationChange('a', 'b', 'related', 'relation-id').variables, { id: 'relation-id' })
  })

  it.effect('uploads bytes without the Linear credential before creating an issue resource', () =>
    Effect.gen(function* () {
      const { fetch, sent } = stubFetch([
        [
          'POST',
          'https://api.linear.app/graphql',
          (request) =>
            JSON.stringify(request.body).includes('fileUpload')
              ? {
                  json: {
                    data: {
                      result: {
                        success: true,
                        uploadFile: {
                          uploadUrl: 'https://uploads.linear.app/put?signature=x',
                          assetUrl: 'https://uploads.linear.app/report.txt',
                          headers: [{ key: 'x-amz-acl', value: 'private' }],
                        },
                      },
                    },
                  },
                }
              : {
                  json: {
                    data: {
                      result: {
                        success: true,
                        attachment: { id: 'asset', title: 'report.txt', url: 'https://uploads.linear.app/report.txt' },
                      },
                    },
                  },
                },
        ],
        ['PUT', 'https://uploads.linear.app/put?signature=x', { status: 200 }],
      ])
      const api = makeServiceApi('linear', {
        fetch,
        apiUrl: 'https://api.linear.app',
        webUrl: 'https://linear.app',
        credential: Effect.succeed({ kind: 'key', token: 'linear-secret' }),
      })
      const result = yield* api.uploadAttachment('issue-id', 'report.txt', 'text/plain', new TextEncoder().encode('Report'))
      assert.include(JSON.stringify(result.body), 'asset')
      assert.isUndefined(sent[1]?.headers.authorization)
      assert.strictEqual(sent[1]?.redirect, 'error')
      assert.deepStrictEqual(variablesOf(sent[2]), {
        input: { issueId: 'issue-id', title: 'report.txt', url: 'https://uploads.linear.app/report.txt' },
      })
      assert.strictEqual(new TextDecoder().decode(sent[1]?.bytes), 'Report')
    }),
  )

  it.effect('never links a failed upload and refuses an attachment larger than its limit', () =>
    Effect.gen(function* () {
      const { fetch, sent } = stubFetch([
        [
          'POST',
          'https://api.linear.app/graphql',
          {
            json: {
              data: {
                result: {
                  success: true,
                  uploadFile: { uploadUrl: 'https://uploads.linear.app/put', assetUrl: 'https://uploads.linear.app/report', headers: [] },
                },
              },
            },
          },
        ],
        ['PUT', 'https://uploads.linear.app/put', { status: 500 }],
      ])
      const api = makeServiceApi('linear', {
        fetch,
        apiUrl: 'https://api.linear.app',
        webUrl: 'https://linear.app',
        credential: Effect.succeed({ kind: 'key', token: 't' }),
      })
      yield* Effect.flip(api.uploadAttachment('i', 'report', 'text/plain', new Uint8Array([1])))
      assert.lengthOf(sent, 2)
      yield* Effect.flip(api.uploadAttachment('i', 'report', 'text/plain', new Uint8Array(5 * 1024 * 1024 + 1)))
      assert.lengthOf(sent, 2)
    }),
  )
})
