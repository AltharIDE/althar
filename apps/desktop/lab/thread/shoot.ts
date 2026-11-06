import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium, type Page } from '@playwright/test'

/*
 * Shoots the thread lab (README.md), headless, at 1×, into lab/thread/shots (which git and the end-to-end run leave alone):
 *
 *   node lab/thread/shoot.ts shots <name> [scene] [theme] [width] [height]
 *     the opening view (scrolled to the end, as a task opens) and the whole thread
 *   node lab/thread/shoot.ts frames <name> [scene] [count] [every-ms] [theme]
 *     a sequence of the thread's end as it streams
 *   node lab/thread/shoot.ts timing [scene] [seconds]
 *     each frame's time while it streams: median, 95th and 99th percentile, worst, and frames over 16.7 ms
 *
 * With the lab running (Thread lab, on port 6131).
 */

const [mode = 'shots', name = 'shot', ...rest] = process.argv.slice(2)
const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const say = (line: string) => process.stdout.write(`${line}\n`)
const port = process.env.LAB_PORT ?? '6131'
const url = (scene: string, theme = 'light') => `http://localhost:${port}/?scene=${scene}&theme=${theme}`

const browser = await chromium.launch()
const open = async (scene: string, theme: string, width: number, height: number): Promise<Page> => {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('page:', message.text())
  })
  page.on('pageerror', (error) => console.error('page error:', error.message))
  await page.goto(url(scene, theme))
  await page.waitForSelector('section[aria-label="Thread"] > *')
  await page.waitForTimeout(600)
  return page
}

const scroller = (page: Page) => page.locator('section[aria-label="Thread"]').locator('xpath=ancestor::div[contains(@class, "scroll")][1]')

if (mode === 'shots') {
  const [scene = 'task', theme = 'light', width = '1000', height = '900'] = rest
  const page = await open(scene, theme, Number(width), Number(height))
  await page.screenshot({ path: join(out, `${name}-opening.png`) })
  // The whole thread: the window as tall as it is.
  const tall = await scroller(page).evaluate((el) => el.scrollHeight)
  await page.setViewportSize({ width: Number(width), height: Math.min(tall + 140, 16_000) })
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, `${name}-whole.png`) })
  say(`${name}: opening and whole (${tall}px of thread)`)
} else if (mode === 'frames') {
  const [scene = 'live', count = '12', every = '250', theme = 'light'] = rest
  const page = await open(scene, theme, 900, 620)
  for (let at = 0; at < Number(count); at++) {
    await page.screenshot({ path: join(out, `${name}-${String(at).padStart(2, '0')}.png`) })
    await page.waitForTimeout(Number(every))
  }
  say(`${name}: ${count} frames, every ${every} ms`)
} else if (mode === 'record') {
  // A video of the page as it plays, for `seconds`, at 1×: shots/<name>.webm.
  const [scene = 'live', seconds = '14', theme = 'light'] = rest
  const size = { width: 900, height: 620 }
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, recordVideo: { dir: out, size } })
  const page = await context.newPage()
  await page.goto(url(scene, theme))
  await page.waitForTimeout(Number(seconds) * 1000)
  const video = page.video()
  await context.close()
  if (video !== null) {
    const { rename } = await import('node:fs/promises')
    await rename(await video.path(), join(out, `${name}.webm`))
  }
  say(`${name}: ${seconds}s of ${scene}`)
} else if (mode === 'hold') {
  // Scrolled up from the end, as a thought folds below: where what the person reads stands, before and after.
  const page = await open('live', 'light', 900, 620)
  await page.getByRole('button', { name: /^Thinking/ }).waitFor()
  const scroll = scroller(page)
  await scroll.evaluate((el) => el.scrollBy(0, -260))
  await page.waitForTimeout(200)
  const anchor = page.getByText('Does the back-off survive a restart?')
  const before = (await anchor.boundingBox())?.y ?? 0
  const top = await scroll.evaluate((el) => el.scrollTop)
  await page
    .getByRole('button', { name: /^Thought/ })
    .last()
    .waitFor()
  await page.waitForTimeout(600)
  const after = (await anchor.boundingBox())?.y ?? 0
  say(
    `scrolled up: what it read moved ${(after - before).toFixed(1)}px as the thought folded (scrollTop ${top} → ${await scroll.evaluate((el) => el.scrollTop)})`,
  )
} else if (mode === 'timing') {
  const scene = name === 'shot' ? 'three' : name
  const seconds = Number(rest[0] ?? '20')
  const page = await open(scene, 'light', 1440, 900)
  // What the main thread spent, as Chromium counts it: all its tasks, and script, style and layout among them.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const metrics = async () =>
    Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((one) => [one.name, one.value])) as Record<string, number>
  await page.evaluate(() => window.lab.reset())
  const before = await metrics()
  await page.waitForTimeout(seconds * 1000)
  const after = await metrics()
  const frames = await page.evaluate(() => window.lab.frames.slice(1))
  const spent = (name: string) => ((after[name] ?? 0) - (before[name] ?? 0)) * 1000
  const sorted = [...frames].sort((a, b) => a - b)
  const pick = (share: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))]?.toFixed(1)
  const over = frames.filter((frame) => frame > 1000 / 60 + 1).length
  say(
    `${scene}, ${seconds}s, ${frames.length} frames: median ${pick(0.5)} ms, p95 ${pick(0.95)} ms, p99 ${pick(0.99)} ms, worst ${sorted.at(-1)?.toFixed(1)} ms, over 16.7 ms: ${over} (${((over / frames.length) * 100).toFixed(1)}%)`,
  )
  const busy = spent('TaskDuration')
  say(
    `  main thread busy ${((busy / (seconds * 1000)) * 100).toFixed(1)}% (${(busy / frames.length).toFixed(2)} ms a frame): script ${spent('ScriptDuration').toFixed(0)} ms, style ${spent('RecalcStyleDuration').toFixed(0)} ms, layout ${spent('LayoutDuration').toFixed(0)} ms`,
  )
}
await browser.close()
