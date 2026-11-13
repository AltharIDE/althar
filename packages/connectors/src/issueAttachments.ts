import { createHash } from 'node:crypto'

import { Effect, Schema } from 'effect'

import type { ApiResponse, ServiceApi } from './api'
import { type AdapterOptions, authorizationOf } from './credential'
import { ConnectorFailed } from './errors'
import { makeGitHub } from './github'
import { makeGitLab } from './gitlab'
import { makeHttp } from './http'
import { uploadLinearAttachment } from './linearUpload'
import type { Product } from './model'

export const uploadIssueAttachment = (
  product: Product,
  options: AdapterOptions,
  api: ServiceApi,
  issue: string,
  filename: string,
  mediaType: string,
  bytes: Uint8Array,
): Effect.Effect<ApiResponse, ConnectorFailed> =>
  Effect.gen(function* () {
    const rejected = (message: string) => new ConnectorFailed({ product, reason: 'rejected', message })
    if (bytes.length > 5 * 1024 * 1024) return yield* rejected('An issue attachment is at most 5 MiB.')
    if (filename === '' || /[\r\n"\\/]/.test(filename) || !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(mediaType))
      return yield* rejected('Give a plain filename and a MIME type without parameters.')
    if (product === 'linear') return yield* uploadLinearAttachment(api, options.fetch, issue, filename, mediaType, bytes)
    if (product === 'github' || product === 'gitlab') {
      const match = /^(.+)#(\d+)$/.exec(issue)
      if (match?.[1] === undefined || match[2] === undefined)
        return yield* rejected('An issue attachment needs its repository and issue number.')
      const host = product === 'github' ? makeGitHub(options) : makeGitLab(options)
      const repository = yield* host.repository(match[1].split('/'))
      if (!host.capabilities.pictures || host.uploadPicture === undefined)
        return yield* rejected('This server does not expose a supported file-upload endpoint.')
      const url = yield* host.uploadPicture(repository, { name: filename, mediaType, bytes })
      yield* api
        .request({
          method: 'POST',
          path:
            product === 'github'
              ? `/repos/${match[1]}/issues/${match[2]}/comments`
              : `/projects/${encodeURIComponent(match[1])}/issues/${match[2]}/notes`,
          body: { body: `[${filename.replace(/[[\]]/g, '')}](${url})` },
        })
        .pipe(
          Effect.mapError(
            () =>
              new ConnectorFailed({
                product,
                reason: 'invalid_response',
                message: 'The file was uploaded, but its issue comment was not confirmed. Read the issue before trying again.',
              }),
          ),
        )
      return { status: 201, body: { filename, url, linked: true }, next: null }
    }
    if (!['jira_cloud', 'jira_dc', 'trello'].includes(product)) return yield* rejected('This product has no issue attachment upload API.')
    const boundary = `althar-${createHash('sha256').update(bytes).digest('hex').slice(0, 24)}`
    const before = new TextEncoder().encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mediaType}\r\n\r\n`,
    )
    const after = new TextEncoder().encode(`\r\n--${boundary}--\r\n`)
    const form = new Uint8Array(before.length + bytes.length + after.length)
    form.set(before)
    form.set(bytes, before.length)
    form.set(after, before.length + bytes.length)
    const http = makeHttp({
      product,
      fetch: options.fetch,
      authorization: Effect.map(options.credential, authorizationOf),
      ...(product === 'trello' ? {} : { headers: { 'X-Atlassian-Token': 'no-check' } }),
    })
    const root = options.apiUrl.endsWith('/') ? options.apiUrl.slice(0, -1) : options.apiUrl
    const path =
      product === 'trello' ? `/cards/${encodeURIComponent(issue)}/attachments` : `/issue/${encodeURIComponent(issue)}/attachments`
    const body = yield* http.upload(Schema.Unknown, root + path, form, `multipart/form-data; boundary=${boundary}`)
    return { status: 201, body, next: null }
  })
