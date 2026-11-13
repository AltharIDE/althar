import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, sizeWindow, still } from './support'

// A real process, advanced by the spec rather than by a timer: every batch
// arrives after the preceding one has reached the console through polling.
const SERVER = `let line = 0
require('node:http').createServer((req, res) => {
  const count = Number(new URL(req.url, 'http://localhost').searchParams.get('count') || 0)
  for (let i = 0; i < count; i++) console.log('line ' + String(++line).padStart(4, '0') + ' ' + 'x'.repeat(117))
  res.end(String(line))
}).listen(0, function () {
  console.log('Local: http://localhost:' + this.address().port + '/')
})
process.once('SIGTERM', () => process.stdout.write('FINAL shutdown\\n', () => process.exit(0)))
`

test('a real run crosses its output tail limit over several polls, follows, holds the reader’s place and reads its shutdown', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'meridian', private: true, scripts: { dev: 'node serve.cjs' } }))
  writeFileSync(join(repo, 'serve.cjs'), SERVER)
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 't@althar.test',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 't@althar.test',
  }
  execFileSync('git', ['add', '.'], { cwd: repo, env })
  execFileSync('git', ['commit', '-q', '-m', 'Serve output in batches'], { cwd: repo, env })
  const { electronApp, page } = await launch(home)
  try {
    await sizeWindow(electronApp, page, 1440, 1000)
    await openFirstProject(electronApp, page, repo)
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    await page.getByRole('dialog', { name: 'What it runs' }).getByRole('button', { name: 'Run npm run dev' }).click()
    await page.keyboard.press('Escape')
    const card = page.getByRole('article', { name: 'Run of main' })
    const open = card.getByRole('button', { name: /^Open localhost:\d+$/ })
    await expect(open).toBeVisible()
    const address = (await open.getAttribute('aria-label'))?.replace('Open ', '') ?? ''
    await card.getByRole('button', { name: 'Output' }).click()
    const output = page.getByRole('dialog', { name: 'Output of npm run dev' })
    const printed = output.locator('pre')
    const scroller = output.locator('[class*="scroll"]').first()
    await expect(output).toContainText(`http://${address}/`)
    const gap = () => scroller.evaluate((el) => Math.round(el.scrollHeight - el.scrollTop - el.clientHeight))
    const line = (i: number) => `line ${String(i).padStart(4, '0')} ${'x'.repeat(117)}\n`
    let all = ''
    let count = 0
    const tail = () => all.slice(-16_384).split('\n').slice(1).join('\n')
    const batch = async (n: number) => {
      await fetch(`http://${address}/?count=${n}`)
      all += Array.from({ length: n }, (_, i) => line(count + i + 1)).join('')
      count += n
      await expect.poll(() => printed.textContent()).toBe(tail())
    }
    await batch(160) // 20 KB: the address and earliest lines are already gone.
    await expect.poll(gap).toBeLessThanOrEqual(1)
    await batch(8)
    await expect.poll(gap).toBeLessThanOrEqual(1)
    await still(page)
    await output.screenshot({ path: 'test-results/run-output-following.png', scale: 'css' })

    // Keep a retained line at the same place while the head of the tail rolls off.
    await scroller.hover()
    await page.mouse.wheel(0, -600)
    await expect(output.getByRole('button', { name: 'Latest' })).toBeVisible()
    const anchor = await scroller.evaluate((el) => {
      const top = el.getBoundingClientRect().top
      const row = Array.from(el.querySelectorAll('pre > span')).find((one) => one.getBoundingClientRect().top >= top)
      if (!row) throw new Error('No visible output line')
      return { text: row.textContent ?? '', y: row.getBoundingClientRect().top }
    })
    await batch(8)
    await expect
      .poll(async () => {
        const row = printed.getByText(anchor.text.trim(), { exact: true })
        return Math.abs((await row.boundingBox())!.y - anchor.y)
      })
      .toBeLessThanOrEqual(1)
    await expect(output.getByRole('button', { name: 'Latest' })).toBeVisible()
    await still(page)
    await output.screenshot({ path: 'test-results/run-output-scrolled.png', scale: 'css' })
    await output.getByRole('button', { name: 'Latest' }).click()
    await expect.poll(gap).toBeLessThanOrEqual(1)
    await batch(8)
    await expect.poll(gap).toBeLessThanOrEqual(1)

    // Stop from the real card. Pressing outside the popover closes it; opening
    // the stopped card's console must retain the SIGTERM handler's last line.
    await page.keyboard.press('Escape')
    await card.getByRole('button', { name: 'Stop npm run dev' }).click()
    await expect(card).toContainText('Stopped')
    await card.getByRole('button', { name: 'Output' }).click()
    all += 'FINAL shutdown\n'
    await expect.poll(() => printed.textContent()).toBe(tail())
    await expect.poll(gap).toBeLessThanOrEqual(1)
    await still(page)
    await output.screenshot({ path: 'test-results/run-output-stopped.png', scale: 'css' })
    writeFileSync(
      'test-results/run-output.json',
      JSON.stringify({ printedBytes: all.length, keptBytes: tail().length, batches: [160, 8, 8, 8], finalLine: 'FINAL shutdown' }),
    )
  } finally {
    await electronApp.close()
  }
})
