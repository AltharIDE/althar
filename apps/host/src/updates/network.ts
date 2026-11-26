import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'

import { HostError } from '../errors'
import { httpsURL, MAX_ARCHIVE_BYTES } from './release'

export type UpdateFetch = (
  url: string,
  init: { readonly signal: AbortSignal; readonly redirect: 'manual'; readonly headers: Readonly<Record<string, string>> },
) => Promise<Response>

/** Waits between tries; tests pass one that doesn't. */
export type UpdatePause = (ms: number, signal: AbortSignal) => Promise<void>
const pause: UpdatePause = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })

/**
 * A fetch that didn't come through, by why: each said in a line the person reads (the updater's receipt, and the window
 * that asked for it), and what failed exactly written to the updater's journal. A lookup, a connection, a slow answer
 * or a server's own trouble may pass, so they're tried again; the rest won't.
 */
type Why =
  | { readonly kind: 'lookup' | 'connect' | 'slow' | 'partway' | 'unexpected'; readonly host: string }
  | { readonly kind: 'status'; readonly host: string; readonly status: number }
  | { readonly kind: 'limited'; readonly host: string }
class Failed extends Error {
  constructor(
    readonly why: Why,
    readonly raw: string,
  ) {
    super(raw)
  }
}
const KEPT = 'The installed release is unchanged.'
const lineFor = (why: Why) => {
  switch (why.kind) {
    case 'lookup':
      return `DNS didn’t answer for ${why.host}. ${KEPT}`
    case 'connect':
      return `Couldn’t connect to ${why.host}. ${KEPT}`
    case 'slow':
      return `${why.host} took too long to answer. ${KEPT}`
    case 'partway':
      return `The download from ${why.host} stopped partway. ${KEPT}`
    case 'limited':
      return `${why.host} is limiting requests from this computer. Try again in an hour. ${KEPT}`
    case 'status':
      return `${why.host} answered with HTTP ${why.status}. ${KEPT}`
    case 'unexpected':
      return `What ${why.host} sent isn’t an update this host takes. ${KEPT}`
  }
}
const passing = (why: Why) =>
  why.kind === 'lookup' || why.kind === 'connect' || why.kind === 'slow' || (why.kind === 'status' && why.status >= 500)

/** What the journal keeps of an error: its name, message and causes, with their codes. */
const rawOf = (error: unknown): string => {
  const parts: string[] = []
  let at: unknown = error
  for (let depth = 0; depth < 4 && at !== undefined && at !== null; depth++) {
    if (at instanceof Error) {
      const code = 'code' in at && typeof at.code === 'string' ? ` [${at.code}]` : ''
      parts.push(`${at.name}: ${at.message}${code}`)
      at = at.cause
    } else {
      parts.push(typeof at === 'string' ? at : JSON.stringify(at))
      break
    }
  }
  return parts.join(' <- ')
}
const LOOKUP = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL', 'EAI_NODATA'])
const SLOW = new Set(['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'])
/**
 * A thrown fetch, by why: undici puts the system's code on the cause. A name that didn't resolve, an answer that
 * didn't come in time, an answer cut off, and otherwise (refused, reset, TLS) a connection that didn't hold.
 */
const thrown = (error: unknown, host: string, started: boolean): Failed => {
  if (error instanceof Failed) return error
  const codes: string[] = []
  let at: unknown = error
  for (let depth = 0; depth < 4 && typeof at === 'object' && at !== null; depth++) {
    if ('code' in at && typeof at.code === 'string') codes.push(at.code)
    at = 'cause' in at ? at.cause : undefined
  }
  const timedOut = (error instanceof Error && error.name === 'TimeoutError') || codes.some((code) => SLOW.has(code))
  const kind = codes.some((code) => LOOKUP.has(code)) ? 'lookup' : timedOut ? 'slow' : started ? 'partway' : 'connect'
  return new Failed({ kind, host }, rawOf(error))
}

