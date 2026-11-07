import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize } from 'node:path'

import { chromium } from '@playwright/test'

/*
 * Times the frames while the divider between the conversation and the board
 * is dragged, on the page main.tsx draws (built by vite.config.ts into
 * test-results/dragBench). By hand, from apps/desktop:
 *
 *   bunx vp build --config tests/dragBench/vite.config.ts
 *   node tests/dragBench/run.ts [cpu slowdown, 1 by default] [runs, 3 by default] [the built page's folder]
 *
 * It drags as a hand does, a pointer move every 16 ms for two seconds, and
 * prints, for each run, the time between frames (median, p95, the worst), the
 * frames dropped, and where the renderer's main thread spent the drag:
 * scripts, style, layout, paint. Then it switches to another project's tab
 * and back, and says how long each took to show, and where it went.
 */

const FRAME = 1000 / 60
const MOVES = 120
const slowdown = Number(process.argv[2] ?? 1)
const runs = Number(process.argv[3] ?? 3)
const served = process.argv[4] ?? join(import.meta.dirname, '../../test-results/dragBench')

const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }
const server = createServer((request, response) => {
  const path = normalize(join(served, decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname)))
  const file = path.endsWith('/') ? join(path, 'index.html') : path
  readFile(file).then(
    (body) => response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(body),
    () => response.writeHead(404).end(),
  )
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`

interface TraceEvent {
  readonly name: string
  readonly ph: string
  readonly ts: number
  readonly dur?: number
  readonly tid: number
  readonly pid: number
  readonly args?: { readonly name?: string }
}

const quantile = (sorted: ReadonlyArray<number>, q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
const ms = (n: number) => Math.round(n * 10) / 10

/** What the page marks (performance.mark): where a drag or a switch starts and ends. */
const MARKS = new Set(['drag', 'dropped', 'switch', 'shown'])
const TRACED = ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.user_timing']
const SCRIPT = new Set(['EventDispatch', 'FunctionCall', 'TimerFire', 'FireAnimationFrame', 'RunMicrotasks', 'v8.run', 'ResizeObserver'])
const PAINT = new Set(['Paint', 'PrePaint', 'Layerize', 'UpdateLayerTree', 'PaintImage', 'Commit'])

/** Where the main thread went, in ms: scripts (outermost only, less the style and layout they forced), style, layout, paint. */
const breakdown = (events: ReadonlyArray<TraceEvent>) => {
  const main = events.find((event) => event.name === 'thread_name' && event.args?.name === 'CrRendererMain')
  // Only the drag: between the marks the page leaves as the pointer goes down and up.
  const marks = events.filter((event) => MARKS.has(event.name)).map((event) => event.ts)
  const from = marks[0] ?? 0
  const to = marks.at(-1) ?? Infinity
  const own = events
    .filter(
      (event) =>
        main !== undefined &&
        event.pid === main.pid &&
        event.tid === main.tid &&
        event.ph === 'X' &&
        event.dur !== undefined &&
        event.ts >= from &&
        event.ts <= to,
    )
    .toSorted((a, b) => a.ts - b.ts)
  const total = { script: 0, style: 0, layout: 0, paint: 0 }
  let scriptEnd = 0
  for (const event of own) {
    const dur = (event.dur ?? 0) / 1000
    if (event.name === 'UpdateLayoutTree') {
      total.style += dur
      if (event.ts < scriptEnd) total.script -= dur
    } else if (event.name === 'Layout') {
      total.layout += dur
      if (event.ts < scriptEnd) total.script -= dur
    } else if (PAINT.has(event.name)) total.paint += dur
    else if (SCRIPT.has(event.name) && event.ts >= scriptEnd) {
      total.script += dur
      scriptEnd = event.ts + (event.dur ?? 0)
    }
  }
  return total
}

const browser = await chromium.launch({ args: ['--enable-blink-features=LongAnimationFrameTiming'] })
const page = await browser.newPage({ viewport: { width: 3402, height: 1258 }, deviceScaleFactor: 1 })
page.on('pageerror', (error) => process.stderr.write(`page: ${error.message}\n`))
const cdp = await page.context().newCDPSession(page)
await page.goto(url)
const handle = page.getByRole('separator', { name: 'Width of the conversation' })
await handle.waitFor()
await page
  .getByText(/\(10\)$/)
  .first()
  .waitFor()
await page
  .locator('svg[id^="mermaid"], [class*="diagram"] svg')
  .first()
  .waitFor({ timeout: 20_000 })
  .catch(() => process.stderr.write('no diagram drawn\n'))
await page.waitForTimeout(1000)
await cdp.send('Emulation.setCPUThrottlingRate', { rate: slowdown })

const results = []
for (let run = 0; run < runs; run++) {
  const box = await handle.boundingBox()
  if (box === null) throw new Error('No divider')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.evaluate(() => {
    const frames: Array<number> = []
    const tick = (at: number) => {
      frames.push(at)
      if ((window as unknown as { frames_?: Array<number> }).frames_ === frames) requestAnimationFrame(tick)
    }
    Object.assign(window, { frames_: frames })
    requestAnimationFrame(tick)
  })
  await browser.startTracing(page, { categories: TRACED })
  await page.mouse.move(x, y)
  await page.evaluate(() => performance.mark('drag'))
  await page.mouse.down()
  const start = performance.now()
  for (let i = 1; i <= MOVES; i++) {
    // Out 600 px and back, twice, as a hand looks for the width.
    const phase = (i / MOVES) * 4
    const along = phase % 2 < 1 ? phase % 1 : 1 - (phase % 1)
    await page.mouse.move(x + along * 600, y)
    const wait = start + i * FRAME - performance.now()
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  }
  await page.mouse.up()
  // The frames until the width settles after the pointer lets go.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const frames = await page.evaluate(() => {
    const kept = (window as unknown as { frames_: Array<number> }).frames_
    Object.assign(window, { frames_: null })
    performance.mark('dropped')
    return kept
  })
  const trace = JSON.parse((await browser.stopTracing()).toString('utf8')) as { traceEvents: ReadonlyArray<TraceEvent> }
  const gaps = frames
    .slice(1)
    .map((at, i) => at - (frames[i] ?? at))
    .toSorted((a, b) => a - b)
  const dropped = gaps.reduce((sum, gap) => sum + Math.max(0, Math.round(gap / FRAME) - 1), 0)
  const spent = breakdown(trace.traceEvents)
  results.push({
    ms: ms((frames.at(-1) ?? 0) - (frames[0] ?? 0)),
    frames: gaps.length,
    median: ms(quantile(gaps, 0.5)),
    p95: ms(quantile(gaps, 0.95)),
    worst: ms(gaps.at(-1) ?? 0),
    dropped,
    perMove: {
      script: ms(spent.script / MOVES),
      style: ms(spent.style / MOVES),
      layout: ms(spent.layout / MOVES),
      paint: ms(spent.paint / MOVES),
    },
  })
  await page.waitForTimeout(500)
}

// Switching to the other project's tab and back, as kept screens are: from the switch to the frame that shows it.
const switches = []
for (const projectId of ['p2', 'p1', 'p2', 'p1']) {
  await browser.startTracing(page, { categories: TRACED })
  const took = await page.evaluate(
    (to) =>
      new Promise<number>((resolve) => {
        performance.mark('switch')
        const from = performance.now()
        ;(window as unknown as { showProject: (id: string) => void }).showProject(to)
        requestAnimationFrame(() =>
          setTimeout(() => {
            performance.mark('shown')
            resolve(performance.now() - from)
          }),
        )
      }),
    projectId,
  )
  const spent = breakdown(
    (JSON.parse((await browser.stopTracing()).toString('utf8')) as { traceEvents: ReadonlyArray<TraceEvent> }).traceEvents,
  )
  switches.push({
    to: projectId,
    ms: ms(took),
    script: ms(spent.script),
    style: ms(spent.style),
    layout: ms(spent.layout),
    paint: ms(spent.paint),
  })
  await page.waitForTimeout(800)
}
process.stdout.write(`${JSON.stringify({ slowdown, runs: results, switches }, null, 1)}\n`)
await browser.close()
server.close()
