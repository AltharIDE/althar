import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { backToWork, chooseFolder, launch, openFirstProject, projectSettings, say, still } from './support'

/*
 * A project made in a tab of its own, named first and then given its
 * folders; and a project after it is made, from its settings, a view of it
 * in its header: renamed and drawn in another ink in place, a
 * repository added, its host connected from where its work goes, and left
 * out, and removed from Althar, each showing in the tabs and the home at
 * once, with the person's folders left exactly as they were.
 */

/** What the repositories page calls the folders on this computer, as the system it runs on is named: Linux's, as CI runs. */
const HERE = process.platform === 'darwin' ? 'On this Mac' : process.platform === 'win32' ? 'On this PC' : 'On this computer'

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

    // Its header's ⋯ says what it is made of, and never where it is.
    await page.getByRole('button', { name: 'Made of' }).click()
    await expect(page.getByRole('menu', { name: 'Made of' }).getByRole('menuitem')).toHaveText([/^meridian/])
    await page.keyboard.press('Escape')
    await expect(page.getByText(meridian)).toHaveCount(0)

    // Renamed in place: the header and the tab say it at once.
    await projectSettings(page, 'General')
    const name = page.getByRole('textbox', { name: 'Name' })
    await name.fill('Refunds v2')
    await page.screenshot({ path: 'test-results/project-rename.png', animations: 'disabled' })
    await name.press('Enter')
    await expect(page.getByRole('heading', { name: 'Refunds v2', level: 1 })).toBeVisible()
    await expect(tabs.getByRole('button', { name: /^Refunds v2/ })).toBeVisible()

    // Drawn in another ink: the header's mark takes it, and it is kept.
    await page.getByRole('radio', { name: /^Rose/ }).click()
    await expect(page.getByRole('radio', { name: /^Rose/ })).toBeChecked()
    await expect(
      page.locator('header', { has: page.getByRole('heading', { name: 'Refunds v2', level: 1 }) }).locator('[data-ink]'),
    ).toHaveAttribute('data-ink', 'rose')
    // Tasks: each switch says when it acts.
    await expect(page.getByRole('switch', { name: 'Resolve merge conflicts automatically' })).not.toBeChecked()
    await expect(page.getByRole('switch', { name: 'Move issues along with their tasks' })).toBeChecked()
    await page.screenshot({ path: 'test-results/project-settings-general.png', animations: 'disabled' })

    // A repository added, with its role, and where its work goes; GitHub connected from there; then left out again.
    await projectSettings(page, 'Code and issues')
    await expect(page.getByRole('heading', { name: 'Code and issues', level: 2 })).toBeVisible()
    await chooseFolder(electronApp, web)
    await page.getByRole('button', { name: 'Add a folder' }).click()
    const here = page.getByRole('list', { name: HERE })
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
    // Back to its work.
    await backToWork(page)
    await expect(page.getByRole('textbox', { name: 'Tell the coordinator something' })).toBeVisible()

    // On the home, by its new name.
    await tabs.getByRole('button', { name: /^Home/ }).click()
    await expect(page.getByRole('complementary', { name: 'Projects' }).getByRole('button', { name: /Refunds v2/ })).toBeVisible()
    await tabs.getByRole('button', { name: /^Refunds v2/ }).click()

    // Removed, from the foot of its settings' side: it says what happens first, then the window goes home, without its tab.
    await projectSettings(page, 'General')
    await page.getByRole('navigation', { name: 'Project settings' }).getByRole('button', { name: 'Remove from Althar…' }).click()
    const remove = page.getByRole('dialog', { name: 'Remove Refunds v2 from Althar?' })
    await expect(remove.getByText(/Its folders.* stay\./)).toBeVisible()
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
    await expect(folders.getByRole('listitem')).toHaveCount(2)
    await still(page)
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
    await page.keyboard.press('ControlOrMeta+n')
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

test('says a note the coordinator kept in the person’s own words, in place, shown as markdown and kept so', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const meridian = repository(home, 'meridian')
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, meridian)
    // The person decides something in conversation, and the coordinator keeps it.
    await say(page, 'Release from `main` on Tuesdays, **never on a Friday**. [coordinator:keep-note]')
    await expect(page.getByText(/^Kept as note_/)).toBeVisible()

    // In the project's settings, its code and emphasis show as markdown has them.
    await projectSettings(page, 'Notes')
    const notes = page.getByRole('region', { name: 'Notes' })
    await expect(notes.locator('code', { hasText: 'main' })).toBeVisible()
    await expect(notes.locator('strong', { hasText: 'never on a Friday' })).toBeVisible()

    // Changed where it is: its pencil, the words as they were said, then Enter.
    await notes.getByRole('button', { name: /^Edit “Release from/ }).click()
    const field = notes.getByRole('textbox', { name: 'Note' })
    await expect(field).toHaveValue('Release from `main` on Tuesdays, **never on a Friday**.')
    await field.fill('Release from `main` on Tuesdays and Thursdays, as [the runbook](https://example.test/runbook) says.')
    await field.press('Enter')
    await expect(field).toBeHidden()
    await expect(notes.getByRole('link', { name: 'the runbook' })).toHaveAttribute('href', 'https://example.test/runbook')
    await page.screenshot({ path: 'test-results/project-note-edited.png', animations: 'disabled' })

    // Read afresh from Althar, it says the new words, as they were said.
    await page.reload()
    await projectSettings(page, 'Notes')
    await expect(notes.getByRole('link', { name: 'the runbook' })).toBeVisible()
    await expect(notes.locator('code', { hasText: 'main' })).toBeVisible()
    await expect(notes.locator('strong')).toHaveCount(0)
    await notes.getByRole('button', { name: /^Edit “Release from/ }).click()
    await expect(notes.getByRole('textbox', { name: 'Note' })).toHaveValue(
      'Release from `main` on Tuesdays and Thursdays, as [the runbook](https://example.test/runbook) says.',
    )
  } finally {
    await electronApp.close()
  }
})
