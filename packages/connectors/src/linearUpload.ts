import { Duration, Effect, Schema } from 'effect'

import type { ServiceApi } from './api'
import { ConnectorFailed } from './errors'
import type { Fetch } from './http'

const failed = (message: string) => new ConnectorFailed({ product: 'linear', reason: 'invalid_response', message })
const Prepared = Schema.Struct({
  result: Schema.Struct({
    success: Schema.Boolean,
    uploadFile: Schema.NullOr(
      Schema.Struct({
        uploadUrl: Schema.String,
        assetUrl: Schema.String,
        headers: Schema.Array(Schema.Struct({ key: Schema.String, value: Schema.String })),
      }),
    ),
  }),
})

/** Prepare, PUT without the Linear credential, then link the uploaded asset. The runtime owns the one receipt. */
export const uploadLinearAttachment = (
  api: ServiceApi,
  fetch: Fetch,
  issue: string,
  filename: string,
  mediaType: string,
  bytes: Uint8Array,
) =>
  Effect.gen(function* () {
    if (bytes.byteLength > 5 * 1024 * 1024)
      return yield* new ConnectorFailed({ product: 'linear', reason: 'rejected', message: 'An issue attachment is at most 5 MiB.' })
    const prepared = yield* api.request({
      query:
        'mutation($name: String!, $type: String!, $size: Int!) { result: fileUpload(filename: $name, contentType: $type, size: $size) { success uploadFile { uploadUrl assetUrl headers { key value } } } }',
      variables: { name: filename, type: mediaType, size: bytes.byteLength },
    })
    const { result } = yield* Schema.decodeUnknownEffect(Prepared)(prepared.body).pipe(
      Effect.mapError(() => failed('Linear did not return an upload destination.')),
    )
    if (!result.success || result.uploadFile === null) return yield* failed('Linear did not prepare the attachment upload.')
    const file = result.uploadFile
    const url = yield* Effect.try({ try: () => new URL(file.uploadUrl), catch: () => failed('Linear returned an invalid upload URL.') })
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      !/(?:^|\.)(?:linear\.app|amazonaws\.com|googleapis\.com)$/.test(url.hostname)
    )
      return yield* failed('Linear returned an unsupported upload destination.')
    const headers: Record<string, string> = { 'content-type': mediaType }
    for (const header of file.headers) {
      if (!/^(?:content-type|cache-control|content-disposition|x-amz-[a-z0-9-]+|x-goog-[a-z0-9-]+)$/i.test(header.key))
        return yield* failed('Linear returned an unsupported upload header.')
      headers[header.key] = header.value
    }
    yield* Effect.tryPromise({
      try: async (signal) => {
        const answer = await fetch(url.href, { method: 'PUT', headers, body: Uint8Array.from(bytes), redirect: 'error', signal })
        if (!answer.ok) throw new Error(`Attachment storage returned ${answer.status}.`)
        await answer.body?.cancel()
      },
      catch: () => failed('The attachment upload did not finish; it has not been linked to the issue.'),
    }).pipe(Effect.timeoutOrElse({ duration: Duration.seconds(30), orElse: () => Effect.fail(failed('The attachment upload timed out.')) }))
    return yield* api.request({
      query: 'mutation($input: AttachmentCreateInput!) { result: attachmentCreate(input: $input) { success attachment { id title url } } }',
      variables: { input: { issueId: issue, title: filename, url: file.assetUrl } },
    })
  })
