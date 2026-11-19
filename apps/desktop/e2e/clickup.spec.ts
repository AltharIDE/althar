import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Locator, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, projectSettings } from './support'

/*
 * ClickUp, as a person connects it: in Settings, under Code hosts and
 * trackers, with a personal token made in ClickUp's settings and pasted
 * here, on the demo profile, whose fake answers as ClickUp would. Then the
 * project's switch for linking a task's pull request on its issue, which on
 * ClickUp is a comment on the task. Shots: test-results/clickup-*.png.
 */

const shoot = (part: Locator, name: string) =>
  part.screenshot({ path: `test-results/clickup-${name}.png`, scale: 'css', animations: 'disabled' })

test('connects ClickUp by a pasted personal token, and the project can stop linking pull requests on issues', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_CONNECTORS: 'demo' })
  try {
    await openFirstProject(electronApp, page, repository(home))
    await page.keyboard.press('ControlOrMeta+Shift+Comma')
    await page
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('button', { name: /^Code hosts and trackers/ })
      .click()
    const main = page.getByRole('main')
    const trackers = main.getByRole('region', { name: 'Trackers', exact: true })
    await expect(trackers.getByText('ClickUp')).toBeVisible()
    await shoot(trackers, 'trackers')

    // Its one way in, so the walk opens on it: a token made in ClickUp's settings, under Apps.
    await trackers.getByRole('listitem').filter({ hasText: 'ClickUp' }).getByRole('button', { name: 'Connect' }).click()
    await expect(main.getByText('Make a token in ClickUp')).toBeVisible()
    await expect(main.getByText('Under API Token, Generate.')).toBeVisible()
    await shoot(main, 'make')
    await main.getByRole('button', { name: 'Paste it myself' }).click()
    await main.getByRole('textbox').fill('pk_81234567_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345')
    await main.getByRole('button', { name: 'Check' }).click()
    await expect(main.getByText('Connected as balazs')).toBeVisible()
    await expect(main.getByText('Reads your workspaces’ tasks')).toBeVisible()
    await shoot(main, 'connected')

    // The project's own switch: on until the person says.
    await page
      .getByRole('navigation', { name: 'Projects' })
      .getByRole('button', { name: /^meridian/ })
      .click()
    await projectSettings(page, 'Tasks')
    const link = page.getByRole('switch', { name: 'Link pull requests on their issues' })
    await expect(link).toHaveAttribute('aria-checked', 'true')
    await link.click()
    await expect(link).toHaveAttribute('aria-checked', 'false')
    // The rule's row, under its kin: what moves and links issues along with a task.
    await shoot(page.locator('section').filter({ has: link }).last(), 'link-issues-off')
  } finally {
    await electronApp.close()
  }
})
