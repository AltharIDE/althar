import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject } from './support'

/*
 * The project run with no agent, in a real window (ADR-023, ADR-090): from
 * the project's front, Run opens its list, on the default branch picked
 * beside it, and a copy of it runs its dev script; its card in the
 * coordinator's thread says where it answers, Run says it runs, and the card
 * stops it and runs it again. Then more to run (ADR-044): Storybook, picked
 * from its package.json, runs beside it from Run's list, and, dragged to the
 * top of the whole list, comes first.
 */

/** Run's button, whatever it says after Run. */
const RUN = /^Run(\s*\d+ (running|failed))?$/

/** Run, its place and its open list, at 1×. */
const shoot = async (page: Page, name: string) => {
  const list = await page.getByRole('dialog', { name: 'What it runs' }).boundingBox()
  const run = await page.getByRole('button', { name: 'main' }).boundingBox()
  if (list === null || run === null) throw new Error('Run’s list is not open.')
  const x = Math.min(list.x, run.x) - 8
  await page.screenshot({
    path: `test-results/${name}.png`,
    animations: 'disabled',
    scale: 'css',
    clip: { x, y: run.y - 8, width: list.x + list.width + 8 - x, height: list.y + list.height + 8 - (run.y - 8) },
  })
}

/** A dev server on a free port that says where it answers, as Vite does. */
const SERVER = `require('node:http').createServer((_, res) => res.end('meridian')).listen(0, function () {
  console.log('  Local:   http://localhost:' + this.address().port + '/')
})
`

test('runs the default branch from the project’s front, leaves its card in the thread, and stops and runs it again from there', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({ name: 'meridian', private: true, scripts: { dev: 'node serve.js', storybook: 'node serve.js' } }, null, 2),
  )
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
    // What it runs, in the list Run opens, on the default branch picked beside it: nothing runs at the press.
    await expect(page.getByRole('button', { name: 'main' })).toBeVisible()
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    const list = page.getByRole('dialog', { name: 'What it runs' })
    await expect(list.getByRole('button', { name: 'Run npm run dev' })).toBeVisible()
    await shoot(page, 'run-button')
    await list.getByRole('button', { name: 'Run npm run dev' }).click()
    await page.keyboard.press('Escape')

    // Its card, in the coordinator's thread: where it runs, the command, and where it answers once it says.
    const card = page.getByRole('article', { name: 'Run of main' })
    const open = card.getByRole('button', { name: /^Open localhost:\d+$/ })
    await expect(open).toBeVisible()
    const address = (await open.getAttribute('aria-label'))?.replace('Open ', '') ?? ''
    expect(await (await fetch(`http://${address}`)).text()).toBe('meridian')
    // Run says it runs, and its list where it answers; nothing over the composer.
    await expect(page.getByRole('button', { name: /^Run\s*1 running$/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Running/ })).toHaveCount(0)
    await page.mouse.move(1400, 300)
    await page.screenshot({ path: 'test-results/run-card.png', animations: 'disabled' })
    await page.getByRole('button', { name: /^Run\s*1 running$/ }).click()
    await expect(list.getByRole('button', { name: address })).toBeVisible()
    await shoot(page, 'run-list-running')
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
    ).toBeVisible()

    // More to run: Storybook, picked from package.json, runs beside it, each answering where it says.
    await page.getByRole('button', { name: RUN }).click()
    await list.getByRole('button', { name: 'Add something to run' }).click()
    const add = page.getByRole('dialog', { name: 'Add something to run' })
    await add.getByRole('radio', { name: 'From package.json' }).click()
    await add.getByRole('checkbox', { name: /npm run storybook/ }).click()
    await page.screenshot({ path: 'test-results/run-add.png', animations: 'disabled' })
    await add.getByRole('button', { name: 'Add' }).click()
    await expect(add).toBeHidden()
    await page.getByRole('button', { name: RUN }).click()
    await list.getByRole('button', { name: 'Run Storybook' }).click()
    await expect(list.getByRole('button', { name: 'Stop Storybook' })).toBeVisible()
    await expect(list.getByRole('button', { name: 'Stop npm run dev' })).toBeVisible()
    await expect(list.getByRole('button', { name: /^localhost:\d+$/ })).toHaveCount(2)
    await expect(page.getByRole('button', { name: /^Run\s*2 running$/ })).toBeVisible()
    await shoot(page, 'run-many')
    await page.keyboard.press('Escape')

    // The whole list: Storybook dragged by its grip to the top, first in Run's list now.
    await page.getByRole('button', { name: RUN }).click()
    await list.getByRole('button', { name: 'Edit the list' }).click()
    const whole = page.getByRole('dialog', { name: 'What meridian runs' })
    const grip = await whole.getByRole('button', { name: 'Drag to move Storybook' }).boundingBox()
    const top = await whole.getByRole('listitem').first().boundingBox()
    if (grip === null || top === null) throw new Error('The list is not laid out.')
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
    await page.mouse.down()
    await page.mouse.move(grip.x + grip.width / 2, top.y + top.height / 2, { steps: 12 })
    await page.screenshot({ path: 'test-results/run-list-dragging.png', animations: 'disabled' })
    await page.mouse.up()
    const first = whole.getByRole('listitem').first()
    await expect(first).toContainText('Storybook')
    await expect(first.getByText('Default', { exact: true })).toBeVisible()
    await page.screenshot({ path: 'test-results/run-list.png', animations: 'disabled' })
    await whole.getByRole('button', { name: 'Done' }).click()
    await page.getByRole('button', { name: RUN }).click()
    await expect(list.locator('[title^="npm run"]').first()).toHaveText('Storybook')
  } finally {
    await electronApp.close()
  }
})
