import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, projectSettings, still } from './support'

test('keeps the project web switch across views and shows its privacy trade-off', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-web-setting-'))
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(home))
    await projectSettings(page, 'General')
    const toggle = page.getByRole('switch', { name: 'Leads can reach the web' })
    await expect(toggle).toBeChecked()
    await expect(page.getByText(/Pages could steer a lead into sending private code in a URL/)).toBeVisible()
    const row = page.locator('div').filter({ has: toggle, hasText: 'Leads can reach the web' }).last()
    await still(page)
    await row.screenshot({ path: 'test-results/web-reach-on-light.png', scale: 'css' })
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    await projectSettings(page, 'Rules')
    await projectSettings(page, 'General')
    await expect(toggle).not.toBeChecked()
    await page.emulateMedia({ colorScheme: 'dark' })
    await still(page)
    await row.screenshot({ path: 'test-results/web-reach-off-dark.png', scale: 'css' })
  } finally {
    await electronApp.close()
  }
})
