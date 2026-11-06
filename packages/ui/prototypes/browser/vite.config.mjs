import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * Scrappy: the real desktop app, on the tests' fake client, in a browser,
 * with a browser of Althar's own drawn in it three ways. The page in that
 * browser is the real Althar site, served here twice: as main runs it, and
 * as a task's branch changed it (site/RunsOn.tsx). An <iframe> stands in for
 * Electron's WebContentsView; the crops a comment carries are drawn by a
 * headless Chromium here (/__crop), as Electron's capturePage would draw
 * them. The seams swap a few imports of the real screens for this page
 * alone. Plain JavaScript, so the kit's type check leaves it out.
 */

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../../..')
const PORT = 5372

const seams = [
  // The window's tabs: in A, a page has a tab of its own after the projects'.
  { importer: 'features/tabs/TabsFrame.tsx', id: '@althar/ui', to: 'seams/tabsUi.ts' },
  // A task's header and its conversation's face: in B a Preview face, in C a Compare face.
  { importer: 'features/task/TaskView.tsx', id: '@althar/ui', to: 'seams/taskUi.ts' },
  // E: the coordinator's conversation and composer, with a page beside them.
  { importer: 'features/project/ProjectView.tsx', id: '@althar/ui', to: 'seams/projectUi.ts' },
  { importer: 'features/project/ProjectView.tsx', id: '../../shared/ThreadHost', to: 'seams/threadHost.tsx' },
  // Pictures by their digest: the crops and shots this server keeps, in place of the app's althar-picture: scheme.
  { importer: 'renderer/shared/evidence.ts', id: '../../main/pictureAddress', to: 'seams/pictureAddress.ts' },
  { importer: 'renderer/shared/images.ts', id: '../../main/pictureAddress', to: 'seams/pictureAddress.ts' },
  { importer: 'renderer/shared/handed.ts', id: '../../main/pictureAddress', to: 'seams/pictureAddress.ts' },
  // The site's band under its first screen: as the task's branch changed it, on the task's run.
  { importer: 'apps/site/src/home/Home.tsx', id: './bodies/RunsOn', to: 'site/RunsOn.tsx' },
]

/** @type {import('vite-plus').Plugin} */
const swap = {
  name: 'browser-seams',
  enforce: 'pre',
  resolveId(id, importer) {
    // deps.ts names the desktop's packages by path, for the types; they load as a desktop file loads them, so there is one copy.
    const desktops = /apps\/desktop\/node_modules\/(@tanstack\/react-(?:query|router))$/.exec(id)?.[1]
    if (desktops !== undefined) return this.resolve(desktops, resolve(repo, 'apps/desktop/src/renderer/main.tsx'), { skipSelf: true })
    const seam = seams.find((one) => one.id === id && importer?.split('?')[0]?.endsWith(one.importer))
    return seam === undefined ? null : resolve(here, seam.to)
  },
}

/*
 * The crops: a spot of a page, drawn by a headless Chromium at the viewport the
 * person saw it at, scrolled where they were. /__crop answers its digest; /__shot/<digest>
 * the picture. The lead's own shots (named, not hashed) are drawn the same way on first ask.
 */
const require = createRequire(resolve(repo, 'apps/desktop/package.json'))
let browser = null
const chromium = async () => {
  if (browser !== null) return browser
  const { chromium: engine } = require('@playwright/test')
  browser = await engine.launch()
  return browser
}
const pictures = new Map()

/** The lead's evidence on the task, and main's, as it took them: the band under the site's first screen. */
const SHOTS = {
  'lead-band-wide': { src: '/site.html?run=task&path=/&t=40', w: 1280, h: 800, scroll: 700, x: 0, y: 64, cw: 1280, ch: 148 },
  'lead-band-narrow': { src: '/site.html?run=task&path=/&t=40', w: 390, h: 844, scroll: 780, x: 0, y: 40, cw: 390, ch: 270 },
  'lead-band-wide-2': { src: '/site.html?run=task&path=/&t=40&rev=2', w: 1280, h: 800, scroll: 700, x: 0, y: 64, cw: 1280, ch: 176 },
  'lead-band-narrow-2': { src: '/site.html?run=task&path=/&t=40&rev=2', w: 390, h: 844, scroll: 780, x: 0, y: 40, cw: 390, ch: 290 },
  'main-band-wide': { src: '/site.html?run=main&path=/&t=40', w: 1280, h: 800, scroll: 700, x: 0, y: 64, cw: 1280, ch: 148 },
}

const draw = async ({ src, w, h, scroll, x, y, cw, ch }) => {
  const engine = await chromium()
  const page = await engine.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })
  try {
    await page.goto(`http://localhost:${PORT}${src}`, { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate((top) => {
      document.documentElement.style.scrollBehavior = 'auto'
      window.scrollTo(0, top)
    }, scroll)
    await page.waitForTimeout(500)
    const clip = { x: Math.max(0, x), y: Math.max(0, y), width: Math.max(8, Math.min(cw, w - x)), height: Math.max(8, Math.min(ch, h - y)) }
    return await page.screenshot({ clip })
  } finally {
    await page.close()
  }
}

/** @type {import('vite-plus').Plugin} */
const crops = {
  name: 'browser-crops',
  configureServer(server) {
    server.middlewares.use('/__crop', (req, res) => {
      const asked = new URL(req.url ?? '', 'http://localhost')
      const n = (key) => Number(asked.searchParams.get(key) ?? 0)
      const spec = {
        src: asked.searchParams.get('src') ?? '/',
        w: n('w'),
        h: n('h'),
        scroll: n('scroll'),
        x: n('x'),
        y: n('y'),
        cw: n('cw'),
        ch: n('ch'),
      }
      draw(spec).then(
        (png) => {
          const digest = createHash('sha256').update(png).digest('hex')
          pictures.set(digest, png)
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ digest, bytes: png.length, width: Math.round(spec.cw), height: Math.round(spec.ch) }))
        },
        (error) => {
          res.statusCode = 500
          res.end(String(error))
        },
      )
    })
    server.middlewares.use('/__shot', (req, res) => {
      const name = decodeURIComponent((req.url ?? '').replace(/^\//, '').split('?')[0] ?? '')
      const kept = pictures.get(name)
      const send = (png) => {
        res.setHeader('content-type', 'image/png')
        res.setHeader('cache-control', 'max-age=3600')
        res.end(png)
      }
      if (kept !== undefined) return send(kept)
      const spec = SHOTS[name]
      if (spec === undefined) {
        res.statusCode = 404
        return res.end()
      }
      draw(spec).then(
        (png) => {
          pictures.set(name, png)
          send(png)
        },
        (error) => {
          res.statusCode = 500
          res.end(String(error))
        },
      )
    })
  },
}

export default defineConfig({
  root: here,
  // Its own deps cache: other prototypes' servers share packages/ui's, and pre-bundle over each other.
  cacheDir: resolve(repo, 'packages/ui/node_modules/.vite-browser'),
  plugins: [swap, crops, react()],
  define: { 'import.meta.env.BUILT_ON': JSON.stringify(new Date().toISOString().slice(0, 10)) },
  resolve: {
    alias: [{ find: /^vitest$/, replacement: resolve(here, 'vi.ts') }],
    dedupe: ['react', 'react-dom', '@tanstack/react-query', '@tanstack/react-router'],
  },
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  // Polling, so a server started inside the sandbox still sees edits.
  server: { port: PORT, strictPort: true, fs: { allow: [repo] }, watch: { usePolling: true, interval: 1000 } },
})
