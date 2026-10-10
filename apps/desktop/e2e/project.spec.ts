import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { chooseFolder, launch, openFirstProject } from './support'

/*
 * A project after it is made, from its bar's menu: renamed, a repository
 * added, its host connected from where its work goes, and left out, and
 * removed from Althar, each showing in the tabs and the home at once, with
 * the person's folders left exactly as they were.
 */

const menu = async (page: Page, item: string | RegExp) => {
  await page.getByRole('button', { name: 'More for this project' }).click()
  await page.getByRole('menuitem', { name: item }).click()
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
  // Its work goes to the fake GitHub, which isn't connected yet.
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.test/meridian/web.git'], { cwd: web })
  const { electronApp, page } = await launch(home)
  const tabs = page.getByRole('navigation', { name: 'Projects' })
  try {
    await openFirstProject(electronApp, page, meridian)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    const before = [asLeft(meridian), asLeft(web)]

    // Renamed: the head and the tab say it at once.
    await menu(page, 'Rename')
    const rename = page.getByRole('dialog', { name: 'Rename the project' })
    await rename.getByRole('textbox', { name: 'Name' }).fill('Refunds v2')
    await page.screenshot({ path: 'test-results/project-rename.png', animations: 'disabled' })
    await rename.getByRole('textbox', { name: 'Name' }).press('Enter')
    await expect(page.getByRole('heading', { name: 'Refunds v2', level: 1 })).toBeVisible()
    await expect(tabs.getByRole('button', { name: /^Refunds v2/ })).toBeVisible()

    // A repository added, with its role, and where its work goes; GitHub connected from there; then left out again.
    await menu(page, /Repositories/)
    await expect(page.getByRole('heading', { name: 'Repositories', level: 1 })).toBeVisible()
    await chooseFolder(electronApp, web)
    await page.getByRole('button', { name: 'Add a folder' }).click()
    const here = page.getByRole('list', { name: 'On this Mac' })
    await expect(here.getByText('meridian-web', { exact: true })).toBeVisible()
    await expect(here.getByRole('combobox', { name: 'Role of meridian-web' })).toHaveText(/Frontend/)
    const github = page.getByRole('region', { name: 'GitHub' })
    await expect(github.getByText('meridian/web')).toBeVisible()
    await expect(github.getByText('Not connected')).toBeVisible()
    // Its own work stays here: it has no remote.
    await expect(page.getByRole('region', { name: 'No remote' }).getByText('meridian', { exact: true })).toBeVisible()
    await page.screenshot({ path: 'test-results/project-repositories.png', animations: 'disabled' })
    await github.getByRole('button', { name: 'Connect GitHub' }).click()
    const connecting = page.getByRole('dialog', { name: 'Code hosts and trackers' })
    const services = connecting.getByRole('list', { name: 'Code hosts' })
    await services.getByRole('button', { name: 'Add a token' }).click()
    await services.getByLabel('GitHub token').fill('github_pat_e2e')
    await services.getByRole('button', { name: 'Save' }).click()
    await expect(services.getByText('Signed in as you')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(connecting).toHaveCount(0)
    // The page hears it, and says who Althar is there.
    await expect(github.getByText('Connected as you')).toBeVisible()
    await page.screenshot({ path: 'test-results/project-repositories-connected.png', animations: 'disabled' })
    await here.getByRole('button', { name: 'More for meridian-web' }).click()
    await page.getByRole('menuitem', { name: /Leave out of Refunds v2/ }).click()
    await expect(here.getByText('meridian-web', { exact: true })).toBeHidden()
    // The last one stays: with no remote, it has nothing more to offer.
    await expect(here.getByRole('button', { name: /More for/ })).toBeHidden()
    // Escape goes back.
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'Refunds v2', level: 1 })).toBeVisible()

    // On the home, by its new name.
    await tabs.getByRole('button', { name: /^Home/ }).click()
    await expect(page.getByRole('complementary', { name: 'Projects' }).getByRole('button', { name: /Refunds v2/ })).toBeVisible()
    await tabs.getByRole('button', { name: /^Refunds v2/ }).click()

    // Removed: it says what happens first, then the window goes home, without its tab.
    await menu(page, 'Remove from Althar')
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
