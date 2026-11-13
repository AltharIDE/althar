import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { connectGitHub, launch, openFirstProject, still, toConversation } from './support'

/*
 * A review is offered only where an agent offers it: a change whose plan has no review, its pull request up, shows nothing by
 * itself; the person asks its lead to harden it, and the lead offers a review (`offer_review`), a line of the thread with Add
 * and No thanks. Added, a review round runs on the pushed head; turned down, it isn't offered again. In a real window, with the
 * fake agent and the fake GitHub. Its shots are test-results/review-offer-*.png.
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

/** What the person tells the task's lead, from its composer. */
const tell = async (page: Page, words: string) => {
  const box = page.getByRole('textbox', { name: /^(Tell .* something|Add to the queue)/ })
  await box.fill(words)
  await box.press('Enter')
}

const offerLine = (page: Page) => page.locator('p').filter({ hasText: /^Add a review\?/ })

test('offers a review only once the lead offers it, as a line of the thread, and Add reviews the pushed head', async () => {
  const { electronApp, page } = await setup()
  try {
    await toTask(page)
    // Nothing by a rule: a change with no review and its pull request up offers nothing by itself.
    await expect(page.locator('[data-review]')).toHaveCount(0)
    await expect(offerLine(page)).toHaveCount(0)
    await tell(page, 'Harden it into a real change. [lead:offer-review]')
    const line = offerLine(page)
    await expect(line).toBeVisible()
    await page.mouse.move(1190, 300)
    await still(page)
    await line.scrollIntoViewIfNeeded()
    const box = await line.boundingBox()
    await page.screenshot({
      path: 'test-results/review-offer-line.png',
      scale: 'css',
      animations: 'disabled',
      clip: { x: Math.max(0, (box?.x ?? 300) - 40), y: Math.max(0, (box?.y ?? 400) - 160), width: 720, height: 220 },
    })

    // Add starts a round on the head: the reviewer read it and it passed, and the line says who reviews it.
    await line.getByRole('button', { name: /^Add / }).click()
    await expect(page.locator('[data-review]').filter({ hasText: 'Passed' })).toBeVisible()
    await expect(line).toContainText('reviews it.')
    await expect(line.getByRole('button')).toHaveCount(0)
    await still(page)
    await page.screenshot({ path: 'test-results/review-offer-added.png', scale: 'css', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})

test('turns the offered review down, and the lead cannot offer it again', async () => {
  const { electronApp, page } = await setup()
  try {
    await toTask(page)
    await tell(page, 'Harden it. [lead:offer-review]')
    const line = offerLine(page)
    await line.getByRole('button', { name: 'No thanks' }).click()
    await expect(line).toContainText('No review.')
    await expect(line.getByRole('button')).toHaveCount(0)
    // Asked again, the lead is told it was turned down, and no new offer stands.
    await tell(page, 'Make it real after all. [lead:offer-review]')
    await expect(page.getByText(/isn't offered again/).first()).toBeVisible()
    await expect(offerLine(page)).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'No thanks' })).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})
