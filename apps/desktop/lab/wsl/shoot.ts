import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from '@playwright/test'

import { DIRECTIONS, TOUCHPOINTS, variantsOf } from './catalog.ts'

/*
 * Shoots every scene of the WSL lab (README.md), headless, at 1×, the whole
 * window with the lab's bar under it, into lab/wsl/shots, light and dark:
 * <touchpoint>-<direction>-<state>-<theme>.png, and shots.md, their captions in order.
 *
 *   node lab/wsl/shoot.ts [filter]      # e.g. 3-a, or -b-, to shoot only those
 *
 * With the lab running (WSL lab, on port 6157). Chromium can't start in an agent's sandbox on a Mac: run it outside.
 */

const filter = process.argv[2] ?? ''
const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const lines: string[] = []
for (const theme of ['light', 'dark'] as const) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
  for (const touchpoint of TOUCHPOINTS) {
    for (const direction of DIRECTIONS) {
      for (const variant of variantsOf(direction.key, touchpoint.key)) {
        const name = `${touchpoint.key}-${direction.key}-${variant.key}-${theme}`
        if (!name.includes(filter)) continue
        const page = await context.newPage()
        page.on('pageerror', (error) => console.error(`${name}:`, error.message))
        await page.goto(
          `http://localhost:${process.env.LAB_PORT ?? '6157'}/?d=${direction.key}&t=${touchpoint.key}&x=${variant.key}&theme=${theme}`,
        )
        await page.waitForLoadState('networkidle')
        await page.evaluate(() => document.fonts.ready)
        await page.waitForTimeout(500)
        // What a dialog or menu focused as it opened shows no ring or tooltip: the person hasn't pressed a key yet.
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
        await page.waitForTimeout(150)
        await page.screenshot({ path: join(out, `${name}.png`) })
        await page.close()
        if (theme === 'light')
          lines.push(
            `- **${touchpoint.key} ${touchpoint.name} · ${direction.key.toUpperCase()} ${direction.name} · ${variant.label}** (${name}): ${variant.caption}`,
          )
        process.stdout.write(`${name}\n`)
      }
    }
  }
  await context.close()
}
if (filter === '') writeFileSync(join(out, 'shots.md'), `${lines.join('\n')}\n`)
await browser.close()
