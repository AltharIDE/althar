import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron } from '@playwright/test'
import { budget } from '@althar/testing/budget'

import { startupProfile } from '../e2e/startupProfile'
import { mainWindow } from '../e2e/support'

/* A manual measurement, with real CLIs on this Mac, on a disposable populated profile. No correctness assertion has a time budget of its own. */
const home = mkdtempSync(join(tmpdir(), 'althar-startup-measure-'))
const profile = await startupProfile(home)
const measured: Array<unknown> = []
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'ELECTRON_RUN_AS_NODE'))
for (const run of [1, 2, 3]) {
  const app = await electron.launch({
    args: [process.cwd()],
    timeout: budget.medium,
    env: {
      ...env,
      ALTHAR_PROFILE: profile,
      ALTHAR_WORKTREES: join(home, 'worktrees'),
      ALTHAR_QUIET: '1',
      ALTHAR_QUIT_WITHOUT_ASKING: '1',
      ALTHAR_FAKE_AGENTS: '0',
    },
  })
  try {
    app.context().setDefaultTimeout(budget.medium)
    const page = await mainWindow(app)
    await page.waitForFunction(
      () => document.querySelector('[class*="behind"]') !== null && document.querySelector('[class*="veil"]') === null,
    )
    // Flush the renderer's final mark through main's IPC before reading the synchronous log.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const main = readFileSync(join(profile, 'logs/main.log'), 'utf8').split('\n')
    const runtime = readFileSync(join(profile, 'logs/runtime.log'), 'utf8').split('\n')
    const lastStart = main.findLastIndex((line) => line.includes('stage=process-start'))
    const lastRuntime = runtime.findLastIndex((line) => line.includes('stage=runtime-entry'))
    const result = {
      run,
      profile,
      main: main.slice(lastStart).filter((line) => line.includes('message=Startup')),
      runtime: runtime.slice(lastRuntime).filter((line) => line.includes('Startup')),
    }
    measured.push(result)
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } finally {
    await app.close()
  }
}
writeFileSync(join(process.cwd(), 'test-results/startup-profile.txt'), profile)

writeFileSync(join(process.cwd(), 'test-results/startup-measurements.json'), JSON.stringify(measured, null, 2))
