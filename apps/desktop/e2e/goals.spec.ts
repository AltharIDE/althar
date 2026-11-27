import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, startTask, still, toConversation } from './support'

test('starts a goal from the composer’s /goal, says it in the thread, and controls it in place', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-goals-'))
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(home))
    await startTask(page, 'Check the migration')
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Open task/ }).click()
    await toConversation(page)
    const composer = page.getByRole('textbox', { name: /^(Tell .* something|Add to the queue|Send now)/ })
    const card = page.getByRole('region', { name: 'Goal' })
    const commands = page.getByRole('listbox', { name: 'Commands' })
    const objective = 'Verify the migration on staging [lead:slowly]'
    // A slash opens what the task can do now, /goal first.
    await composer.fill('/')
    await expect(commands.getByRole('option').first()).toContainText('/goal')
    await still(page)
    await page.screenshot({ path: 'test-results/commands-slash.png', scale: 'css' })
    // Picked, it opens into the goal, and the last row says what Enter does with what is written.
    await composer.press('Enter')
    await expect(composer).toHaveValue('/goal ')
    await expect(page.getByText('Not set', { exact: true })).toBeVisible()
    await composer.pressSequentially(objective)
    await expect(commands.getByRole('option', { name: 'Set the goal' })).toBeVisible()
    await still(page)
    await page.screenshot({ path: 'test-results/commands-goal-written.png', scale: 'css' })
    await composer.press('Enter')
    await expect(card.getByRole('status')).toHaveText('Active')
    await expect(composer).toHaveValue('')
    // Set, it is said in the thread as Althar's line, not sent to the lead as words.
    await expect(page.getByText(`You set a goal: ${objective}`)).toBeVisible()
    // With a goal at work, /goal opens into it, and pause is a key away; the goal's own line steps aside meanwhile.
    await composer.fill('/goal ')
    await expect(commands.getByRole('option')).toHaveText([/pause/, /edit/, /clear/])
    await expect(card).toHaveCount(0)
    await still(page)
    await page.screenshot({ path: 'test-results/commands-goal-set.png', scale: 'css' })
    await composer.press('Enter')
    await expect(card.getByRole('status')).toHaveText('Paused')
    await expect(page.getByText('You paused the goal.')).toBeVisible()
    await still(page)
    await page.screenshot({ path: 'test-results/commands-goal-paused.png', scale: 'css' })

    await card.getByRole('button', { name: /Verify the migration/ }).click()
    await card.getByRole('button', { name: 'Edit' }).click()
    await card.getByRole('textbox', { name: 'Objective' }).fill('Verify the migration on local and staging [lead:slowly]')
    await card.getByRole('button', { name: 'Save' }).click()
    await expect(card.getByText('Verify the migration on local and staging [lead:slowly]', { exact: true })).toBeVisible()
    await expect(card.getByRole('status')).toHaveText('Paused')
    await still(page)
    await card.screenshot({ path: 'test-results/goal-paused.png', scale: 'css' })

    await card.getByRole('button', { name: 'Resume' }).click()
    await expect(card.getByRole('status')).toHaveText('Active')
    await card.getByRole('button', { name: 'Clear' }).click()
    await expect(card).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})
