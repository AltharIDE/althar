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
 *   node lab/thread/shoot.ts moments <name> [theme] [live|coordinator]
 *     the live turn at each moment: thinking, at work on a thought, saying what it will do (the task's lead), its steps,
 *     answering, and over
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
  // Scrolled up from the end, as the round's work folds below it to its answer: where what the person reads stands, before and
  // after.
  const page = await open('live', 'light', 900, 620)
  await page.getByText(/^Searching /).waitFor({ timeout: 30_000 })
  const scroll = scroller(page)
  await scroll.evaluate((el) => el.scrollBy(0, -260))
  await page.waitForTimeout(200)
  const anchor = page.getByText('Does the back-off survive a restart?')
  const before = (await anchor.boundingBox())?.y ?? 0
  const top = await scroll.evaluate((el) => el.scrollTop)
  await page
    .getByRole('button', { name: /^Worked for/ })
    .last()
    .waitFor({ timeout: 30_000 })
  await page.waitForTimeout(600)
  const after = (await anchor.boundingBox())?.y ?? 0
  say(
    `scrolled up: what it read moved ${(after - before).toFixed(1)}px as the work folded (scrollTop ${top} → ${await scroll.evaluate((el) => el.scrollTop)})`,
  )
} else if (mode === 'moments') {
  // Each moment as it comes, waited for rather than timed, of the live turn alone.
  const [theme = 'light', scene = 'live'] = rest
  const page = await open(scene, theme, 900, 1300)
  const turn = page.locator(`article[aria-label="${scene === 'live' ? 'Claude Opus' : 'gpt-5.2'}"]`).last()
  const shot = async (moment: string) => {
    await turn.screenshot({ path: join(out, `${name}-${moment}.png`) })
    say(`${name}-${moment}`)
  }
  const wait = { timeout: 30_000 }
  await turn.getByRole('status').filter({ hasText: 'Thinking' }).waitFor(wait)
  await page.waitForTimeout(500)
  await shot('1-thinking')
  await turn.getByText('Checking how the merge line starts').waitFor(wait)
  await page.waitForTimeout(300)
  await shot('2-working')
  if (scene === 'live') {
    await turn.locator('[class*="fresh"]').first().waitFor(wait)
    await page.waitForTimeout(250)
    await shot('3-saying')
    await turn.getByText(/^Reading /).waitFor(wait)
    await page.waitForTimeout(500)
    await shot('4-reading')
    await turn.getByText(/^Searching /).waitFor(wait)
    await page.waitForTimeout(500)
    await shot('5-searching')
    await turn.getByRole('button', { name: /^Worked for/ }).waitFor(wait)
    await page.waitForTimeout(700)
    await shot('6-answering')
    await turn.getByText(/write the migration first, then the test/).waitFor(wait)
  } else {
    await turn.getByText(/^Using /).waitFor(wait)
    await page.waitForTimeout(300)
    await shot('3-using')
    await turn.locator('[class*="fresh"]').first().waitFor(wait)
    await page.waitForTimeout(900)
    await shot('4-answering')
    await turn.getByRole('button', { name: /^Worked for/ }).waitFor(wait)
  }
  await page.waitForTimeout(1200)
  await shot('7-over')
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
