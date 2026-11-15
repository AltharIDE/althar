import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from '@playwright/test'

/*
 * Shoots the gallery prototype at 1× into apps/site/test-results/gallery/,
 * with the site's dev server running on 5320. Run it outside an agent's
 * sandbox, from apps/site: node src/home/gallery/shoot.mjs [names…]
 */

const out = join(import.meta.dirname, '../../../test-results/gallery')
mkdirSync(out, { recursive: true })
const only = process.argv.slice(2)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })

const open = async (query, width = 1280, height = 900) => {
  await page.setViewportSize({ width, height })
  await page.goto(`http://localhost:5320/gallery?${query}&shot`)
  await page.waitForSelector('#gallery')
  await page.evaluate(() => document.fonts.ready)
}
/** The gallery's station alone, once it has come into view and its pictures have loaded. */
const station = async (name, settle = 900) => {
  // The site's nav floats over whatever is under it: out of a shot of the station alone.
  await page.addStyleTag({ content: '[class*="Nav-module__"], .skip { visibility: hidden !important; }' })
  const el = page.locator('#gallery')
  await el.scrollIntoViewIfNeeded()
  await page.evaluate(() => {
    const g = document.getElementById('gallery')
    window.scrollTo({ top: g.getBoundingClientRect().top + window.scrollY - 80, behavior: 'instant' })
  })
  await page.waitForFunction(() => [...document.querySelectorAll('#gallery img')].every((i) => i.complete || i.loading === 'lazy'))
  await page.waitForTimeout(settle)
  await el.screenshot({ path: join(out, `${name}.png`), animations: 'allow' })
}
/** The window as someone reading sees it, scrolled `by` past the gallery's top. */
const view = async (name, by = -120) => {
  await page.evaluate((by) => {
    const g = document.getElementById('gallery')
    window.scrollTo({ top: g.getBoundingClientRect().top + window.scrollY + by, behavior: 'instant' })
  }, by)
  await page.waitForTimeout(1200)
  await page.screenshot({ path: join(out, `${name}.png`) })
}

const shots = {
  bar: async () => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('http://localhost:5320/gallery?d=d&go')
    await page.waitForSelector('#gallery')
    await page.waitForTimeout(1500)
    await page.locator('nav[aria-label="Directions"]').screenshot({ path: join(out, 'bar.png') })
  },
  'a-tabs': async () => {
    await open('d=a')
    await station('a-tabs')
  },
  'a-in-place': async () => {
    await open('d=a')
    await view('a-in-place', -330)
  },
  'b-strip': async () => {
    await open('d=b')
    await station('b-strip')
  },
  'b-open': async () => {
    await open('d=b')
    await station('b-strip-tmp', 300)
    await page.locator('#gallery button[aria-label^="A browser"]').click()
    await page.waitForTimeout(700)
    await page.screenshot({ path: join(out, 'b-open.png') })
  },
  'c-film': async () => {
    await open('d=c')
    await station('c-film-tmp', 300)
    await page.getByRole('tab', { name: 'Build and try' }).click()
    await page.mouse.move(0, 0)
    await page.waitForTimeout(900)
    await page.locator('#gallery').screenshot({ path: join(out, 'c-film.png') })
  },
  'd-wall': async () => {
    await open('d=d')
    await page.evaluate(async () => {
      for (const img of document.querySelectorAll('#gallery img')) img.loading = 'eager'
    })
    await station('d-wall', 1500)
  },
  phone: async () => {
    for (const d of ['a', 'b', 'c', 'd']) {
      await open(`d=${d}`, 390, 844)
      if (d === 'd') await page.evaluate(() => document.querySelectorAll('#gallery img').forEach((img) => (img.loading = 'eager')))
      await station(`phone-${d}`, 1200)
    }
  },
}

for (const [name, take] of Object.entries(shots)) if (only.length === 0 || only.includes(name)) await take()
await browser.close()
