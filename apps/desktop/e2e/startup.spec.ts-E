import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { startupProfile } from './startupProfile'
import { launch } from './support'

/** Ordering, rather than a wall-clock budget: background work may be arbitrarily slow without holding the home closed. */
test('opens a populated home before agent and usage checks, and keeps timings in the logs', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-startup-'))
  await startupProfile(home)
  const { electronApp, page } = await launch(home)
  try {
    await expect(page.getByRole('complementary', { name: 'Projects' })).toBeVisible()
    await page.waitForFunction(() => document.querySelector('[class*="veil"]') === null)
    const main = () => readFileSync(join(home, 'profile/logs/main.log'), 'utf8')
    await expect.poll(main).toContain('stage=first-screen-drawn')
    const runtime = () => readFileSync(join(home, 'profile/logs/runtime.log'), 'utf8')
    await expect.poll(runtime).toContain('stage=agent-checks phase=start')
    expect(runtime()).toContain('stage=store-open phase=done')
    expect(runtime()).toContain('stage=store-migrations phase=done')
    expect(runtime()).toContain('tasks=1200')
    await page.screenshot({ path: 'test-results/startup-home.png', scale: 'css' })
    // The synchronous timestamps inside runtime.log compare across processes even when stdout arrives in a batch.
    const drawn = Date.parse(
      main()
        .split('\n')
        .find((line) => line.includes('stage=first-screen-drawn'))!
        .split(' ')[0]!,
    )
    for (const line of runtime()
      .split('\n')
      .filter((line) => /stage=(agent-checks|plan-usage-read) phase=start/.test(line))) {
      const at = Number(/at_ms=(\d+)/.exec(line)?.[1])
      expect(at).toBeGreaterThanOrEqual(drawn)
    }
  } finally {
    await electronApp.close()
  }
})
