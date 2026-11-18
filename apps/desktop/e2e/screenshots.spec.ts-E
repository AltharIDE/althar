import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Shot } from '@althar/runtime'
import { expect, test } from '@playwright/test'

import { launch } from './support'

/*
 * A screenshot an agent asks for is of a page it names, over HTTP, and
 * stays there: the app's own window draws it, follows a redirect to another
 * address it may draw, and refuses a redirect to anything but HTTP — a
 * local file, say. The page that redirects is served here; what it points
 * to, a file on this computer, is never read, so the test needs no network.
 */

const away = 'file:///etc/passwd'
// A frame of the page going there stays empty, and the page is drawn around it.
const pages: Record<string, { status?: number; headers?: Record<string, string>; body?: string }> = {
  '/': { body: '<title>Meridian</title><h1>Meridian</h1>' },
  '/target': { body: '<title>Target</title><h1>Target</h1>' },
  '/redirect': { status: 302, headers: { location: '/target' } },
  '/tofile': { status: 302, headers: { location: away } },
  '/framed': { body: `<title>Framed</title><h1>Around a frame</h1><iframe src="${away}"></iframe>` },
}

test('a screenshot draws an HTTP page, follows a local redirect, and doesn’t follow it to anything else', async () => {
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
    // Another address over HTTP is drawn too, as screenshots may be of any page (ADR-097).
    expect(await take('/redirect')).toEqual({ title: 'Target', width: 640 })
    // Sent away to something that isn't HTTP, it is held: the shot ends there, before the file is read.
    expect(await take('/tofile')).toEqual({ error: "the page didn't load: ERR_UNSAFE_REDIRECT" })
    expect(await take('/framed')).toEqual({ title: 'Framed', width: 640 })
  } finally {
    await electronApp.close()
    server.close()
  }
})
