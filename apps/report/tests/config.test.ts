import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import worker from '../src/index'
import { makeFakeLinear } from '../src/testing/fakeLinear'
import { API_KEY, envOf, formOf, post, run } from './support'

/*
 * The Worker's configuration: without the API key, the team, a usable API
 * address or the rate limits, it answers 500 and says which, never what a
 * value is, and asks nothing of Linear.
 */

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the configuration', () => {
  it.each([
    ['the API key', { LINEAR_API_KEY: undefined }, 'LINEAR_API_KEY is not set'],
    ['the API key, when blank', { LINEAR_API_KEY: '  ' }, 'LINEAR_API_KEY is not set'],
    ['the team', { LINEAR_TEAM_ID: undefined }, 'LINEAR_TEAM_ID is not set'],
    ['a usable API address', { LINEAR_API_URL: 'ftp://linear.test' }, 'LINEAR_API_URL is not an http or https address'],
    ['the per-install limit', { REPORTS_PER_INSTALL: undefined }, 'the REPORTS_PER_INSTALL rate limit is not bound'],
    ['the per-IP limit', { REPORTS_PER_IP: {} }, 'the REPORTS_PER_IP rate limit is not bound'],
  ])('answers 500 without %s', async (_, overrides, problem) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const linear = makeFakeLinear()
    const { response, body } = await run(post(formOf()), { env: envOf(overrides), linear })
    expect(response.status).toBe(500)
    expect(body).toEqual({ ok: false, error: `The report service isn't set up: ${problem}.` })
    expect(errors).toHaveBeenCalledWith('report: not configured', { problem })
    expect(linear.calls).toEqual([])
  })

  it('never says what the key is', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { text } = await run(post(formOf()), { env: envOf({ LINEAR_API_URL: `not a url ${API_KEY}` }) })
    expect(text).not.toContain(API_KEY)
  })

  it('reaches Linear at its own address and labels with "From the app" when nothing says otherwise', async () => {
    const linear = makeFakeLinear()
    const seen: Array<string> = []
    await run(post(formOf()), {
      env: envOf({ LINEAR_API_URL: undefined, LINEAR_LABEL: undefined }),
      linear,
      fetch: (input, init) => {
        seen.push(input)
        return linear.fetch(input.replace('https://api.linear.app', 'https://api.linear.test'), init)
      },
    })
    expect(new Set(seen)).toEqual(new Set(['https://api.linear.app/graphql']))
    expect(linear.calls.find((call) => call.operation === 'ReportLabel')?.variables).toEqual({ name: 'From the app' })
  })
})

describe('the Worker', () => {
  it('answers through the handler, with the environment the runtime gives it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await worker.fetch(post(formOf()), {})
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ ok: false, error: "The report service isn't set up: LINEAR_API_KEY is not set." })
  })

  it('answers 500 with no detail when something unforeseen fails', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const request = post(formOf())
    Object.defineProperty(request, 'body', {
      get: () => {
        throw new RangeError(`unforeseen, while reading ${API_KEY}`)
      },
    })
    const { response, body, text } = await run(request)
    expect(text).not.toContain(API_KEY)
    expect(JSON.stringify(errors.mock.calls)).not.toContain(API_KEY)
    expect(response.status).toBe(500)
    expect(body).toEqual({ ok: false, error: 'Something went wrong on the report service.' })
    expect(errors).toHaveBeenCalledWith('report: unexpected failure', { error: 'RangeError' })
  })
})
