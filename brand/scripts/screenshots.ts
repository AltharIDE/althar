/* Takes the screenshots in src/screenshots.ts into export/screenshots/. Builds the UI package's Storybook first if it
   isn't built (bun --filter @althar/ui build), then serves it, shows each story at 1440 × 900 on a dense screen, and
   saves what the browser drew. Motion is turned off so each is its settled state. */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { chromium } from '@playwright/test'

import { write } from '../src/files'
import { SCREENSHOTS, storyUrl } from '../src/screenshots'

const repo = resolve(import.meta.dirname, '../..')
const built = resolve(repo, 'packages/ui/dist/storybook')

if (!existsSync(resolve(built, 'index.json'))) {
  const build = Bun.spawnSync(['bun', '--filter', '@althar/ui', 'build'], { cwd: repo, stdout: 'inherit', stderr: 'inherit' })
  if (build.exitCode !== 0) throw new Error("the UI package's Storybook did not build")
}

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname
    const file = Bun.file(resolve(built, `.${path === '/' ? '/index.html' : path}`))
    return (await file.exists()) ? new Response(file) : new Response('not found', { status: 404 })
  },
})

const only = process.argv.slice(2)
const browser = await chromium.launch()
try {
  for (const s of SCREENSHOTS.filter((s) => only.length === 0 || only.includes(s.file))) {
    const tab = await browser.newPage({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: 2, reducedMotion: 'reduce' })
    await tab.goto(storyUrl(`http://localhost:${server.port}`, s.story))
    await tab.evaluate(() => document.fonts.ready)
    await tab.waitForSelector('#storybook-root > *', { state: 'attached' })
    await tab.waitForTimeout(1500)
    await write(`screenshots/${s.file}.png`, await tab.screenshot({ type: 'png' }))
    await tab.close()
  }
} finally {
  await browser.close()
  await server.stop()
}

console.warn('screenshots: done')
