import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, say } from './support'

/*
 * A project's rules (ADR-013), as the person changes them: from the
 * project's title bar, each change kept at once, there again when they
 * come back.
 */

/** The project's rules, from its bar's menu. */
const openRules = async (page: Page) => {
  await page.getByRole('button', { name: 'More for this project' }).click()
  await page.getByRole('menuitem', { name: 'Project rules' }).click()
}

test('changes a project’s rules from its title bar, and keeps them', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await openRules(page)
    await expect(page.getByRole('radio', { name: /Allow, except what you keep/ })).toBeChecked()
    await page.getByRole('radio', { name: /The coordinator decides/ }).click()
    await page.screenshot({ path: 'test-results/rules-top.png', animations: 'disabled' })

    const always = page.getByRole('group', { name: 'Always ask me' })
    await expect(always.getByRole('checkbox', { name: 'Force pushes' })).toBeChecked()
    await always.getByRole('checkbox', { name: 'Force pushes' }).click()
    await page.getByRole('group', { name: 'Never' }).getByRole('checkbox', { name: 'Force pushes' }).click()
    await page.getByRole('button', { name: 'Add a rule' }).first().click()
    await page.getByRole('textbox', { name: 'A command, as it starts' }).fill('terraform *')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(always.getByRole('checkbox', { name: 'Commands starting “terraform *”' })).toBeChecked()
    await page.getByRole('radio', { name: /Push the branch only/ }).click()
    await page.screenshot({ path: 'test-results/rules.png', animations: 'disabled', fullPage: true })

    // Back to the project and in again: as it was left.
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await openRules(page)
    await expect(page.getByRole('radio', { name: /The coordinator decides/ })).toBeChecked()
    await expect(page.getByRole('group', { name: 'Always ask me' }).getByRole('checkbox', { name: 'Force pushes' })).not.toBeChecked()
    await expect(page.getByRole('group', { name: 'Never' }).getByRole('checkbox', { name: 'Force pushes' })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Commands starting “terraform *”' })).toBeChecked()
    await expect(page.getByRole('radio', { name: /Push the branch only/ })).toBeChecked()
  } finally {
    await electronApp.close()
  }
})

test('the coordinator answers a task permission, leaves always-ask items to the person, and appears in the home summary', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(home))
    await openRules(page)
    await page.getByRole('radio', { name: /The coordinator decides/ }).click()
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await page.getByRole('button', { name: 'New task' }).click()
    await page.getByLabel('What should change').fill('Verify the checkout')
    await page.getByLabel('Anything the lead should know').fill('[lead:finish]')
    await page.getByRole('button', { name: /^Review:/ }).click()
    await page.getByRole('button', { name: 'No review' }).click()
    await page.getByRole('button', { name: 'Start the task' }).click()
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Open task/ }).click()
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
