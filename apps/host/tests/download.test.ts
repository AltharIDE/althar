import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { downloadRelease, downloadTime, getUpdateBytes, type UpdateFetch, type UpdatePause } from '../src/updates/network'
import { digest } from '../src/updates/release'
import { temporary } from './support'

const now: UpdatePause = async () => undefined

describe('bounded release downloads', () => {
  it('streams and authenticates a complete release without replacing an existing file', async () => {
    const data = Buffer.from('a complete release')
    const archive = { url: 'https://updates.example/archive', bytes: data.length, sha256: digest(data) }
    const file = join(temporary(), 'release')
    const fetcher: UpdateFetch = async () => new Response(data, { headers: { 'Content-Length': String(data.length) } })
    await downloadRelease(archive, file, fetcher)
    expect(readFileSync(file)).toEqual(data)
    await expect(downloadRelease(archive, file, fetcher)).rejects.toMatchObject({ code: 'UpdateUnavailable' })
    expect(readFileSync(file)).toEqual(data)
    expect(await getUpdateBytes(archive.url, 100, fetcher)).toEqual(data)
  })

  it('removes incomplete or tampered downloads and bounds missing-length responses', async () => {
    const at = temporary()
    const archive = { url: 'https://updates.example/archive', bytes: 10, sha256: digest(Buffer.alloc(10)) }
    for (const [name, body] of [
      ['short', 'small'],
      ['large', 'much too large'],
      ['wrong', 'ten bytes!'],
    ]) {
      const file = join(at, name ?? 'missing')
      await expect(downloadRelease(archive, file, async () => new Response(body))).rejects.toThrow()
      expect(existsSync(file)).toBe(false)
    }
    await expect(getUpdateBytes(archive.url, 3, async () => new Response('too large'))).rejects.toThrow()
    await expect(getUpdateBytes(archive.url, 3, async () => new Response('x', { headers: { 'Content-Length': '900' } }))).rejects.toThrow()
    await expect(getUpdateBytes(archive.url, 10, async () => new Response('x', { headers: { 'Content-Length': '2' } }))).rejects.toThrow()
  })

  it('follows only bounded HTTPS redirects and handles offline, HTTP failures and cancellation', async () => {
    const url = 'https://updates.example/feed'
    let asked = 0
    const redirect: UpdateFetch = async () => {
      asked++
      return asked === 1 ? new Response(null, { status: 302, headers: { location: 'https://cdn.example/feed' } }) : new Response('signed')
    }
    expect((await getUpdateBytes(url, 100, redirect)).toString()).toBe('signed')
    for (const fetcher of [
      async () => new Response(null, { status: 302, headers: { location: 'http://insecure.example' } }),
      async () => new Response(null, { status: 302 }),
      async () => new Response(null, { status: 302, headers: { location: url } }),
      async () => new Response('unavailable', { status: 503 }),
      async () => {
        throw new Error('offline')
      },
    ])
      await expect(getUpdateBytes(url, 100, fetcher, undefined, now)).rejects.toThrow()
    const stop = new AbortController()
    stop.abort()
    await expect(getUpdateBytes(url, 100, async () => new Response('signed'), stop.signal)).rejects.toThrow()
    const file = join(temporary(), 'kept')
    writeFileSync(file, 'keep', { mode: 0o600 })
    await expect(downloadRelease({ url, bytes: 3_000_000_000, sha256: '' }, file)).rejects.toThrow()
    expect(readFileSync(file, 'utf8')).toBe('keep')
  })

  /** What undici throws where a name doesn't resolve: the system's code on the cause. */
  const unresolved = (host: string) =>
    Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' }),
    })

  it('tries a lookup that failed again, as a flaky DNS server drops some', async () => {
    const journal = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    let asked = 0
    const flaky: UpdateFetch = async () => {
      asked++
      if (asked < 3) throw unresolved('api.github.com')
      return new Response('listed')
    }
    expect((await getUpdateBytes('https://api.github.com/repos/a/b/releases', 100, flaky, undefined, now)).toString()).toBe('listed')
    expect(asked).toBe(3)
    expect(journal).toHaveBeenCalledWith(expect.stringContaining('ENOTFOUND api.github.com [ENOTFOUND]; trying again'))
    journal.mockRestore()
  })

  it('says in a line why a fetch failed, with the raw error in the journal', async () => {
    const journal = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const url = 'https://api.github.com/repos/a/b/releases?page=1'
    const failing = async (fetcher: UpdateFetch) => {
      const error: unknown = await getUpdateBytes(url, 100, fetcher, undefined, now).catch((caught: unknown) => caught)
      return error instanceof Error ? error.message : String(error)
    }
    let asked = 0
    const counted =
      (answer: () => Promise<Response>): UpdateFetch =>
      () => {
        asked++
        return answer()
      }

    expect(await failing(counted(async () => Promise.reject(unresolved('api.github.com'))))).toBe(
      'DNS didn’t answer for api.github.com. The installed release is unchanged.',
    )
    expect(asked).toBe(3)
    expect(journal).toHaveBeenLastCalledWith(
      'Host update: https://api.github.com/repos/a/b/releases: TypeError: fetch failed <- Error: getaddrinfo ENOTFOUND api.github.com [ENOTFOUND]\n',
    )

    asked = 0
    const refused = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    })
    expect(await failing(counted(async () => Promise.reject(refused)))).toBe(
      'Couldn’t connect to api.github.com. The installed release is unchanged.',
    )
    expect(asked).toBe(3)

    asked = 0
    expect(await failing(counted(async () => new Response('busy', { status: 502 })))).toBe(
      'api.github.com answered with HTTP 502. The installed release is unchanged.',
    )
    expect(asked).toBe(3)

    // What won't pass by trying again is said at once.
    asked = 0
    expect(await failing(counted(async () => new Response('gone', { status: 404 })))).toBe(
      'api.github.com answered with HTTP 404. The installed release is unchanged.',
    )
    expect(asked).toBe(1)
    asked = 0
    expect(await failing(counted(async () => new Response('limited', { status: 403, headers: { 'x-ratelimit-remaining': '0' } })))).toBe(
      'api.github.com is limiting requests from this computer. Try again in an hour. The installed release is unchanged.',
    )
    expect(asked).toBe(1)
    asked = 0
    expect(await failing(counted(async () => new Response('x', { headers: { 'Content-Length': '2' } })))).toBe(
      'The download from api.github.com stopped partway. The installed release is unchanged.',
    )
    expect(asked).toBe(1)
    expect(
      await failing(async () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
      }),
    ).toBe('api.github.com took too long to answer. The installed release is unchanged.')
    journal.mockRestore()
  })

  it('downloads a release past a lookup that failed, and starts afresh only where nothing was kept', async () => {
    const journal = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const data = Buffer.from('a complete release')
    const archive = { url: 'https://release-assets.example/archive', bytes: data.length, sha256: digest(data) }
    const file = join(temporary(), 'release')
    let asked = 0
    await downloadRelease(
      archive,
      file,
      async () => {
        asked++
        if (asked === 1) throw unresolved('release-assets.example')
        return new Response(data, { headers: { 'Content-Length': String(data.length) } })
      },
      undefined,
      now,
    )
    expect(asked).toBe(2)
    expect(readFileSync(file)).toEqual(data)
    journal.mockRestore()
  })

  it('gives a large release the time it takes on a slow line, and says how far it has come', async () => {
    expect(downloadTime(1_000)).toBe(180_000)
    // 143 MB, Claude Code's program, at 128 KiB/s: over 18 minutes, not three.
    expect(downloadTime(143_000_000)).toBe(1_092_000)
    const data = Buffer.alloc(200_000, 7)
    const archive = { url: 'https://updates.example/part', bytes: data.length, sha256: digest(data) }
    const said: number[] = []
    await downloadRelease(
      archive,
      join(temporary(), 'part'),
      async () => new Response(data),
      undefined,
      now,
      (bytes) => said.push(bytes),
    )
    expect(said.at(-1)).toBe(data.length)
    expect(said.every((bytes, at) => at === 0 || bytes > (said[at - 1] ?? 0))).toBe(true)
  })

  it('says a server’s own words for a status, a body that stalled, and what isn’t an error as it was thrown', async () => {
    const journal = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const url = 'https://updates.example/feed'
    const failing = (fetcher: UpdateFetch) =>
      getUpdateBytes(url, 100, fetcher, undefined, now).catch((caught: unknown) =>
        caught instanceof Error ? caught.message : String(caught),
      )
    expect(await failing(async () => new Response('gone', { status: 410, statusText: 'Gone' }))).toBe(
      'updates.example answered with HTTP 410. The installed release is unchanged.',
    )
    expect(journal).toHaveBeenLastCalledWith('Host update: https://updates.example/feed: HTTP 410 Gone from https://updates.example/feed\n')
    const stalled = Object.assign(new TypeError('terminated'), {
      cause: Object.assign(new Error('body timeout'), { code: 'UND_ERR_BODY_TIMEOUT' }),
    })
    expect(await failing(async () => Promise.reject(stalled))).toBe(
      'updates.example took too long to answer. The installed release is unchanged.',
    )
    expect(await failing(async () => Promise.reject('a plain string'))).toBe(
      'Couldn’t connect to updates.example. The installed release is unchanged.',
    )
    expect(journal).toHaveBeenLastCalledWith('Host update: https://updates.example/feed: a plain string\n')
    journal.mockRestore()
  })

  it('tries again under the caller’s own signal, and stops at once where it is aborted', async () => {
    const control = new AbortController()
    let asked = 0
    const flaky: UpdateFetch = async () => (++asked === 1 ? new Response('busy', { status: 503 }) : new Response('ok'))
    expect((await getUpdateBytes('https://updates.example/feed', 100, flaky, control.signal, now)).toString()).toBe('ok')
    expect(asked).toBe(2)
    control.abort()
    await expect(getUpdateBytes('https://updates.example/feed', 100, flaky, control.signal, now)).rejects.toMatchObject({
      code: 'UpdateUnavailable',
      message: 'The update was stopped. The installed release is unchanged.',
    })
  })
})
