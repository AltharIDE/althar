import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { chooseFolder, launch, openFirstProject } from './support'

/*
 * A project after it is made, from the settings on its front page: renamed
 * and drawn in another ink in place, a repository added and left out, and
 * removed from Althar, each showing in the tabs and the home at once, with
 * the person's folders left exactly as they were.
 */

/** The project's settings, from the button on its front page. */
const settings = async (page: Page, project: string) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  return page.getByRole('dialog', { name: `${project}’s settings` })
}

/** Every file under a folder with what it holds: how the person left it. */
const asLeft = (folder: string): string =>
  readdirSync(folder, { recursive: true })
    .map(String)
    .toSorted((a, b) => a.localeCompare(b))
    .filter((path) => statSync(join(folder, path)).isFile())
    .map((path) => `${path}:${readFileSync(join(folder, path)).toString('hex')}`)
    .join('\n')

test('renames a project, adds and leaves out a repository, and removes it, all without a restart', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const meridian = repository(home, 'meridian')
  const web = repository(home, 'meridian-web')
  const { electronApp, page } = await launch(home)
  const tabs = page.getByRole('navigation', { name: 'Projects' })
  try {
    await openFirstProject(electronApp, page, meridian)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    const before = [asLeft(meridian), asLeft(web)]

    // Its front page says what it is made of, and never where it is.
    await expect(page.getByRole('list', { name: 'Made of' }).getByRole('listitem')).toHaveText(['meridian'])
    await expect(page.getByText(meridian)).toHaveCount(0)

    // Renamed in place: the front page and the tab say it at once.
    let panel = await settings(page, 'meridian')
    await panel.getByRole('button', { name: /^Name and colour/ }).click()
    await panel.getByRole('textbox', { name: 'Name' }).fill('Refunds v2')
    await page.screenshot({ path: 'test-results/project-rename.png', animations: 'disabled' })
    await panel.getByRole('textbox', { name: 'Name' }).press('Enter')
    await expect(page.getByRole('heading', { name: 'Refunds v2', level: 1 })).toBeVisible()
    await expect(tabs.getByRole('button', { name: /^Refunds v2/ })).toBeVisible()
    // The settings are named for it too.
    panel = page.getByRole('dialog', { name: 'Refunds v2’s settings' })

    // Drawn in another ink: the front page's wash takes it, and it is kept.
    await panel.getByRole('radio', { name: /^Rose/ }).click()
    await expect(panel.getByRole('radio', { name: /^Rose/ })).toBeChecked()
    await expect(page.locator('header', { has: page.getByRole('heading', { name: 'Refunds v2', level: 1 }) })).toHaveAttribute(
      'style',
      /--project-rose/,
    )
    // Escape steps back to all of them, then closes the settings.
    await page.keyboard.press('Escape')
    await expect(panel.getByRole('button', { name: /^Name and colour/ })).toContainText('Rose')
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()

    // A repository added, with its role; then left out again.
    panel = await settings(page, 'Refunds v2')
    await panel.getByRole('button', { name: /^Repositories/ }).click()
    await expect(page.getByRole('heading', { name: 'Repositories' })).toBeVisible()
    await chooseFolder(electronApp, web)
    await page.getByRole('button', { name: 'Add a folder' }).click()
    const list = page.getByRole('list', { name: 'Repositories' })
    await expect(list.getByText('meridian-web', { exact: true })).toBeVisible()
    await expect(list.getByRole('combobox', { name: 'Role of meridian-web' })).toHaveText(/Frontend/)
    await page.screenshot({ path: 'test-results/project-repositories.png', animations: 'disabled' })
    await list.getByRole('button', { name: 'Leave out meridian-web' }).click()
    await expect(list.getByText('meridian-web', { exact: true })).toBeHidden()
    // The last one stays.
    await expect(list.getByRole('button', { name: /Leave out/ })).toBeHidden()
    await page.getByRole('button', { name: 'Back to Refunds v2' }).click()

    // On the home, by its new name.
    await tabs.getByRole('button', { name: /^Home/ }).click()
    await expect(page.getByRole('complementary', { name: 'Projects' }).getByRole('button', { name: /Refunds v2/ })).toBeVisible()
    await tabs.getByRole('button', { name: /^Refunds v2/ }).click()

    // Removed: it says what happens first, then the window goes home, without its tab.
    await (await settings(page, 'Refunds v2')).getByRole('button', { name: 'Remove from Althar' }).click()
    const remove = page.getByRole('dialog', { name: 'Remove Refunds v2 from Althar?' })
    await expect(remove.getByText(/Nothing in its folders changes/)).toBeVisible()
    await page.screenshot({ path: 'test-results/project-remove.png', animations: 'disabled' })
    await remove.getByRole('button', { name: 'Remove project' }).click()
    await expect(remove).toBeHidden()
    await expect(tabs.getByRole('button', { name: /^Refunds v2/ })).toBeHidden()
    await expect(page.getByRole('button', { name: /Add a folder/ })).toBeVisible()
    expect([asLeft(meridian), asLeft(web)]).toEqual(before)
  } finally {
    await electronApp.close()
  }
})
