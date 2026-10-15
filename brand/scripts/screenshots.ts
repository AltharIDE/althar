/* Takes the screenshots in src/screenshots.ts into export/screenshots/. Builds the UI package's Storybook first if it
   isn't built (bun --filter @althar/ui build), then serves it, shows each story at its size on a dense screen, and
   saves what the browser drew. Motion is turned off so each is its settled state. Each is then framed, into
   export/screenshots/framed/: a whole screen as a window, a piece as a panel, standing on the Aurora wallpaper at night. */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { chromium } from '@playwright/test'

import { write } from '../src/files'
import { FRAME_WALLPAPER, type Screenshot, SCREENSHOTS, storyUrl } from '../src/screenshots'

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

/**
 * The box round what a story actually paints: its text, to the glyphs, and
 * anything with a fill, an edge or a picture. A story's own box is often wider
 * than what's in it, which would leave a piece off-centre in its frame.
 */
function painted(): { x: number; y: number; width: number; height: number } | null {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  const take = (r: DOMRect) => {
    if (r.width < 1 || r.height < 1) return
    x0 = Math.min(x0, r.left)
    y0 = Math.min(y0, r.top)
    x1 = Math.max(x1, r.right)
    y1 = Math.max(y1, r.bottom)
  }
  const root = document.querySelector('#storybook-root')
  if (!root) return null
  for (const el of root.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue
    /* Text kept for screen readers only sits in a 1px box, clipped away. */
    const own = el.getBoundingClientRect()
    if (own.width <= 1 || own.height <= 1) continue
    const edged = ['Top', 'Right', 'Bottom', 'Left'].some(
      (side) => parseFloat(cs.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0,
    )
    /* A fill in the page's own colour, like a story's frame, paints nothing you can see. */
    const box = own
    const ground = box.width >= innerWidth - 1 || cs.backgroundColor === getComputedStyle(document.body).backgroundColor
    const filled = (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && !ground) || cs.backgroundImage !== 'none' || cs.boxShadow !== 'none'
    if (edged || filled || el.tagName === 'svg' || el.tagName === 'IMG' || el.tagName === 'CANVAS') take(box)
    for (const node of el.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      take(range.getBoundingClientRect())
    }
  }
  return x1 > x0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null
}

/** The ground left round a cropped story, in CSS pixels. */
const MARGIN = 20

/** The wallpaper round a window, in CSS pixels: wide at the sides, more below, where the light comes up. */
const AROUND = { window: { x: 112, top: 80, bottom: 160 }, panel: { x: 56, top: 44, bottom: 88 } }
/** The bar drawn above a screen that has none of its own, in CSS pixels. */
const BAR = 30

const wallpaper = `data:image/jpeg;base64,${Buffer.from(await Bun.file(resolve(import.meta.dirname, '../export', FRAME_WALLPAPER)).arrayBuffer()).toString('base64')}`

/** The shot in a window (or a panel, for a piece), on the wallpaper, at the same density. */
async function framed(s: Screenshot, shot: Buffer, width: number, height: number): Promise<Buffer> {
  const around = s.crop ? AROUND.panel : AROUND.window
  const bar = s.bar ? BAR : 0
  const stage = { width: Math.ceil(width + 2 * around.x), height: Math.ceil(height + bar + around.top + around.bottom) }
  const tab = await browser.newPage({ viewport: stage, deviceScaleFactor: 2 })
  const dot = '<i style="width:12px;height:12px;border-radius:50%;background:rgba(20,20,28,0.16)"></i>'
  await tab.setContent(`<!doctype html><body style="margin:0">
    <div style="width:${stage.width}px;height:${stage.height}px;background:url(${wallpaper}) center bottom / cover;padding:${around.top}px ${around.x}px 0;box-sizing:border-box">
      <div style="border-radius:${s.crop ? 14 : 12}px;overflow:hidden;background:#f4f2ec;box-shadow:0 0 0 1px rgba(255,255,255,0.14),0 2px 6px rgba(0,0,0,0.2),0 30px 70px -18px rgba(0,0,0,0.6)">
        ${bar ? `<div style="height:${bar}px;display:flex;gap:8px;align-items:center;padding:0 14px;background:#ebe8e0;border-bottom:1px solid rgba(20,20,28,0.08);box-sizing:border-box">${dot.repeat(3)}</div>` : ''}
        <img src="data:image/png;base64,${shot.toString('base64')}" width="${width}" height="${height}" style="display:block" />
      </div>
    </div></body>`)
  await tab.waitForLoadState('load')
  /* JPEG, since the wallpaper's grain makes a PNG of it several times the size; at this density and quality the type stays sharp. */
  const out = await tab.screenshot({ type: 'jpeg', quality: 92 })
  await tab.close()
  return out
}

const only = process.argv.slice(2)
const browser = await chromium.launch()
try {
  for (const s of SCREENSHOTS.filter((s) => only.length === 0 || only.includes(s.file))) {
    const tab = await browser.newPage({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: 2, reducedMotion: 'reduce' })
    await tab.goto(storyUrl(`http://localhost:${server.port}`, s.story))
    await tab.evaluate(() => document.fonts.ready)
    await tab.waitForSelector('#storybook-root > *', { state: 'attached' })
    await tab.waitForTimeout(1500)
    const box = s.crop ? await tab.evaluate(painted) : null
    const clip = box
      ? {
          x: Math.max(0, Math.floor(box.x - MARGIN)),
          y: Math.max(0, Math.floor(box.y - MARGIN)),
          width: Math.ceil(box.width + 2 * MARGIN),
          height: Math.ceil(box.height + 2 * MARGIN),
        }
      : undefined
    const shot = await tab.screenshot(clip ? { type: 'png', clip } : { type: 'png' })
    await tab.close()
    await write(`screenshots/${s.file}.png`, shot)
    /* Its size as taken, from the PNG's header: a clip past the viewport's edge comes back smaller than asked. */
    await write(`screenshots/framed/${s.file}.jpg`, await framed(s, shot, shot.readUInt32BE(16) / 2, shot.readUInt32BE(20) / 2))
  }
} finally {
  await browser.close()
  await server.stop()
}

console.warn('screenshots: done')
