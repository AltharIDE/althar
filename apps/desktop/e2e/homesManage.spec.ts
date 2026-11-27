import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, still } from './support'

/*
 * The homes in this computer's window, with a home saved and no SSH host to
 * reach (homes.spec.ts connects one, on Linux): the chip at the bar's end,
 * its menu, and Manage homes, which draws each home by its projects (this
 * computer's live, as its window reads them; the saved home's quiet, as a
 * window on it last read them), and changes a home's connection in place.
 * Its screenshots are the chip's evidence (test-results/homes-manage-*.png).
 */

const homeId = `home_${'a1'.repeat(16)}`
const saved = { id: `remote_${'b2'.repeat(16)}`, name: 'hetzner-01', homeId, ssh: { target: 'me@hetzner-01.invalid' } }

test('draws the chip once a home is saved, and Manage homes by each home’s projects', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const profile = join(home, 'profile')
  mkdirSync(profile, { mode: 0o700 })
  writeFileSync(join(profile, 'homes.json'), JSON.stringify({ version: 1, homes: [saved] }), { mode: 0o600 })
  writeFileSync(
    join(profile, 'home-glances.json'),
    JSON.stringify({
      version: 1,
      opened: { [saved.id]: Date.now() - 40 * 60_000 },
      projects: {
        [homeId]: [
          { id: 'prj_ledger', name: 'ledger', ink: 'moss' },
          { id: 'prj_infra', name: 'infra', ink: 'slate' },
        ],
      },
    }),
    { mode: 0o600 },
  )
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(projects))
    const chip = page.getByRole('button', { name: 'Computers', exact: true })
    await expect(chip).toBeVisible()
    await chip.click()
    const menu = page.getByRole('menu', { name: 'Computers' })
    await expect(menu.getByRole('menuitem', { name: /hetzner-01/ })).toBeVisible()
    await still(page)
    await menu.screenshot({ path: 'test-results/homes-manage-01-menu.png', scale: 'css' })
    await menu.getByRole('menuitem', { name: 'Manage homes…' }).click()

    const manage = page.getByRole('dialog', { name: 'Homes' })
    await expect(manage.getByRole('button', { name: /^meridian/ })).toBeVisible()
    await expect(manage.getByRole('button', { name: 'ledger', exact: true })).toBeVisible()
    await expect(manage.getByText('40 minutes ago', { exact: true })).toBeVisible()
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await still(page)
      await manage.screenshot({ path: `test-results/homes-manage-02-${scheme}.png`, scale: 'css' })
    }
    await page.emulateMedia({ colorScheme: 'light' })

    await manage.getByRole('button', { name: 'hetzner-01, more' }).click()
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    await manage.getByLabel('Name', { exact: true }).fill('Discard this name')
    await still(page)
    await manage.screenshot({ path: 'test-results/homes-manage-rename.png', scale: 'css' })
    await manage.getByLabel('Name', { exact: true }).press('Escape')
    await expect(manage).toBeVisible()
    await expect(manage.getByText('hetzner-01', { exact: true })).toBeVisible()
    expect(await page.evaluate(async () => (await window.althar.homes!.list())[0]?.name)).toBe('hetzner-01')

    await manage.getByRole('button', { name: 'hetzner-01, more' }).click()
    await page.getByRole('menuitem', { name: 'Edit connection' }).click()
    await expect(manage.getByLabel('SSH host', { exact: true })).toBeFocused()
    await manage.getByLabel('SSH host', { exact: true }).fill('me@hetzner-02.invalid')
    await still(page)
    await manage.screenshot({ path: 'test-results/homes-manage-03-edit.png', scale: 'css' })
    await manage.getByRole('button', { name: 'Cancel', exact: true }).click()
    await manage.getByRole('button', { name: 'Close', exact: true }).click()

    // Forget is at once, with Undo.
    await manage.getByRole('button', { name: 'hetzner-01, more' }).click()
    await page.getByRole('menuitem', { name: 'Forget' }).click()
    await expect(manage.getByText('Forgot hetzner-01.')).toBeVisible()
    await manage.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(manage.getByRole('button', { name: 'hetzner-01, more' })).toBeAttached()
    await expect.poll(() => page.evaluate(async () => (await window.althar.homes!.list()).length)).toBe(1)
    await manage.getByRole('button', { name: 'Done', exact: true }).click()

    // A host that can't be reached: its problem at the field, and the form as it was.
    await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('homes')?.click())
    await page.getByRole('menuitem', { name: 'Connect a home…' }).click()
    const connect = page.getByRole('dialog', { name: 'Connect a home' })
    await connect.getByRole('radio', { name: 'SSH', exact: true }).click()
    await connect.getByLabel('SSH host', { exact: true }).fill('me@nowhere.invalid')
    await connect.getByRole('button', { name: 'Check host', exact: true }).click()
    await expect(connect.getByRole('alert')).toBeVisible()
    await still(page)
    await connect.screenshot({ path: 'test-results/homes-manage-04-refused.png', scale: 'css' })
  } finally {
    await electronApp.close()
  }
})
