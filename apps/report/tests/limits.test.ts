import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { makeFakeLinear } from '../src/testing/fakeLinear'
import { INSTALL_ID, IP, envOf, fakeLimit, formOf, post, run } from './support'

/*
 * The rate limits: per IP address before the body is read, per install once
 * the report is checked. Over either, the answer is 429 with Retry-After,
 * and nothing goes to Linear.
 */

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the rate limits', () => {
  it('turn away an address over its limit before reading the report', async () => {
    const perIp = fakeLimit(false)
    const perInstall = fakeLimit()
    const linear = makeFakeLinear()
    const { response, body } = await run(post(formOf()), { env: envOf({ REPORTS_PER_IP: perIp, REPORTS_PER_INSTALL: perInstall }), linear })
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    expect(body).toEqual({ ok: false, error: 'Too many reports. Try again in a minute.' })
    expect(perIp.keys).toEqual([IP])
    expect(perInstall.keys).toEqual([])
    expect(linear.calls).toEqual([])
  })

  it('turn away an install over its limit', async () => {
    const perInstall = fakeLimit(false)
    const linear = makeFakeLinear()
    const { response } = await run(post(formOf()), { env: envOf({ REPORTS_PER_INSTALL: perInstall }), linear })
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    expect(perInstall.keys).toEqual([INSTALL_ID])
    expect(linear.calls).toEqual([])
  })

  it('count a request with no client address under one shared key', async () => {
    const perIp = fakeLimit()
    const request = new Request('https://report.test/reports', { method: 'POST', body: formOf() })
    const { response } = await run(request, { env: envOf({ REPORTS_PER_IP: perIp }) })
    expect(response.status).toBe(201)
    expect(perIp.keys).toEqual(['unknown'])
  })

  it('let a report through when a limiter itself fails, and log it', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = { limit: () => Promise.reject(new Error('binding unavailable')) }
    const { response } = await run(post(formOf()), { env: envOf({ REPORTS_PER_INSTALL: broken }) })
    expect(response.status).toBe(201)
    expect(errors).toHaveBeenCalledWith('report: rate limit failed, letting the report through', { limit: 'install', error: 'Error' })
  })
})
