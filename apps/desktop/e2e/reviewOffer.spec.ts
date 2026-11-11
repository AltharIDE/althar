import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { connectGitHub, launch, openFirstProject, still, toConversation } from './support'

/*
 * A change whose plan has no review, once its pull request is up, offers one, quietly, in its task view by the composer: the person adds it
 * and a review round runs on the pushed head, or turns it down and it doesn't come back. In a real window, with the fake
 * agent and the fake GitHub. Its shots are test-results/review-offer-*.png.
 */

const setup = async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const remote = join(home, 'api.git')
  execFileSync('git', ['init', '-q', '--bare', remote])
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.test/meridian/api.git'], { cwd: repo })
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_REMOTE: remote })
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1200, 800))
  await openFirstProject(electronApp, page, repo)
  await connectGitHub(page)
  const box = page.getByRole('textbox', { name: /^(Tell the coordinator something|Add to the queue)/ })
  await box.fill('Rate-limit refunds per partner. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [review:pass]')
  await box.press('Enter')
  await page.getByRole('button', { name: 'Start now' }).click()
  await expect(page.getByText('PR #1')).toBeVisible()
  return { electronApp, page }
}

const toTask = async (page: Page) => {
  await page.getByRole('button', { name: /Open task/ }).click()
  await toConversation(page)
}

test('offers a review in the task view of a change with a pull request and no review, and adds it on the pushed head', async () => {
  const { electronApp, page } = await setup()
  try {
    await toTask(page)
    const offer = page.getByText('Add a review?')
    await expect(offer).toBeVisible()
    // Quiet, by the composer: not on the board's card.
    await page.mouse.move(1190, 300)
    await still(page)
    await page.screenshot({
      path: 'test-results/review-offer-task.png',
      scale: 'css',
      animations: 'disabled',
      clip: { x: 300, y: 560, width: 680, height: 240 },
    })

    // Adding it starts a round on the head: the offer goes, and the thread has the review.
    await page.getByRole('button', { name: 'Add Small' }).click()
    await expect(offer).toHaveCount(0)
    // The reviewer read the head: a review that passed, as a line of the conversation.
    await expect(page.locator('[data-review]').filter({ hasText: 'Passed' })).toBeVisible()
    await still(page)
    await page.screenshot({ path: 'test-results/review-offer-added.png', scale: 'css', animations: 'disabled' })

    // Nor on the board.
    await page.getByRole('button', { name: /^Back to / }).click()
    await page.getByRole('radio', { name: 'Home' }).click()
    await expect(page.getByRole('region', { name: 'The project’s work' }).getByRole('article')).toBeVisible()
    await expect(page.getByText('Add a review?')).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})

test('keeps the offer off the board, turns it down in the task view, and it does not come back', async () => {
  const { electronApp, page } = await setup()
  try {
    await page.getByRole('radio', { name: 'Home' }).click()
    const work = page.getByRole('region', { name: 'The project’s work' })
    const card = work.getByRole('article').filter({ hasText: 'Rate-limit refunds' })
    await expect(card).toBeVisible()
    await expect(work.getByText('Add a review?')).toHaveCount(0)
    await card.click()
    await toConversation(page)
    await page.getByRole('button', { name: 'No thanks' }).click()
    await expect(page.getByText('Add a review?')).toHaveCount(0)
    await page.getByRole('button', { name: /^Back to / }).click()
    await page.getByRole('radio', { name: 'Home' }).click()
    await card.click()
    await toConversation(page)
    await expect(page.getByRole('textbox', { name: /^Tell / })).toBeVisible()
    await expect(page.getByText('Add a review?')).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})
