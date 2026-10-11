import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { chooseFolder, launch, openFirstProject } from './support'

/*
 * A project made in a tab of its own, named first and then given its
 * folders; and a project after it is made, from the settings on its front
 * page: renamed and drawn in another ink in place, a repository added, its
 * host connected from where its work goes, and left out, and removed from
 * Althar, each showing in the tabs and the home at once, with the person's
 * folders left exactly as they were.
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
  // Its work goes to the fake GitHub, which isn't connected yet.
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.test/meridian/web.git'], { cwd: web })
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

    // A repository added, with its role, and where its work goes; GitHub connected from there; then left out again.
    panel = await settings(page, 'Refunds v2')
    await panel.getByRole('button', { name: /^Repositories/ }).click()
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
    // GitHub's own walk, over the page: a token, pasted, and what it can do. The fake GitHub has no meridian/web, which the check
    // says; connected as it is, the walk closes.
    await github.getByRole('button', { name: 'Connect GitHub' }).click()
    const connecting = page.getByRole('dialog', { name: 'GitHub' })
    await connecting
      .getByRole('group', { name: 'Ways to connect GitHub' })
      .getByRole('button', { name: /Make a token/ })
      .click()
    await connecting.getByRole('button', { name: 'Paste it myself' }).click()
    await connecting.getByLabel('Paste it').fill('github_pat_e2e')
    await connecting.getByRole('button', { name: 'Check' }).click()
    await expect(connecting.getByRole('heading', { name: 'It doesn’t reach every repository' })).toBeVisible()
    await expect(connecting.getByText('It doesn’t see meridian/web.')).toBeVisible()
    await connecting.getByRole('button', { name: 'Connect as it is' }).click()
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

test('makes a project in a tab of its own: named first, then its folders, found here and chosen, and made into its tab', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const meridian = repository(home, 'meridian')
  // Where people keep code: Northwind's repositories, on GitHub and GitLab, and one of nobody's.
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const app = repository(projects, 'northwind-app')
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:northwind-co/app.git'], { cwd: app })
  const ops = repository(home, 'northwind-ops')
  execFileSync('git', ['remote', 'add', 'origin', 'git@gitlab.com:northwind/ops.git'], { cwd: ops })
  repository(projects, 'dotfiles')
  const { electronApp, page } = await launch(home)
  const tabs = page.getByRole('navigation', { name: 'Projects' })
  try {
    await openFirstProject(electronApp, page, meridian)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()

    // The + opens a tab of its own, named as it is typed, on what this computer has named like it.
    await tabs.getByRole('button', { name: 'New project' }).click()
    const name = page.getByRole('textbox', { name: 'Name' })
    await expect(name).toBeFocused()
    await name.fill('Northwind')
    await expect(tabs.getByRole('button', { name: /^Northwind/ })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('heading', { name: /named like Northwind/ })).toBeVisible()
    await page.getByRole('button', { name: 'Add northwind-app' }).click()
    const folders = page.getByRole('list', { name: 'Its folders' })
    await expect(folders.getByText('northwind-co/app')).toBeVisible()
    // One from anywhere, by the picker.
    await chooseFolder(electronApp, ops)
    await page.getByRole('button', { name: 'Choose a folder…' }).click()
    await expect(folders.getByText('northwind/ops')).toBeVisible()
    const read = page.getByRole('region', { name: 'What Althar read' })
    await expect(read.getByText(/is on GitLab, which isn’t connected/)).toBeVisible()
    await expect(read.getByRole('button', { name: 'Connect GitHub' })).toBeVisible()
    await expect(page.getByText('2 repositories')).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'test-results/new-project.png' })

    // Away and back, it is as it was.
    await tabs.getByRole('button', { name: /^meridian/ }).click()
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await tabs.getByRole('button', { name: /^Northwind/ }).click()
    await expect(folders.getByRole('listitem')).toHaveCount(2)

    // Made, its tab is the project's, open on its conversation.
    await page.getByRole('button', { name: /^Create Northwind/ }).click()
    await expect(page.getByRole('heading', { name: 'Northwind', level: 1 })).toBeVisible()
    await expect(tabs.getByRole('button', { name: /^Northwind/ })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('textbox', { name: /^Tell .* something/ })).toBeVisible()
    await page.screenshot({ path: 'test-results/new-project-made.png' })

    // Another, left with Escape: nothing is made, and the tab before it has the window.
    await page.keyboard.press('Meta+n')
    await expect(page.getByRole('textbox', { name: 'Name' })).toBeFocused()
    await page.keyboard.type('Scratch')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'Northwind', level: 1 })).toBeVisible()
    await expect(tabs.getByRole('button', { name: /^Scratch/ })).toHaveCount(0)
    await expect(tabs.getByRole('listitem')).toHaveCount(3)
  } finally {
    await electronApp.close()
  }
})
