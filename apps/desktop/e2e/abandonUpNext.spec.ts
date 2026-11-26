import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, planTask, showPanes, shown, still } from './support'

/*
 * A plan held up next is abandoned from its row's menu, asked first: it leaves Up next as the person presses, and Settled
 * says it was abandoned. Shots: test-results/abandon-upnext-*.png.
 */

test('abandons a held plan from its row up next, asked first', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home)
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1200, 800))
    await openFirstProject(electronApp, page, repository(projects))
    await planTask(page, 'Give projects a menu')
    await expect(shown(page, 'Give projects a menu', { exact: true }).last()).toBeVisible()
    await page.getByRole('button', { name: 'Hold', exact: true }).last().click()
    await expect(page.getByRole('region', { name: 'Conversation' }).getByText('Held', { exact: true })).toBeVisible()

    await showPanes(page, { conversation: false, board: true })
    const work = page.getByRole('region', { name: 'The project’s work' })
    const next = work.getByRole('region', { name: 'Up next' })
    const row = next.getByRole('article').filter({ hasText: 'Give projects a menu' })
    await row.hover()
    await row.getByRole('button', { name: 'The team' }).click()
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem', { name: 'Abandon' })).toBeVisible()
    await page.mouse.move(1180, 780)
    await still(page)
    await menu.screenshot({ path: 'test-results/abandon-upnext-menu.png', scale: 'css', animations: 'disabled' })

    await menu.getByRole('menuitem', { name: 'Abandon' }).click()
    const dialog = page.getByRole('dialog', { name: 'Abandon this task?' })
    await still(page)
    await dialog.screenshot({ path: 'test-results/abandon-upnext-dialog.png', scale: 'css', animations: 'disabled' })
    await dialog.getByRole('button', { name: 'Abandon task' }).click()

    await expect(dialog).toHaveCount(0)
    await expect(next.getByText('Give projects a menu')).toHaveCount(0)
    const settled = work.getByRole('region', { name: 'Settled' })
    await expect(settled.getByText('Give projects a menu')).toBeVisible()
    await expect(settled.getByText('Abandoned')).toBeVisible()
  } finally {
    await electronApp.close()
  }
})
