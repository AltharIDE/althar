import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'

import { HostError } from '../errors'
import { httpsURL, MAX_ARCHIVE_BYTES } from './release'

export type UpdateFetch = (
  url: string,
  init: { readonly signal: AbortSignal; readonly redirect: 'manual'; readonly headers: Readonly<Record<string, string>> },
) => Promise<Response>
const unavailable = () =>
  new HostError({
    code: 'UpdateUnavailable',
    message:
      'The host update could not be downloaded completely. The installed release is unchanged; try again when the update source is available.',
  })
const response = async (url: string, signal: AbortSignal, fetcher: UpdateFetch) => {
  let current = httpsURL(url)
  for (let redirect = 0; redirect <= 5; redirect++) {
    const result = await fetcher(current.href, {
      signal,
      redirect: 'manual',
      headers: { 'Accept-Encoding': 'identity', 'User-Agent': 'Althar-host-updater/1' },
    })
    if ([301, 302, 303, 307, 308].includes(result.status)) {
      await result.body?.cancel()
      const target = result.headers.get('location')
      if (target === null) throw unavailable()
      current = httpsURL(new URL(target, current).href)
      continue
    }
    if (!result.ok || result.body === null) {
      await result.body?.cancel()
      throw unavailable()
    }
    return result
  }
  throw unavailable()
}
const bounded = async (
  url: string,
  maximum: number,
  signal: AbortSignal,
  fetcher: UpdateFetch,
  consume: (chunk: Uint8Array) => Promise<void>,
) => {
  const result = await response(url, signal, fetcher)
  const declared = result.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) {
    await result.body?.cancel()
    throw unavailable()
  }
  const reader = result.body?.getReader()
  if (reader === undefined) throw unavailable()
  let received = 0
  try {
    for (;;) {
      signal.throwIfAborted()
      const part = await reader.read()
      if (part.done) break
      received += part.value.length
      if (received > maximum) throw unavailable()
      await consume(part.value)
    }
    if (declared !== null && received !== Number(declared)) throw unavailable()
    return received
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export const getUpdateBytes = async (url: string, maximum: number, fetcher: UpdateFetch = fetch, signal?: AbortSignal) => {
  const stop = AbortSignal.any([AbortSignal.timeout(30_000), ...(signal === undefined ? [] : [signal])])
  try {
    const chunks: Uint8Array[] = []
    await bounded(url, maximum, stop, fetcher, async (chunk) => {
      chunks.push(chunk)
    })
    return Buffer.concat(chunks)
  } catch (error) {
    throw error instanceof HostError ? error : unavailable()
  }
}

/** Stream a signed, size-bound archive directly to a new private file; never replace an existing download. */
export const downloadRelease = async (
  archive: { readonly url: string; readonly bytes: number; readonly sha256: string },
  path: string,
  fetcher: UpdateFetch = fetch,
  signal?: AbortSignal,
) => {
  let file: fs.FileHandle | undefined
  let complete = false
  const stop = AbortSignal.any([AbortSignal.timeout(180_000), ...(signal === undefined ? [] : [signal])])
  try {
    if (archive.bytes < 1 || archive.bytes > MAX_ARCHIVE_BYTES) throw unavailable()
    file = await fs.open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    const writer = file
    const hash = createHash('sha256')
    const received = await bounded(archive.url, archive.bytes, stop, fetcher, async (chunk) => {
      hash.update(chunk)
      await writer.writeFile(chunk)
    })
    if (received !== archive.bytes || hash.digest('hex') !== archive.sha256)
      throw new HostError({
        code: 'ReleaseRejected',
        message: 'The downloaded host release does not match its authenticated digest and size. It will not be installed.',
      })
    await file.sync()
    await file.close()
    complete = true
  } catch (error) {
    throw error instanceof HostError ? error : unavailable()
  } finally {
    await file?.close().catch(() => undefined)
    if (file !== undefined && !complete) await fs.rm(path, { force: true }).catch(() => undefined)
  }
}
