import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject } from './support'

/*
 * The project run with no agent, in a real window (ADR-023): from the
 * project's front, a copy of the default branch runs its dev script; its card
 * in the coordinator's thread says where it answers, the pill over the
 * composer has it with where it runs, and the card stops it and runs it
 * again.
 */

/** A dev server on a free port that says where it answers, as Vite does. */
const SERVER = `require('node:http').createServer((_, res) => res.end('meridian')).listen(0, function () {
  console.log('  Local:   http://localhost:' + this.address().port + '/')
})
`

test('runs the default branch from the project’s front, leaves its card in the thread, and stops and runs it again from there', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'meridian', private: true, scripts: { dev: 'node serve.js' } }, null, 2))
  writeFileSync(join(repo, 'serve.js'), SERVER)
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 't@althar.test',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 't@althar.test',
  }
  execFileSync('git', ['add', '.'], { cwd: repo, env })
  execFileSync('git', ['commit', '-q', '-m', 'Serve'], { cwd: repo, env })
  const { electronApp, page } = await launch(home)
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await page.getByRole('button', { name: 'Run npm run dev' }).click()

    // Its card, in the coordinator's thread: where it runs, the command, and where it answers once it says.
    const card = page.getByRole('article', { name: 'Run of main' })
    const open = card.getByRole('button', { name: /^Open localhost:\d+$/ })
    await expect(open).toBeVisible({ timeout: 30_000 })
    const address = (await open.getAttribute('aria-label'))?.replace('Open ', '') ?? ''
    expect(await (await fetch(`http://${address}`)).text()).toBe('meridian')
    // The pill over the composer has it too, with where it runs.
    const running = page.getByRole('button', { name: /^Running/ })
    await expect(running).toContainText(address)
    await page.mouse.move(1400, 300)
    await page.screenshot({ path: 'test-results/run-card.png', animations: 'disabled' })
    await running.click()
    await expect(page.getByRole('dialog', { name: 'Running' }).getByText(/^main/)).toBeVisible()
    await page.screenshot({ path: 'test-results/run-pill.png', animations: 'disabled' })
    await page.keyboard.press('Escape')

    // Stopped from its card, it says so and runs again; the new run leaves a card of its own.
    await card.getByRole('button', { name: 'Stop npm run dev' }).click()
    await expect(card).toContainText('stopped')
    await expect(fetch(`http://${address}`)).rejects.toThrow()
    await page.screenshot({ path: 'test-results/run-stopped.png', animations: 'disabled' })
    await card.getByRole('button', { name: 'Run npm run dev again' }).click()
    await expect(page.getByRole('article', { name: 'Run of main' })).toHaveCount(2)
    await expect(
      page
        .getByRole('article', { name: 'Run of main' })
        .last()
        .getByRole('button', { name: /^Open localhost:\d+$/ }),
    ).toBeVisible({
      timeout: 30_000,
    })
  } finally {
    await electronApp.close()
  }
})
