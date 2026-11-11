import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { connectGitHub, launch, openFirstProject, still, toConversation } from './support'

/*
 * A change whose plan has no review, once its pull request is up, offers one, quietly, on its board card: the person adds it
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

test('offers a review on the card of a change with a pull request and no review, and adds it on the pushed head', async () => {
  const { electronApp, page } = await setup()
  try {
    await page.getByRole('radio', { name: 'Home' }).click()
    const work = page.getByRole('region', { name: 'The project’s work' })
    const card = work.getByRole('article').filter({ hasText: 'Rate-limit refunds' })
    await expect(card.getByText('Add a review?')).toBeVisible()
    await still(page)
    await card.screenshot({ path: 'test-results/review-offer-card.png', scale: 'css', animations: 'disabled' })

    // Adding it starts a round on the head: the offer goes, and the thread has the review.
    await card.getByRole('button', { name: /^Add / }).click()
    await expect(card.getByText('Add a review?')).toHaveCount(0)
    await card.click()
    await toConversation(page)
    // The reviewer read the head: a review that passed, as a line of the conversation.
    await expect(page.locator('[data-review]').filter({ hasText: 'Passed' })).toBeVisible()
    await still(page)
    await page.screenshot({ path: 'test-results/review-offer-added.png', scale: 'css', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})

test('turns the offer down, and it does not come back', async () => {
  const { electronApp, page } = await setup()
  try {
    await page.getByRole('radio', { name: 'Home' }).click()
    const work = page.getByRole('region', { name: 'The project’s work' })
    const card = work.getByRole('article').filter({ hasText: 'Rate-limit refunds' })
    await card.getByRole('button', { name: 'No thanks' }).click()
    await expect(card.getByText('Add a review?')).toHaveCount(0)
    await page.getByRole('radio', { name: 'Home' }).click()
    await expect(card.getByText('Add a review?')).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})
