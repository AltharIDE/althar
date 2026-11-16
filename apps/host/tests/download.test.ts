import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { downloadRelease, getUpdateBytes, type UpdateFetch } from '../src/updates/network'
import { digest } from '../src/updates/release'
import { temporary } from './support'

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
      await expect(getUpdateBytes(url, 100, fetcher)).rejects.toThrow()
    const stop = new AbortController()
    stop.abort()
    await expect(getUpdateBytes(url, 100, async () => new Response('signed'), stop.signal)).rejects.toThrow()
    const file = join(temporary(), 'kept')
    writeFileSync(file, 'keep', { mode: 0o600 })
    await expect(downloadRelease({ url, bytes: 3_000_000_000, sha256: '' }, file)).rejects.toThrow()
    expect(readFileSync(file, 'utf8')).toBe('keep')
  })
})
