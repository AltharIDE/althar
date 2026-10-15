import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, say, startTask } from './support'

/*
 * A project's rules (ADR-013), as the person changes them: from the
 * project's settings, each change kept at once, there again when they
 * come back.
 */

/** The project's rules, from its settings. */
const openRules = async (page: Page) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page
    .getByRole('dialog', { name: /’s settings$/ })
    .getByRole('button', { name: /^Rules/ })
    .click()
}

/** One sentence of the rules, by its word in the margin. */
const sentence = (page: Page, label: string) => page.getByRole('listitem', { name: label })

/** Opens a built-in word's menu and picks what it should be. */
const choose = async (page: Page, word: string, option: string) => {
  await page.getByRole('button', { name: word, exact: true }).click()
  await page.getByRole('menuitemradio', { name: option }).click()
}

test('changes a project’s rules from its settings, and keeps them', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await openRules(page)
    await expect(page.getByRole('heading', { name: 'Rules', level: 1 })).toBeVisible()
    await expect(sentence(page, 'The rest')).toContainText('Everything else: allowed. What Althar can’t read comes to you.')
    await choose(page, 'allowed', 'The coordinator decides')
    await expect(sentence(page, 'The rest')).toContainText('the coordinator decides. What it can’t settle')
    await page.screenshot({ path: 'test-results/rules-top.png', animations: 'disabled' })

    // A new project asks about every kind; force pushes move to Never, and only there.
    await expect(sentence(page, 'Ask me').getByRole('button', { name: 'force pushing' })).toBeVisible()
    await choose(page, 'force pushing', 'Never')
    await expect(sentence(page, 'Never')).toContainText('Agents never force push.')
    await expect(sentence(page, 'Ask me').getByRole('button', { name: 'force pushing' })).toHaveCount(0)

    // A command, added where its sentence ends.
    await page.getByRole('button', { name: 'Add a command to Ask me' }).click()
    await page.getByRole('textbox', { name: 'A command, as it starts' }).fill('terraform *')
    await page.keyboard.press('Enter')
    await expect(sentence(page, 'Ask me').getByText('terraform *', { exact: true })).toBeVisible()
    await choose(page, 'a draft pull request', 'Push the branch only')
    await expect(sentence(page, 'Finished')).toContainText('A finished task pushes its branch alone')
    await page.screenshot({ path: 'test-results/rules.png', animations: 'disabled', fullPage: true })

    // Back to the project with Escape, and in again: as it was left.
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await openRules(page)
    await expect(sentence(page, 'The rest')).toContainText('the coordinator decides')
    await expect(sentence(page, 'Never').getByRole('button', { name: 'force push', exact: true })).toBeVisible()
    await expect(sentence(page, 'Ask me').getByRole('button', { name: 'force pushing' })).toHaveCount(0)
    await expect(sentence(page, 'Ask me').getByText('terraform *', { exact: true })).toBeVisible()
    await expect(sentence(page, 'Finished')).toContainText('A finished task pushes its branch alone')
  } finally {
    await electronApp.close()
  }
})

test('the coordinator answers a task permission, leaves always-ask items to the person, and appears in the home summary', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(home))
    // On the project first: its Settings are on its page.
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await openRules(page)
    await choose(page, 'allowed', 'The coordinator decides')
    await expect(sentence(page, 'The rest')).toContainText('the coordinator decides')
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await startTask(page, 'Verify the checkout')
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Open task/ }).click()
    // In the task before saying anything: the project's composer, the coordinator's, is there until it opens.
    await expect(page.getByRole('heading', { name: 'Verify the checkout', level: 1 })).toBeVisible()
    await page.keyboard.press('c')

    await say(page, 'tool')
    await expect(page.getByText('chosen=allow-once')).toBeVisible()
    await expect(page.getByText(/By the coordinator:/)).toHaveCount(0)

    await say(page, 'run npm test')
    await expect(page.getByText('chosen=allow_once')).toBeVisible()
    await expect(
      page.getByText('Allowed Run npm test By the coordinator: This action is needed for the task.', { exact: true }),
    ).toBeVisible()
    await expect(page.getByText('Needs your permission')).toHaveCount(0)
    await page.screenshot({ path: 'test-results/coordinator-permission.png', animations: 'disabled' })

    // Deploying is still reserved for the person, even though the judge would allow it.
    await say(page, 'command-choices')
    await expect(page.getByText('Needs your permission')).toBeVisible()
    await page.getByRole('button', { name: /^Allow/ }).click()
    await expect(page.getByText('chosen=allow_once')).toHaveCount(2)
    await page.getByRole('navigation', { name: 'Projects' }).getByRole('button', { name: /^Home/ }).click()
    await page.getByRole('button', { name: /since you looked/ }).click()
    await expect(page.getByText('Coordinator answered 1 permission ask')).toBeVisible()
    await page.screenshot({ path: 'test-results/coordinator-home.png', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})
