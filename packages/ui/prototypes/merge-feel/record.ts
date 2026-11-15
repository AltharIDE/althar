import { execFileSync } from 'node:child_process'
import { mkdirSync, renameSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

// The desktop app holds Playwright; the kit doesn't.
const { chromium } = createRequire(join(import.meta.dirname, '../../../../apps/desktop/package.json'))('@playwright/test') as {
  chromium: { launch: () => Promise<any> }
}

/*
 * Records each direction as a GIF into shots/, with the page running on 6153:
 * the thread's card and Outputs, each pressed, taken into the queue and
 * landed; the board's four merged at once; and the boldest with less
 * motion. Run it outside an agent's sandbox, ffmpeg on the PATH:
 * node packages/ui/prototypes/merge-feel/record.ts [a,b,…] [crowd] [reduce] [sheet]
 */

const URL = 'http://localhost:6153/'
const out = join(import.meta.dirname, 'shots')
const tmp = join(out, 'video')
mkdirSync(tmp, { recursive: true })
const browser = await chromium.launch()
const SIZE = { width: 1280, height: 800 }
const which = (process.argv[2] ?? '0,a,b,c,d,e').split(',').filter(Boolean)
const extras = new Set(process.argv.slice(3))

interface Clip {
  x: number
  y: number
  w: number
  h: number
}

/** Plays a script on a fresh page, recording it, and makes the part of it in `clip` a GIF. */
interface Sheet {
  /** Seconds after the first press, and how long. */
  from: number
  dur: number
  clip: Clip
}

async function record(
  name: string,
  query: string,
  clipOf: (page: any) => Promise<Clip>,
  play: (page: any) => Promise<void>,
  sheetsOf: (page: any) => Promise<Sheet[]> = async () => [],
) {
  const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, recordVideo: { dir: tmp, size: SIZE } })
  const page = await context.newPage()
  const opened = Date.now()
  await page.goto(`${URL}?${query}&shot`)
  await page.waitForTimeout(900)
  const clip = await clipOf(page)
  const sheets = await sheetsOf(page)
  const start = (Date.now() - opened) / 1000
  await play(page)
  await page.waitForTimeout(300)
  await context.close()
  const video = join(tmp, `${name}.webm`)
  renameSync(await page.video().path(), video)
  const even = (n: number) => Math.round(n / 2) * 2
  const crop = `crop=${even(clip.w)}:${even(clip.h)}:${even(clip.x)}:${even(clip.y)}`
  const gif = join(out, `${name}.gif`)
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-ss',
    String(Math.max(0, start - 0.2)),
    '-i',
    video,
    '-vf',
    `${crop},fps=25,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`,
    gif,
  ])
  // For looking at the motion without playing it: twenty frames of each part, in a grid.
  if (extras.has('sheet'))
    sheets.forEach((one, i) => {
      const c = `crop=${even(one.clip.w)}:${even(one.clip.h)}:${even(one.clip.x)}:${even(one.clip.y)}`
      execFileSync('ffmpeg', [
        '-y',
        '-loglevel',
        'error',
        '-ss',
        String(start + one.from),
        '-t',
        String(one.dur),
        '-i',
        video,
        '-vf',
        `${c},fps=${20 / one.dur},scale=iw*0.4:-1,tile=5x4`,
        '-frames:v',
        '1',
        join(out, `${name}-sheet${i + 1}.png`),
      ])
    })
  process.stdout.write(`${gif}\n`)
}

const boxOf = async (page: any, selector: string, pad = 16): Promise<Clip> => {
  const b = await page.locator(selector).first().boundingBox()
  return { x: b.x - pad, y: b.y - pad, w: b.width + 2 * pad, h: b.height + 2 * pad }
}
const mergeIn = (page: any, section: string) => page.locator(section).getByRole('button', { name: /merge/i }).first()

// The thread's card, then Outputs: each pressed, taken into its queue, and landed on L, a quiet spell apart.
if (!extras.has('only'))
  for (const d of which)
    await record(
      `${d}-thread-outputs`,
      `d=${d}&manual`,
      async (page) => {
        const a = await boxOf(page, 'main > div', 18)
        return { ...a, w: a.w }
      },
      async (page) => {
        await mergeIn(page, 'main > div > section:nth-child(1)').click()
        await page.waitForTimeout(1500)
        await page.keyboard.press('l')
        await page.waitForTimeout(1800)
        await page.mouse.move(700, 760)
        await mergeIn(page, 'main > div > section:nth-child(2)').click()
        await page.waitForTimeout(1600)
        // A quiet spell after the thread's: this one lands in full too.
        await page.waitForTimeout(800)
        await page.keyboard.press('l')
        await page.waitForTimeout(1800)
      },
      async (page) => [
        { from: -0.05, dur: 3.1, clip: await boxOf(page, 'main > div > section:nth-child(1)', 14) },
        { from: 3.25, dur: 4.2, clip: await boxOf(page, 'main > div > section:nth-child(2)', 14) },
      ],
    )

// The board's four, merged one after another and landing together.
if (extras.has('crowd'))
  for (const d of which)
    await record(
      `${d}-crowd`,
      `d=${d}&manual`,
      (page) => boxOf(page, 'main > section', 18),
      async (page) => {
        await page.keyboard.press('m')
        await page.waitForTimeout(1900)
        await page.keyboard.press('l')
        await page.waitForTimeout(2000)
      },
      async (page) => [{ from: 1.7, dur: 1.6, clip: await boxOf(page, 'main > section', 14) }],
    )

// With less motion: what comes and goes only fades.
if (extras.has('reduce'))
  for (const d of which)
    await record(
      `${d}-reduced`,
      `d=${d}&manual&reduce`,
      (page) => boxOf(page, 'main > div > section:nth-child(1)', 18),
      async (page) => {
        await mergeIn(page, 'main > div > section:nth-child(1)').click()
        await page.waitForTimeout(1300)
        await page.keyboard.press('l')
        await page.waitForTimeout(1500)
      },
      async (page) => [{ from: -0.05, dur: 2.9, clip: await boxOf(page, 'main > div > section:nth-child(1)', 14) }],
    )

await browser.close()
rmSync(tmp, { recursive: true, force: true })
