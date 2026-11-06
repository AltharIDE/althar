// Scrappy: every shot in shots.json, headless, at 1×, into the task's scratch folder: node shoot.mjs [id…]
// A shot may clip to {x, y, width, height}. A step: a selector to click; key:<key>; type:<text>; wait:<ms>; hover:<x>,<y>; click:<x>,<y>; wheel:<dy>;
// in the page's frame (frame:main or frame:task picks which, task by default): scroll:<css>, point:<css>, pick:<css>.
import { mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '../../../..')
const require = createRequire(resolve(repo, 'apps/desktop/package.json'))
const { chromium } = require('@playwright/test')
const shots = JSON.parse(readFileSync(resolve(import.meta.dirname, 'shots.json'), 'utf8'))

const out = resolve(repo, '.althar/scratch/browser/shots')
mkdirSync(out, { recursive: true })
const only = process.argv.slice(2)
const PORT = process.env.PORT ?? 5372

const browser = await chromium.launch()
for (const shot of shots.filter((one) => only.length === 0 || only.includes(one.id))) {
  const page = await browser.newPage({ viewport: { width: shot.width ?? 1280, height: shot.height ?? 800 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.goto(`http://localhost:${PORT}/${shot.page}`)
  await page.waitForTimeout(2200)
  try {
    let which = 'task'
    const inFrame = async (css) => {
      const frame = await (await page.$(`iframe[src*="run=${which}"]`))?.contentFrame()
      const found = await frame?.$(css)
      if (found == null) throw new Error(`${shot.id}: no ${css} in the ${which} frame`)
      return found
    }
    for (const step of shot.steps ?? []) {
      if (step.startsWith('key:')) await page.keyboard.press(step.slice(4))
      else if (step.startsWith('type:')) await page.keyboard.type(step.slice(5), { delay: 4 })
      else if (step.startsWith('wait:')) await page.waitForTimeout(Number(step.slice(5)))
      else if (step.startsWith('wheel:')) await page.mouse.wheel(0, Number(step.slice(6)))
      else if (step.startsWith('frame:')) which = step.slice(6)
      else if (step.startsWith('over:')) await page.locator(step.slice(5)).first().hover()
      else if (step.startsWith('hover:')) {
        const [x, y] = step.slice(6).split(',').map(Number)
        await page.mouse.move(x, y)
      } else if (step.startsWith('click:')) {
        const [x, y] = step.slice(6).split(',').map(Number)
        await page.mouse.click(x, y)
      } else if (step.startsWith('scroll:')) {
        const [css, block = 'center'] = step.slice(7).split('|')
        await (await inFrame(css)).evaluate((el, at) => el.scrollIntoView({ block: at }), block)
      } else if (step.startsWith('point:') || step.startsWith('pick:')) {
        const css = step.slice(step.indexOf(':') + 1)
        const box = await (await inFrame(css)).boundingBox()
        const x = box.x + Math.min(box.width / 2, 60)
        const y = box.y + box.height / 2
        await page.mouse.move(x - 4, y - 2)
        await page.mouse.move(x, y)
        if (step.startsWith('pick:')) await page.mouse.click(x, y)
      } else await page.locator(step).first().click()
      await page.waitForTimeout(350)
    }
    await page.waitForTimeout(shot.settle ?? 400)
    await page.screenshot({ path: resolve(out, `${shot.id}.png`), ...(shot.clip ? { clip: shot.clip } : {}) })
    process.stdout.write(`${shot.id}  ${errors.length === 0 ? 'ok' : errors.join(' | ')}\n`)
  } catch (error) {
    process.stdout.write(`${shot.id}  failed: ${String(error).split('\n')[0]}\n`)
  }
  await page.close()
}
await browser.close()
