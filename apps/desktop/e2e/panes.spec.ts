import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { expectPanes, launch, openFirstProject, planTask, say, showPanes, sizeWindow, still } from './support'

/*
 * A project's home in a real window: its conversation and board, either
 * hidden by its toggle at the end of the header, one always showing; the
 * conversation on either side; its composer under the board while the
 * conversation is hidden, which brings the conversation back as it sends.
 * The header never moves as they are pressed. Its shots are
 * test-results/panes-*.png, light and dark.
 */

/** Where the panes' toggles stand on the screen, and how wide they are: what must not move as they are pressed. */
const placeOf = async (page: Page) => {
  const box = await page.getByRole('group', { name: 'Panes' }).boundingBox()
  return box === null ? null : { x: Math.round(box.x), width: Math.round(box.width) }
}

for (const appearance of ['light', 'dark'] as const) {
  test(`shows and hides either pane, swaps their sides, and keeps the header still, ${appearance}`, async () => {
    const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
    const projects = join(home, 'Projects')
    mkdirSync(projects)
    mkdirSync(join(home, 'profile'), { recursive: true })
    writeFileSync(join(home, 'profile', 'desktop.json'), JSON.stringify({ appearance }))
    const { electronApp, page } = await launch(home, {}, { scheme: 'system' })
    const shoot = async (name: string) => {
      await still(page)
      await page.screenshot({ path: `test-results/panes-${name}-${appearance}.png`, animations: 'disabled', scale: 'css' })
    }
    try {
      await sizeWindow(electronApp, page, 1440, 860)
      await openFirstProject(electronApp, page, repository(projects))
      await planTask(page, 'Retry webhook deliveries with backoff')
      await showPanes(page, { conversation: true, board: true })
      const work = page.getByRole('region', { name: 'The project’s work' })
      const conversation = page.getByRole('region', { name: 'Conversation' })
      await expect(work.getByText('Retry webhook deliveries with backoff')).toBeVisible()
      const place = await placeOf(page)
      await shoot('1-both')

      // The board hidden by b, from outside the composer, where it is a letter: the conversation alone; its toggle can't hide it too.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await page.keyboard.press('b')
      await expectPanes(page, { conversation: true, board: false })
      await expect(work).toHaveCount(0)
      await expect(page.getByRole('group', { name: 'Panes' }).getByRole('button', { name: 'Conversation' })).toHaveAttribute(
        'aria-disabled',
        'true',
      )
      await expect(page.getByRole('button', { name: 'Swap sides' })).toHaveAttribute('aria-disabled', 'true')
      expect(await placeOf(page)).toEqual(place)
      await shoot('2-conversation')

      // The conversation hidden: the board, its composer under it; sending there brings the conversation back.
      await page.keyboard.press('b')
      await page.keyboard.press('c')
      await expectPanes(page, { conversation: false, board: true })
      await expect(conversation).toHaveCount(0)
      expect(await placeOf(page)).toEqual(place)
      await shoot('3-board')
      await say(page, 'What is up next?')
      await expectPanes(page, { conversation: true, board: true })
      await expect(conversation.getByText('What is up next?')).toBeVisible()

      // Swapped: the conversation on the right.
      await page.getByRole('button', { name: 'Swap sides' }).click()
      await expect(page.getByRole('button', { name: 'Swap sides' })).toHaveAttribute('aria-pressed', 'true')
      const left = async () => Math.round((await conversation.boundingBox())?.x ?? 0)
      expect(await left()).toBeGreaterThan(700)
      expect(await placeOf(page)).toEqual(place)
      await shoot('4-swapped')

      // Away from the home, the toggles stay where they are; one goes back home with its pane.
      await page
        .getByRole('radiogroup', { name: 'View' })
        .getByRole('radio', { name: /^Settings/ })
        .click()
      await expectPanes(page, { conversation: false, board: false })
      expect(await placeOf(page)).toEqual(place)
      await page
        .locator('header')
        .filter({ has: page.getByRole('heading', { level: 1 }) })
        .screenshot({ path: `test-results/panes-5-away-${appearance}.png`, scale: 'css' })
      await page.getByRole('group', { name: 'Panes' }).getByRole('button', { name: 'Board' }).click()
      await expectPanes(page, { conversation: true, board: true })
    } finally {
      await electronApp.close()
    }
  })
}
