import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, sizeWindow, still } from './support'

/*
 * Settings › Computers in the built app, on a home that takes no workers yet: the home with its live readings and
 * its agents, opened out to its Agents at once, and Add a worker, which starts with letting the home take workers.
 * Light and dark; each shot is kept in test-results/computers.
 */

const THIS = process.platform === 'darwin' ? 'This Mac' : process.platform === 'win32' ? 'This PC' : 'This computer'

const shoot = async (page: Page, name: string) => {
  await still(page)
  await page.screenshot({ path: `test-results/computers/${name}.png`, scale: 'css', animations: 'disabled' })
}

test('lists the home with its readings, opens it to its Agents at once, and says what adding a worker takes', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home)
  const main = page.getByRole('main')
  try {
    await sizeWindow(electronApp, page, 1180, 760)
    await openFirstProject(electronApp, page, repository(projects))
    await page.keyboard.press('ControlOrMeta+Shift+Comma')
    await page.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'Computers' }).click()
    await expect(main.getByRole('heading', { name: 'Computers', level: 1 })).toBeVisible()

    // The home, read as its popover reads it: CPU, memory and its agents, of the number it runs at once.
    const homeModule = main.getByRole('button', { name: new RegExp(`^${THIS}`) })
    await expect(homeModule).toContainText('Keeps your projects')
    await expect(homeModule).toContainText('CPU')
    await expect(homeModule).toContainText(/Agents\s*0 of \d+/)
    // No workers yet: the one way in is adding one.
    const add = main.getByRole('button', { name: /^Add a worker/ })
    await expect(add).toContainText('A Linux computer this home runs tasks on')

    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await shoot(page, `section-${scheme}`)
    }
    await page.emulateMedia({ colorScheme: 'light' })

    // Opened out: its readings beside what it has, and its Agents at once.
    await homeModule.click()
    await expect(main.getByRole('heading', { name: THIS })).toBeVisible()
    await expect(main.getByRole('slider', { name: 'Agents at once' })).toBeVisible()
    await shoot(page, 'home')
    await main.getByRole('button', { name: 'Computers' }).click()

    // Adding one: this home takes none yet, so letting it comes first.
    await main.getByRole('button', { name: /^Add a worker/ }).click()
    const dialog = page.getByRole('dialog', { name: `Add a worker to ${THIS}` })
    await expect(dialog).toContainText('Let this home take workers, then restart Althar.')
    await expect(dialog).toContainText('althar workers enroll')
    await still(page)
    await dialog.screenshot({ path: 'test-results/computers/add.png', scale: 'css', animations: 'disabled' })
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})
