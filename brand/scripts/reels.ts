/* Records the reels in src/reels.ts into export/reels/ as GIFs. Serves the UI package's Storybook (building it first if
   it isn't built), and for each scene opens its story, takes frames of it as fast as the browser gives them while the
   pointer does the scene's steps, and keeps when each was taken. Transitions can be played slower while recording and
   sped back up, so a short one still gets its frames. ffmpeg then lays each scene on the reel's ground, cross-fades
   them, and writes the GIF with a palette of its own. */

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { chromium, type Page } from '@playwright/test'

import { write } from '../src/files'
import { FADE, type Reel, REELS, type Scene, type Step } from '../src/reels'
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
  return tab.getByRole('button', named).or(tab.getByRole('tab', named)).or(tab.getByRole('radio', named)).first()
}

async function act(tab: Page, step: Step, slow: number) {
  if ('wait' in step) await tab.waitForTimeout(step.wait / slow)
  else if ('click' in step) await button(tab, step.click).click()
  else if ('hover' in step) await button(tab, step.hover).hover()
  else await tab.mouse.move(4, 4)
}

/** One scene as a lossless video on the reel's ground, and how long it runs, in seconds. */
async function record(reel: Reel, scene: Scene, dir: string, index: number): Promise<{ file: string; seconds: number }> {
  const slow = scene.slow ?? 1
  const tab = await browser.newPage({ viewport: { width: scene.width, height: scene.height }, deviceScaleFactor: scene.density ?? 1 })
  await tab.goto(storyUrl(`http://localhost:${server.port}`, scene.story))
  await tab.evaluate(() => document.fonts.ready)
  await tab.waitForSelector('#storybook-root > *', { state: 'attached' })
  if (scene.css) await tab.addStyleTag({ content: scene.css.replaceAll('{wallpaper}', '/__wallpaper.jpg') })
  await tab.waitForTimeout(300)
  const cdp = await tab.context().newCDPSession(tab)
  await cdp.send('Animation.enable')
  await cdp.send('Animation.setPlaybackRate', { playbackRate: slow })

  const frames: { png: Buffer; at: number }[] = []
  let recording = true
  const clip = scene.region
  const taking = (async () => {
    while (recording) {
      const at = performance.now()
      frames.push({ png: await tab.screenshot(clip ? { type: 'png', clip } : { type: 'png' }), at })
    }
  })()
  try {
    for (const step of scene.steps) {
      await act(tab, step, slow).catch((error: unknown) => {
        throw new Error(`${scene.story}: ${JSON.stringify(step)} failed`, { cause: error })
      })
    }
  } finally {
    recording = false
    await taking
    await tab.close()
  }

  const frameDir = join(dir, `scene-${index}`)
  await mkdir(frameDir)
  const list: string[] = []
  let seconds = 0
  for (const [i, frame] of frames.entries()) {
    const next = frames[i + 1]?.at ?? frame.at + 40 / slow
    const lasts = ((next - frame.at) * slow) / 1000
    seconds += lasts
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
  return { file, seconds }
}

async function make(reel: Reel) {
  const dir = await mkdtemp(join(tmpdir(), `reel-${reel.file}-`))
  try {
    const scenes = []
    for (const [i, scene] of reel.scenes.entries()) scenes.push(await record(reel, scene, dir, i))

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
        `${joined}fps=16,split[a][b]`,
        '[a]palettegen=max_colors=256:stats_mode=diff[p]',
        '[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle',
      ].join(';'),
      '-loop',
      '0',
      gif,
    ])
    await write(`reels/${reel.file}.gif`, new Uint8Array(await Bun.file(gif).arrayBuffer()))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const only = process.argv.slice(2)
const browser = await chromium.launch()
try {
  for (const reel of REELS.filter((r) => only.length === 0 || only.includes(r.file))) await make(reel)
} finally {
  await browser.close()
  await server.stop()
}

console.warn('reels: done')
