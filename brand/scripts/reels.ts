/* Records the reels in src/reels.ts into export/reels/ as GIFs. Serves the UI package's Storybook (building it first if
   it isn't built), and for each scene opens its story, takes frames of it as fast as the browser gives them while the
   pointer does the scene's steps, and keeps when each was taken. Transitions can be played slower while recording and
   sped back up, so a short one still gets its frames. ffmpeg then lays each scene on the reel's ground, cross-fades
   them, and writes the GIF with a palette of its own. A scene can draw a pointer that glides to what a step clicks, and
   each reel can be recorded in the app's light and its dark. */

import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { chromium, type Page } from '@playwright/test'

import { write } from '../src/files'
import { FADE, type Reel, REELS, type Scene, type Step, type Theme } from '../src/reels'
import { storyUrl } from '../src/screenshots'

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
    if (path === '/__wallpaper.jpg')
      return new Response(Bun.file(resolve(import.meta.dirname, '../export/wallpaper/aurora-light-display.jpg')))
    if (path === '/__wallpaper-dark.jpg')
      return new Response(Bun.file(resolve(import.meta.dirname, '../export/wallpaper/aurora-dark-display.jpg')))
    const file = Bun.file(resolve(built, `.${path === '/' ? '/index.html' : path}`))
    return (await file.exists()) ? new Response(file) : new Response('not found', { status: 404 })
  },
})

const ffmpeg = (args: string[]) => {
  const run = Bun.spawnSync(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', ...args])
  if (run.exitCode !== 0) throw new Error(`ffmpeg failed: ${run.stderr.toString()}`)
}

/** A button, a tab or a choice, by the start of its name. */
const button = (tab: Page, name: string) => {
  const named = { name: new RegExp(`^${name}`) }
  return tab
    .getByRole('button', named)
    .or(tab.getByRole('tab', named))
    .or(tab.getByRole('radio', named))
    .or(tab.getByRole('menuitem', named))
    .or(tab.getByRole('menuitemradio', named))
    .or(tab.getByRole('menuitemcheckbox', named))
    .or(tab.getByRole('option', named))
    .first()
}

/** The pointer a scene draws: an arrow that follows the mouse, and a ring that spreads where it presses. Lives in the page, so the frames show it. */
const POINTER = `
  #__pointer { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; will-change: transform; }
  #__pointer svg { display: block; margin: -2px 0 0 -3px; filter: drop-shadow(0 1px 1.5px rgba(0,0,0,.3)); }
  .__ring { position: fixed; z-index: 2147483646; pointer-events: none; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%;
    border: 2px solid #4a67e8; background: rgba(74,103,232,.18); animation: __ring .5s ease-out forwards; }
  @keyframes __ring { from { transform: scale(.3); opacity: .95 } to { transform: scale(1.15); opacity: 0 } }`
const drawPointer = () => {
  const pointer = document.createElement('div')
  pointer.id = '__pointer'
  pointer.innerHTML =
    '<svg width="22" height="26" viewBox="0 0 22 26"><path d="M3 2v18l4.6-4.3 3.1 7.2 3-1.3-3.1-7.1 6.3-.5z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>'
  pointer.style.transform = 'translate(-60px,-60px)'
  document.body.appendChild(pointer)
  addEventListener(
    'mousemove',
    (e) => {
      const { clientX, clientY } = e as MouseEvent
      /* a story's own play function sends events too, at the page's corner: only the mouse's are the pointer's */
      if (!e.isTrusted) return
      pointer.style.transform = `translate(${clientX}px,${clientY}px)`
    },
    true,
  )
  addEventListener(
    'mousedown',
    (e) => {
      if (!e.isTrusted) return
      const { clientX, clientY } = e as MouseEvent
      const ring = document.createElement('div')
      ring.className = '__ring'
      ring.style.left = `${clientX}px`
      ring.style.top = `${clientY}px`
      document.body.appendChild(ring)
      setTimeout(() => ring.remove(), 600)
    },
    true,
  )
}

const ease = (t: number) => 1 - (1 - t) ** 3

/** Where the pointer is, for the glide to start from. */
const rest = new WeakMap<Page, { x: number; y: number }>()

/** Move the pointer to a point over `ms`, easing out, a few events at a time so every frame has it somewhere on the way. */
async function glide(tab: Page, to: { x: number; y: number }, slow: number, ms = 420) {
  const from = rest.get(tab) ?? to
  const n = Math.max(4, Math.round(ms / 45))
  for (let i = 1; i <= n; i++) {
    const t = ease(i / n)
    await tab.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)
    await tab.waitForTimeout(ms / n / slow)
  }
  rest.set(tab, to)
}

