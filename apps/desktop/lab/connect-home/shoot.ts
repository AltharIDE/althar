import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from '@playwright/test'

/*
 * Shoots the Connect a home lab (README.md), headless, at 1×, into lab/connect-home/shots: each direction's scenes, the
 * dialog alone, and a sheet of each direction's scenes side by side.
 *
 *   node lab/connect-home/shoot.ts <name> [direction…]     directions: 0 a
 *
 * With the lab running (Connect a home lab, on port 6141). THEME=dark draws them dark.
 */

const [name = 'shot', ...asked] = process.argv.slice(2)
const directions = asked.length > 0 ? asked : ['0', 'a']
const theme = process.env.THEME ?? 'light'
const SCENES = [
  { label: 'First home', m: 'pair', s: 'intro', first: true },
  { label: 'Set up: over SSH', m: 'pair', s: 'setup', first: true },
  { label: 'Set up: one command', m: 'pair', s: 'setup-line', first: true },
  { label: 'Installing over SSH', m: 'pair', s: 'installing', first: true },
  { label: 'Pairing code', m: 'pair', s: 'form' },
  { label: 'Code read', m: 'pair', s: 'found' },
  { label: 'Code refused', m: 'pair', s: 'refused' },
  { label: 'SSH host typed', m: 'ssh', s: 'draft' },
  { label: 'Checking', m: 'ssh', s: 'checking' },
  { label: 'Unreachable', m: 'ssh', s: 'refused' },
  { label: 'Found, to compare', m: 'ssh', s: 'found' },
  { label: 'Connecting', m: 'ssh', s: 'connecting' },
] as const
const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
for (const d of directions) {
  const files: Array<{ label: string; file: string }> = []
  for (const scene of SCENES) {
    if (d === '0' && 'first' in scene) continue
    const page = await browser.newPage({ viewport: { width: 1000, height: 760 }, deviceScaleFactor: 1 })
    page.on('pageerror', (error) => console.error(`${d} ${scene.s}:`, error.message))
    const first = 'first' in scene ? '&first=1' : ''
    await page.goto(`http://localhost:${process.env.LAB_PORT ?? '6141'}/?d=${d}&m=${scene.m}&s=${scene.s}${first}&theme=${theme}`)
    await page.waitForSelector('body[data-driven]')
    await page.waitForTimeout(scene.s === 'intro' ? 3800 : 900)
    const file = join(out, `${name}-${d}-${scene.m}-${scene.s}-${theme}.png`)
    await page.getByRole('dialog').screenshot({ path: file })
    files.push({ label: scene.label, file })
    await page.close()
  }
  const page = await browser.newPage({ viewport: { width: 1600, height: 400 }, deviceScaleFactor: 1 })
  const width = d === 'c' ? 520 : 400
  const cells = files
    .map(
      ({ label, file }) =>
        `<figure><figcaption>${label}</figcaption><img src="data:image/png;base64,${readFileSync(file).toString('base64')}"></figure>`,
    )
    .join('')
  await page.setContent(
    `<style>body{margin:0;padding:16px;background:${theme === 'dark' ? '#222' : '#ddd'};font:12px sans-serif;color:${theme === 'dark' ? '#eee' : '#222'};display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}figure{margin:0}img{display:block;width:${width}px}</style>${cells}`,
  )
  await page.screenshot({ path: join(out, `${name}-${d}-sheet-${theme}.png`), fullPage: true })
  await page.close()
}
await browser.close()
process.stdout.write(`${directions.join(', ')} shot in ${out}\n`)
