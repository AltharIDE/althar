import { EventEmitter } from 'node:events'

import type { ClientRequest, ClientRequestConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'

import { type AppNet, appFetchOf } from '../src/runtime/appFetch'

/** A stand-in for Electron's net.request: it keeps what it was asked, and answers as `answer` says once ended. */
const fakeNet = (answer: (request: EventEmitter) => void) => {
  const asked: Array<{ options: ClientRequestConstructorOptions; headers: Record<string, string>; body: string; aborted: boolean }> = []
  const net: AppNet = {
    fetch: async () => new Response('fetched'),
    request: (options) => {
      const request = new EventEmitter()
      const seen = { options, headers: {} as Record<string, string>, body: '', aborted: false }
      asked.push(seen)
      Object.assign(request, {
        setHeader: (name: string, value: string) => (seen.headers[name] = value),
        write: (chunk: string) => (seen.body += chunk),
        end: () => queueMicrotask(() => answer(request)),
        abort: () => (seen.aborted = true),
      })
      return request as unknown as ClientRequest
    },
  }
  return { net, asked }
}

/** An answer as net.request gives one: its status and headers, then its body in chunks. */
const respond = (request: EventEmitter, status: number, headers: Record<string, string | Array<string>>, chunks: Array<string>) => {
  const response = new EventEmitter()
  Object.assign(response, { statusCode: status, statusMessage: '', headers })
  request.emit('response', response)
  for (const chunk of chunks) response.emit('data', Buffer.from(chunk))
  response.emit('end')
}

describe("the app's fetch", () => {
  it('leaves a call that follows its redirects to net.fetch', async () => {
    const { net, asked } = fakeNet(() => {})
    const fetched = vi.fn(async () => new Response('fetched'))
    const fetch = appFetchOf({ ...net, fetch: fetched })
    expect(await (await fetch('https://api.github.com/user', { headers: { authorization: 'Bearer t' } })).text()).toBe('fetched')
    expect(fetched).toHaveBeenCalledWith('https://api.github.com/user', { headers: { authorization: 'Bearer t' } })
    expect(asked).toHaveLength(0)
  })

  it('answers a redirect as itself, with where it leads, for a call that takes it itself', async () => {
    const blob = 'https://productionresultssa0.blob.core.windows.net/actions-results/log.txt?sig=s'
    const { net, asked } = fakeNet((request) => request.emit('redirect', 302, 'GET', blob, { 'x-github-request-id': ['1'] }))
    const answer = await appFetchOf(net)('https://api.github.com/repos/a/b/actions/jobs/1/logs', {
      redirect: 'manual',
      headers: { authorization: 'Bearer t', accept: '*/*' },
    })
    expect(answer.status).toBe(302)
    expect(answer.headers.get('location')).toBe(blob)
    expect(asked[0]?.options).toEqual({ url: 'https://api.github.com/repos/a/b/actions/jobs/1/logs', method: 'GET', redirect: 'manual' })
    expect(asked[0]?.headers).toEqual({ authorization: 'Bearer t', accept: '*/*' })
    // Not followed: the request ends there.
    expect(asked[0]?.aborted).toBe(true)
  })

  it('reads an answer that isn’t a redirect whole, with its status and headers', async () => {
    const { net, asked } = fakeNet((request) =>
      respond(request, 401, { 'content-type': 'application/xml', vary: ['a', 'b'] }, ['<Err', 'or/>']),
    )
    const answer = await appFetchOf(net)('https://storage.test/log', { method: 'POST', redirect: 'manual', body: '{"a":1}' })
    expect(answer.status).toBe(401)
    expect(await answer.text()).toBe('<Error/>')
    expect(answer.headers.get('content-type')).toBe('application/xml')
    expect(answer.headers.get('vary')).toBe('a, b')
    expect(asked[0]?.body).toBe('{"a":1}')
    const unchanged = fakeNet((request) => respond(request, 304, {}, []))
    expect((await appFetchOf(unchanged.net)('https://api.test/x', { redirect: 'manual' })).status).toBe(304)
  })

  it('fails as the network does, and stops when told to', async () => {
    const broken = fakeNet((request) => request.emit('error', new Error('net::ERR_NAME_NOT_RESOLVED')))
    await expect(appFetchOf(broken.net)('https://nowhere.test/', { redirect: 'manual' })).rejects.toThrow('ERR_NAME_NOT_RESOLVED')
    const silent = fakeNet(() => {})
    const stop = new AbortController()
    const call = appFetchOf(silent.net)('https://slow.test/', { redirect: 'manual', signal: stop.signal })
    stop.abort(new Error('timed out'))
    await expect(call).rejects.toThrow('timed out')
    expect(silent.asked[0]?.aborted).toBe(true)
  })
})
