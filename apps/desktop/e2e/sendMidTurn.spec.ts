import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject } from './support'

/* Settings › Tasks: what sending does while an agent is mid-turn, queue to start, and steer once chosen. */
test('Settings › Tasks chooses whether a message sent mid-turn queues or steers', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const { electronApp, page } = await launch(home)
  try {
    await page.setViewportSize({ width: 1180, height: 800 })
    await openFirstProject(electronApp, page, repository(home))
    await page.keyboard.press('ControlOrMeta+Shift+Comma')
    await page
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('button', { name: /^Tasks/ })
      .click()
    const group = page.getByRole('radiogroup', { name: 'When I send while an agent is working' })
    await expect(group.getByRole('radio', { name: 'Queue it' })).toBeChecked()
    await page.screenshot({ path: 'test-results/send-mid-turn-queue.png', scale: 'css', animations: 'disabled' })
    await group.getByRole('radio', { name: 'Steer the agent' }).click()
    await expect(group.getByRole('radio', { name: 'Steer the agent' })).toBeChecked()
    await page.screenshot({ path: 'test-results/send-mid-turn-steer.png', scale: 'css', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})
