import type { Fetch } from '../src/http'

/*
 * A stand-in for `fetch`: routes by method and URL to canned answers, and
 * keeps every request, so a test checks both what an adapter asked and what
 * it made of the answer.
 */

export interface Sent {
  readonly method: string
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: unknown
}

export interface Answer {
  readonly status?: number
  readonly headers?: Readonly<Record<string, string>>
  /** JSON, or text as it is. */
  readonly json?: unknown
  readonly text?: string
}

export type Route = readonly [method: string, url: string | RegExp, answer: Answer | ((sent: Sent) => Answer)]

export const stubFetch = (routes: ReadonlyArray<Route>) => {
  const sent: Array<Sent> = []
  const fetch: Fetch = async (input, init = {}) => {
    const method = init.method ?? 'GET'
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>).map(([key, value]) => [key.toLowerCase(), value]),
    )
    const raw = typeof init.body === 'string' ? init.body : undefined
    let body: unknown = raw
    if (raw !== undefined) {
      try {
        body = JSON.parse(raw)
      } catch {
        body = Object.fromEntries(new URLSearchParams(raw))
      }
    }
    const request: Sent = { method, url: input, headers, body }
    sent.push(request)
    const route = routes.find(([m, url]) => m === method && (typeof url === 'string' ? url === input : url.test(input)))
    if (route === undefined) return new Response(JSON.stringify({ message: `No route for ${method} ${input}` }), { status: 404 })
    const answer = typeof route[2] === 'function' ? route[2](request) : route[2]
    const status = answer.status ?? 200
    const text = answer.text ?? (answer.json === undefined ? '' : JSON.stringify(answer.json))
    return new Response(status === 204 || status === 304 ? null : text, { status, headers: answer.headers ?? {} })
  }
  return { fetch, sent }
}

/** A GraphQL request's variables. */
export const variablesOf = (request: Sent | undefined): unknown =>
  typeof request?.body === 'object' && request.body !== null && 'variables' in request.body ? request.body.variables : undefined