/** The middle of what a step names, scrolled into view. */
async function centre(tab: Page, name: string) {
  const target = button(tab, name)
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  if (!box) throw new Error(`no box for ${name}`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function act(tab: Page, step: Step, slow: number, cursor: boolean) {
  if ('wait' in step) await tab.waitForTimeout(step.wait / slow)
  else if ('click' in step) {
    if (cursor) {
      await glide(tab, await centre(tab, step.click), slow)
      await tab.waitForTimeout(120 / slow)
      await button(tab, step.click).click({ delay: 70 / slow })
    } else await button(tab, step.click).click()
  } else if ('hover' in step) {
    if (cursor) await glide(tab, await centre(tab, step.hover), slow)
    else await button(tab, step.hover).hover()
  } else if ('type' in step) await tab.keyboard.type(step.type, { delay: 55 / slow })
  else if ('press' in step) await tab.keyboard.press(step.press)
  else {
    if (cursor) await glide(tab, { x: 4, y: 4 }, slow, 300)
    else await tab.mouse.move(4, 4)
  }
}

/** One scene as a lossless video on the reel's ground, and how long it runs, in seconds. */
async function record(reel: Reel, theme: Theme, scene: Scene, dir: string, index: number): Promise<{ file: string; seconds: number }> {
  const slow = scene.slow ?? 1
  const tab = await browser.newPage({
    viewport: { width: scene.width, height: scene.height },
    deviceScaleFactor: preview ? 1 : (scene.density ?? 1),
  })
  await tab.goto(storyUrl(`http://localhost:${server.port}`, scene.story, theme))
  await tab.evaluate(() => document.fonts.ready)
  await tab.waitForSelector('#storybook-root > *', { state: 'attached' })
  const css = theme === 'dark' ? (scene.cssDark ?? scene.css) : scene.css
  if (css)
    await tab.addStyleTag({ content: css.replaceAll('{wallpaper}', theme === 'dark' ? '/__wallpaper-dark.jpg' : '/__wallpaper.jpg') })
  if (scene.cursor) {
    await tab.addStyleTag({ content: POINTER })
    await tab.evaluate(drawPointer)
    const { width, height } = scene.region ?? scene
    /* it comes in from the region's lower right, where it is out of the frame */
    const edge = scene.region ? { x: scene.region.x + width + 30, y: scene.region.y + height + 30 } : { x: width - 4, y: height - 4 }
    const start = { x: Math.min(edge.x, scene.width - 2), y: Math.min(edge.y, scene.height - 2) }
    rest.set(tab, start)
    /* the real mouse starts there too, or the first frames draw the pointer at the page's corner */
    await tab.mouse.move(start.x, start.y)
  }
  await tab.waitForTimeout(300)
  const cdp = await tab.context().newCDPSession(tab)
  await cdp.send('Animation.enable')
  await cdp.send('Animation.setPlaybackRate', { playbackRate: slow })
  for (const step of scene.prelude ?? []) await act(tab, step, slow, scene.cursor ?? false)

  const frames: { png: Buffer; at: number }[] = []
  /* what stays as it was keeps the frame it had, for longer, rather than being drawn and stored again */
  const keep = (png: Buffer, at: number) => {
    if (!frames.at(-1)?.png.equals(png)) frames.push({ png, at })
  }
  let recording = true
  let endAt = 0
  const clip = scene.region
  const taking = (async () => {
    while (recording) {
      const at = performance.now()
      keep(await tab.screenshot(clip ? { type: 'png', clip } : { type: 'png' }), at)
    }
  })()
  try {
    for (const step of scene.steps) {
      if (process.env.REELS_LOG) console.warn(`  ${scene.story} ${JSON.stringify(step)} at ${Math.round(performance.now())}`)
      await act(tab, step, slow, scene.cursor ?? false).catch((error: unknown) => {
        throw new Error(`${scene.story}: ${JSON.stringify(step)} failed`, { cause: error })
      })
    }
  } finally {
    recording = false
    endAt = performance.now()
    /* a shot still being taken may not come back (a popover closing under it): the scene ends where its steps did */
    await Promise.race([taking, new Promise((done) => setTimeout(done, 4000))])
    await tab.close()
  }

  const frameDir = join(dir, `scene-${index}`)
  await mkdir(frameDir)
  const list: string[] = []
  let seconds = 0
  for (const [i, frame] of frames.entries()) {
    const next = frames[i + 1]?.at ?? Math.max(endAt, frame.at + 40 / slow)
    const lasts = ((next - frame.at) * slow) / 1000
    seconds += lasts
    if (process.env.REELS_LOG && lasts > 1.5)
      console.warn(
        `  frame ${i}/${frames.length} lasts ${lasts.toFixed(1)} s (at ${Math.round(frame.at)}, next ${Math.round(next)}, end ${Math.round(endAt)})`,
      )
    const name = join(frameDir, `${String(i).padStart(5, '0')}.png`)
    await writeFile(name, frame.png)
    list.push(`file '${name}'`, `duration ${lasts.toFixed(4)}`)
  }
  /* the concat demuxer takes the last file's duration only if it is listed again */
  list.push(list.at(-2) ?? '')
  await writeFile(join(frameDir, 'list.txt'), list.join('\n'))

  const file = join(dir, `scene-${index}.mkv`)
  const { width, height, ground } = reel
  ffmpeg([
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    join(frameDir, 'list.txt'),
    '-vf',
    `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${ground},fps=25,format=rgb24`,
    '-c:v',
    'ffv1',
    file,
  ])
  /* REELS_KEEP=folder keeps each scene's lossless take there, to try other palettes and frame rates on it with ffmpeg */
  if (process.env.REELS_KEEP) {
    await mkdir(process.env.REELS_KEEP, { recursive: true })
    await copyFile(file, join(process.env.REELS_KEEP, `${reel.file}-${theme}-${index}.mkv`))
  }
  return { file, seconds }
}

async function make(reel: Reel, theme: Theme) {
  const dir = await mkdtemp(join(tmpdir(), `reel-${reel.file}-`))
  try {
    const scenes = []
    for (const [i, scene] of reel.scenes.entries()) scenes.push(await record(reel, theme, scene, dir, i))

    /* each scene fades into the next; the offset is where the fade starts, on the joined timeline */
    const chain: string[] = []
    let offset = 0
    let last = '[0:v]'
    for (let i = 1; i < scenes.length; i++) {
      offset += (scenes[i - 1]?.seconds ?? 0) - FADE
      const out = i === scenes.length - 1 ? '[joined]' : `[x${i}]`
      chain.push(`${last}[${i}:v]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(3)}${out}`)
      last = out
    }
    const joined = scenes.length > 1 ? '[joined]' : '[0:v]'
    const gif = join(dir, `${reel.file}.gif`)
    ffmpeg([
      ...scenes.flatMap((s) => ['-i', s.file]),
      '-filter_complex',
      [
        ...chain,
        `${joined}fps=${reel.fps ?? 16},split[a][b]`,
        `[a]palettegen=max_colors=${reel.colors ?? 256}:stats_mode=diff[p]`,
        `[b][p]paletteuse=dither=${reel.dither ?? 'sierra2_4a'}:diff_mode=rectangle`,
      ].join(';'),
      '-loop',
      '0',
      gif,
    ])
    const bytes = new Uint8Array(await Bun.file(gif).arrayBuffer())
    const name = theme === 'dark' ? `${reel.file}-dark` : reel.file
    if (preview) {
      await mkdir(resolve(repo, 'test-results/reels'), { recursive: true })
      await writeFile(resolve(repo, `test-results/reels/${name}.gif`), bytes)
    } else await write(`reels/${name}.gif`, bytes)
    console.warn(`reels: ${name}.gif ${(bytes.length / 1024).toFixed(0)} KB`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/* REELS_PREVIEW=1: the light only, at a density of 1, into test-results/reels, to try a crop or a step quickly */
const preview = process.env.REELS_PREVIEW === '1'
const only = process.argv.slice(2)
const browser = await chromium.launch()
try {
  for (const reel of REELS.filter((r) => only.length === 0 || only.includes(r.file)))
    for (const theme of preview ? (['light'] as const) : (reel.themes ?? (['light'] as const))) await make(reel, theme)
} finally {
  await browser.close()
  await server.stop()
}

console.warn('reels: done')
