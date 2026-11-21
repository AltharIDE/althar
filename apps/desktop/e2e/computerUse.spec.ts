import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, say, shown, startTask, toConversation } from './support'

test('a task requests two desktop apps, transfers a note and keeps a screenshot', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-computer-'))
  const repo = repository(home)
  const { electronApp, page } = await launch(home, {
    ALTHAR_TEST_COMPUTER: process.env.ALTHAR_TEST_NATIVE_COMPUTER === '1' ? '0' : '1',
  })
  try {
    await openFirstProject(electronApp, page, repo)
    await startTask(page, 'Verify the desktop report')
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Open task/ }).click()
    await toConversation(page)
    await say(page, '[lead:computer] Verify the report using Writer and Reader.')

    const computer = page.getByRole('region', { name: 'Computer use' })
    await expect(computer.getByText('Waiting for you to approve computer use.')).toBeVisible()
    await computer.screenshot({ path: 'test-results/computer-use-approval.png' })
    await computer.getByRole('checkbox', { name: /Computer Writer fixture/ }).check()
    await computer.getByRole('checkbox', { name: /Computer Reader fixture/ }).check()
    await computer.getByRole('button', { name: 'Allow for this turn' }).click()

    await expect(shown(page, /Writer and Reader both show Reviewed report/)).toBeVisible()
    await expect(shown(page, /Kept the screenshot in the task conversation/)).toBeVisible()
    await expect(computer.getByText('Computer use stopped.')).toBeVisible()
  } finally {
    await electronApp.close()
  }
})
