import type { Fetch } from '@althar/connectors'
import type { ClientRequest, ClientRequestConstructorOptions, IncomingMessage } from 'electron'

/** What of Electron's `net` the app's fetch is made from. */
export interface AppNet {
  fetch(input: string, init?: RequestInit): Promise<Response>
  request(options: ClientRequestConstructorOptions): ClientRequest
}

/** Statuses whose answer has no body: a Response made with one throws. */
const BODILESS = new Set([101, 204, 205, 304])

const headersOf = (said: Readonly<Record<string, string | ReadonlyArray<string>>>) => {
  const headers = new Headers()
  for (const [name, value] of Object.entries(said)) for (const one of typeof value === 'string' ? [value] : value) headers.append(name, one)
  return headers
}

/**
 * A call that takes a redirect itself, over `net.request`: what it answers
 * is the redirect as it is, with where it leads in its `Location`, as Node's
 * `fetch` answers one.
 */
const manually = (net: AppNet, url: string, init: RequestInit): Promise<Response> =>
  new Promise((resolve, reject) => {
    const request = net.request({ url, method: init.method ?? 'GET', redirect: 'manual' })
    let settled = false
    const settle = (end: () => void) => {
      if (settled) return
      settled = true
      init.signal?.removeEventListener('abort', aborted)
      end()
    }
    const aborted = () => {
      settle(() => reject(init.signal?.reason ?? new Error('The call was stopped')))
      request.abort()
    }
    if (init.signal?.aborted === true) return aborted()
    init.signal?.addEventListener('abort', aborted, { once: true })
    new Headers(init.headers).forEach((value, name) => request.setHeader(name, value))
    request.on('redirect', (status, _method, location, said) => {
      const headers = headersOf(said)
      headers.set('location', location)
      settle(() => resolve(new Response(null, { status, headers })))
      // Not followed: the caller follows it, signed in or not as where it leads says.
      request.abort()
    })
    request.on('response', (response: IncomingMessage) => {
      const chunks: Array<Buffer> = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('error', (error: Error) => settle(() => reject(error)))
      response.on('end', () =>
        settle(() =>
          resolve(
            new Response(BODILESS.has(response.statusCode) ? null : Buffer.concat(chunks), {
              status: response.statusCode,
              statusText: response.statusMessage,
              headers: headersOf(response.headers),
            }),
          ),
        ),
      )
    })
    request.on('error', (error) => settle(() => reject(error)))
    if (typeof init.body === 'string') request.write(init.body)
    request.end()
  })

/**
 * Code hosts and trackers are called over the app's own network, Chromium's:
 * it trusts the certificates in the Mac's keychain, as a company's own
 * GitLab, Bitbucket or Jira often needs, and the Mac's proxy settings.
 * Node's `fetch` knows neither.
 *
 * `net.fetch` follows a redirect with every header it was given, a token
 * included, to wherever it leads, and with `redirect: 'manual'` fails
 * ("Redirect was cancelled") without saying where. A call that asks to take
 * its redirects itself, as a log's does to leave its token behind at the
 * storage GitHub sends it to, goes over `net.request` instead.
 */
export const appFetchOf =
  (net: AppNet): Fetch =>
  (input, init) =>
    init?.redirect === 'manual' ? manually(net, input, init) : net.fetch(input, init)