const response = async (url: string, signal: AbortSignal, fetcher: UpdateFetch) => {
  let current = httpsURL(url)
  for (let redirect = 0; redirect <= 5; redirect++) {
    let result: Response
    try {
      result = await fetcher(current.href, {
        signal,
        redirect: 'manual',
        headers: { 'Accept-Encoding': 'identity', 'User-Agent': 'Althar-host-updater/1' },
      })
    } catch (error) {
      throw thrown(error, current.host, false)
    }
    if ([301, 302, 303, 307, 308].includes(result.status)) {
      await result.body?.cancel()
      const target = result.headers.get('location')
      if (target === null) throw new Failed({ kind: 'unexpected', host: current.host }, `HTTP ${result.status} without a location`)
      try {
        current = httpsURL(new URL(target, current).href)
      } catch {
        throw new Failed({ kind: 'unexpected', host: current.host }, `redirected to a non-HTTPS address: ${target.slice(0, 200)}`)
      }
      continue
    }
    if (!result.ok || result.body === null) {
      await result.body?.cancel()
      const limited = result.status === 429 || (result.status === 403 && result.headers.get('x-ratelimit-remaining') === '0')
      throw new Failed(
        limited ? { kind: 'limited', host: current.host } : { kind: 'status', host: current.host, status: result.status },
        `HTTP ${result.status}${result.statusText === '' ? '' : ` ${result.statusText}`} from ${current.href}`,
      )
    }
    return { result, host: current.host }
  }
  throw new Failed({ kind: 'unexpected', host: current.host }, 'more than 5 redirects')
}
/** One try: its answer streamed into `consume`, bounded; `started` once a byte has gone to it. */
const bounded = async (
  url: string,
  maximum: number,
  signal: AbortSignal,
  fetcher: UpdateFetch,
  consume: (chunk: Uint8Array) => Promise<void>,
  progress: { started: boolean },
) => {
  const { result, host } = await response(url, signal, fetcher)
  const declared = result.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) {
    await result.body?.cancel()
    throw new Failed({ kind: 'unexpected', host }, `content-length ${declared.slice(0, 40)} over ${maximum}`)
  }
  const reader = result.body?.getReader()
  if (reader === undefined) throw new Failed({ kind: 'unexpected', host }, 'no body')
  let received = 0
  try {
    for (;;) {
      signal.throwIfAborted()
      let part: Awaited<ReturnType<typeof reader.read>>
      try {
        part = await reader.read()
      } catch (error) {
        throw thrown(error, host, true)
      }
      if (part.done) break
      received += part.value.length
      if (received > maximum) throw new Failed({ kind: 'unexpected', host }, `more than ${maximum} bytes`)
      progress.started = true
      await consume(part.value)
    }
    if (declared !== null && received !== Number(declared))
      throw new Failed({ kind: 'partway', host }, `received ${received} of ${declared} bytes`)
    return received
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

/** Seconds between tries: three in all. */
const AGAIN = [1_000, 4_000]

/**
 * Tries a fetch up to three times while what failed may pass and nothing of it was kept yet, each try with its own
 * time; a failure is said in a line, with what failed exactly in the journal, and aborting stops at once.
 */
const tried = async <A>(
  url: string,
  each: number,
  signal: AbortSignal | undefined,
  wait: UpdatePause,
  attempt: (stop: AbortSignal, progress: { started: boolean }) => Promise<A>,
): Promise<A> => {
  const host = (() => {
    try {
      return new URL(url).host
    } catch {
      return url.slice(0, 100)
    }
  })()
  for (let index = 0; ; index++) {
    const progress = { started: false }
    try {
      signal?.throwIfAborted()
      return await attempt(AbortSignal.any([AbortSignal.timeout(each), ...(signal === undefined ? [] : [signal])]), progress)
    } catch (error) {
      if (error instanceof HostError) throw error
      if (signal?.aborted === true) throw new HostError({ code: 'UpdateUnavailable', message: `The update was stopped. ${KEPT}` })
      const failed = thrown(error, host, progress.started)
      const again = passing(failed.why) && !progress.started && index < AGAIN.length
      process.stderr.write(`Host update: ${url.split('?')[0]}: ${failed.raw}${again ? '; trying again' : ''}\n`)
      if (!again) throw new HostError({ code: 'UpdateUnavailable', message: lineFor(failed.why) })
      await wait(AGAIN[index] ?? 0, signal ?? new AbortController().signal).catch(() => undefined)
    }
  }
}

export const getUpdateBytes = async (
  url: string,
  maximum: number,
  fetcher: UpdateFetch = fetch,
  signal?: AbortSignal,
  wait: UpdatePause = pause,
) =>
  tried(url, 30_000, signal, wait, async (stop, progress) => {
    const chunks: Uint8Array[] = []
    await bounded(
      url,
      maximum,
      stop,
      fetcher,
      async (chunk) => {
        chunks.push(chunk)
      },
      progress,
    )
    return Buffer.concat(chunks)
  })

/** Stream a signed, size-bound archive directly to a new private file; never replace an existing download. */
export const downloadRelease = async (
  archive: { readonly url: string; readonly bytes: number; readonly sha256: string },
  path: string,
  fetcher: UpdateFetch = fetch,
  signal?: AbortSignal,
  wait: UpdatePause = pause,
) => {
  let file: fs.FileHandle | undefined
  let complete = false
  try {
    if (archive.bytes < 1 || archive.bytes > MAX_ARCHIVE_BYTES)
      throw new HostError({ code: 'UpdateUnavailable', message: `The release is larger than a host update may be. ${KEPT}` })
    file = await fs.open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    const writer = file
    const hash = createHash('sha256')
    const received = await tried(archive.url, 180_000, signal, wait, (stop, progress) =>
      bounded(
        archive.url,
        archive.bytes,
        stop,
        fetcher,
        async (chunk) => {
          hash.update(chunk)
          await writer.writeFile(chunk)
        },
        progress,
      ),
    )
    if (received !== archive.bytes || hash.digest('hex') !== archive.sha256)
      throw new HostError({
        code: 'ReleaseRejected',
        message: 'The downloaded host release does not match its authenticated digest and size. It will not be installed.',
      })
    await file.sync()
    await file.close()
    complete = true
  } catch (error) {
    if (error instanceof HostError) throw error
    process.stderr.write(`Host update: ${archive.url.split('?')[0]}: ${rawOf(error)}\n`)
    throw new HostError({ code: 'UpdateUnavailable', message: `The release couldn’t be saved on this computer. ${KEPT}` })
  } finally {
    await file?.close().catch(() => undefined)
    if (file !== undefined && !complete) await fs.rm(path, { force: true }).catch(() => undefined)
  }
}
