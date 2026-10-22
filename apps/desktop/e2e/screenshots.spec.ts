import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Shot } from '@althar/runtime'
import { expect, test } from '@playwright/test'

import { launch } from './support'

/*
 * A screenshot an agent asks for is of a page on this computer, and stays
 * there: the app's own window draws a local page, and refuses a redirect, a
 * page sending itself, or a frame of it, to the internet. The page that
 * tries is served here; where it points, https://example.com, is never
 * fetched, so the test needs no network.
 */

const away = 'https://example.com/'
// A frame of the page going there stays empty, and the page is drawn around it.
const pages: Record<string, { status?: number; headers?: Record<string, string>; body?: string }> = {
  '/': { body: '<title>Meridian</title><h1>Meridian</h1>' },
  '/redirect': { status: 302, headers: { location: away } },
  '/leaves': { body: `<title>Leaves</title><script>location.href = '${away}'</script><h1>Still here</h1>` },
  '/framed': { body: `<title>Framed</title><h1>Around a frame</h1><iframe src="${away}"></iframe>` },
}

test('a screenshot draws a page on this computer, and doesn’t follow it to the internet', async () => {
  const server = createServer((request, response) => {
    const page = pages[request.url ?? ''] ?? { status: 404, body: 'none' }
    response.writeHead(page.status ?? 200, { 'content-type': 'text/html', ...page.headers })
    response.end(page.body ?? '')
  })
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening))
  const at = `http://localhost:${(server.address() as AddressInfo).port}`
  const { electronApp } = await launch(mkdtempSync(join(tmpdir(), 'althar-screenshots-')), { ALTHAR_NO_RUNTIME: '1' })
  const take = (path: string) =>
    electronApp.evaluate(
      async (_, shot) => {
        const taken = (globalThis as unknown as { takeScreenshot: (shot: Shot) => Promise<{ title: string; width: number }> })
          .takeScreenshot
        return taken(shot).then(
          ({ title, width }) => ({ title, width }),
          (error: Error) => ({ error: error.message }),
        )
      },
      { url: `${at}${path}`, width: 640, height: 400, fullPage: false, selector: null, origins: [] } satisfies Shot,
    )
  try {
    expect(await take('/')).toEqual({ title: 'Meridian', width: 640 })
    expect(await take('/redirect')).toEqual({
      error: `the page went on to ${away}, which isn't served on this computer, so Althar didn't follow it`,
    })
    // Sent away by the page itself, once it has loaded: held, it would draw nothing more, so the shot ends there.
    expect(await take('/leaves')).toEqual({
      error: `the page went on to ${away}, which isn't served on this computer, so Althar didn't follow it`,
    })
    expect(await take('/framed')).toEqual({ title: 'Framed', width: 640 })
  } finally {
    await electronApp.close()
    server.close()
  }
})
