#!/usr/bin/env node
/*
 * Screenshots of the app's screens, as the web export draws them, at a
 * phone's size: `bun run export:web && bun run shots [name…]`. Serves `dist`
 * on a port of its own, opens each screen in Chromium with the demo still
 * (`?live=0`), and saves `test-results/shots/<name>.png` at 1×.
 */
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const dist = path.join(root, 'dist')
const out = path.join(root, 'test-results', 'shots')
const port = Number(process.env.SHOTS_PORT ?? 8731)

/** Each shot: its name, its address, and what to do before shooting. */
const SHOTS = [
  { name: 'home', url: '/' },
  { name: 'home-dark', url: '/', theme: 'dark' },
  { name: 'home-away', url: '/?connection=away' },
  { name: 'home-unpaired', url: '/?connection=unpaired' },
  { name: 'home-outdated', url: '/?connection=outdated' },
  { name: 'home-full', url: '/', full: true },
  { name: 'call-permission', url: '/call/att_migrate' },
  { name: 'call-stuck', url: '/call/att_rounds' },
  { name: 'task-running', url: '/task/thr_task_backfill' },
  { name: 'task-running-dark', url: '/task/thr_task_backfill', theme: 'dark' },
  { name: 'task-ready', url: '/task/thr_task_stripe' },
  { name: 'task-finished', url: '/task/thr_task_flaky' },
  { name: 'task-ready-full', url: '/task/thr_task_stripe', full: true },
  { name: 'changes', url: '/task/thr_task_stripe/changes?taskId=task_stripe' },
  { name: 'diff', url: '/task/thr_task_stripe/diff?taskId=task_stripe&path=src%2Fwebhooks%2Fhandle.ts' },
  { name: 'diff-dark', url: '/task/thr_task_stripe/diff?taskId=task_stripe&path=src%2Fwebhooks%2Fhandle.ts', theme: 'dark' },
  { name: 'projects', url: '/projects' },
  { name: 'find', url: '/projects', type: { label: 'Find a task', text: 'webhook' } },
  { name: 'project', url: '/project/proj_meridian' },
  { name: 'talk', url: '/project/proj_meridian/talk' },
  { name: 'new-task', url: '/new' },
  { name: 'pair', url: '/pair' },
  { name: 'pair-verify', url: '/pair?step=verify' },
  { name: 'settings', url: '/settings' },
  { name: 'notifications', url: '/notifications' },
  { name: 'notifications-full', url: '/notifications', full: true },
  { name: 'diagnostics', url: '/diagnostics', press: 'Run the checks' },
]

const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.css': 'text/css',
}

const server = createServer((request, response) => {
  const asked = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
  let file = path.join(dist, asked)
  if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(dist, 'index.html')
  response.setHeader('content-type', types[path.extname(file)] ?? 'application/octet-stream')
  createReadStream(file).pipe(response)
})

const wanted = new Set(process.argv.slice(2))
const shots = SHOTS.filter((shot) => wanted.size === 0 || wanted.has(shot.name))

await new Promise((resolve) => server.listen(port, resolve))
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' })
try {
  for (const shot of shots) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: shot.theme ?? 'light' })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const separator = shot.url.includes('?') ? '&' : '?'
    await page.goto(`http://localhost:${port}${shot.url}${separator}live=0${shot.theme ? `&theme=${shot.theme}` : ''}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(700)
    if (shot.type) {
      await page.getByLabel(shot.type.label).fill(shot.type.text)
      await page.waitForTimeout(800)
    }
    if (shot.press) {
      await page.getByRole('button', { name: shot.press }).click()
      await page.waitForTimeout(2500)
    }
    if (shot.full) {
      /* A phone scrolls; to show a whole screen, the page grows to its content. */
      const height = await page.evaluate(() => Math.max(...[...document.querySelectorAll('div')].map((element) => element.scrollHeight)))
      await page.setViewportSize({ width: 390, height: Math.min(Math.max(height, 844), 4000) })
      await page.waitForTimeout(300)
    }
    await page.screenshot({ path: path.join(out, `${shot.name}.png`) })
    console.log(`${errors.length === 0 ? 'shot' : 'SHOT WITH ERRORS'} ${shot.name}${errors.length === 0 ? '' : `: ${errors.join(' | ')}`}`)
    await page.close()
  }
} finally {
  await browser.close()
  server.close()
}
