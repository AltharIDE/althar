import { describe, expect, it } from 'vite-plus/test'

import { sealUrl } from '@althar/ui/seal'

import worker, { seal } from '../worker/index'

/*
 * The site's Worker: it draws the review seal a pull request shows from the
 * seal's address, and hands everything else to the static site.
 */

const FACTS = { model: 'GPT-6.1 Sol', sha: '2f67c42', passes: 3, date: '2026-10-31' }

describe('the review seal on the site', () => {
  it('draws the seal its address asks for, as an image kept for good', async () => {
    const answer = seal(new Request(sealUrl('colophon', FACTS, 'dark')))
    expect(answer.status).toBe(200)
    expect(answer.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8')
    expect(answer.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(answer.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(answer.headers.get('x-content-type-options')).toBe('nosniff')
    const svg = await answer.text()
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
    expect(svg).toContain('aria-label="Reviewed by GPT-6.1 Sol in 3 passes, at 2f67c42"')
    expect(svg).toContain('#8a95ff')
  })

  it('says nothing in its body to a HEAD, and refuses any other method', async () => {
    const head = seal(new Request(sealUrl('ring', FACTS, 'light'), { method: 'HEAD' }))
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    const post = seal(new Request(sealUrl('ring', FACTS, 'light'), { method: 'POST' }))
    expect(post.status).toBe(405)
    expect(post.headers.get('allow')).toBe('GET, HEAD')
  })

  it('has no seal for an address it can’t say', async () => {
    for (const url of [
      'https://althar.ai/seal/',
      'https://althar.ai/seal/ring.svg',
      'https://althar.ai/seal/stamp.svg?model=A&sha=2f67c42&passes=1&date=2026-10-31',
      'https://althar.ai/seal/ring.svg?model=A&sha=2f67c42&passes=1&date=2026-13-01',
    ]) {
      const answer = seal(new Request(url))
      expect(answer.status).toBe(404)
      expect(answer.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    }
  })

  it('hands every other address to the static site', async () => {
    const asked: Array<string> = []
    const ASSETS = { fetch: async (request: Request) => (asked.push(new URL(request.url).pathname), new Response('page')) }
    expect(await (await worker.fetch(new Request('https://althar.ai/thesis'), { ASSETS })).text()).toBe('page')
    expect((await worker.fetch(new Request(sealUrl('wax', FACTS, 'light')), { ASSETS })).status).toBe(200)
    expect(asked).toEqual(['/thesis'])
  })
})
