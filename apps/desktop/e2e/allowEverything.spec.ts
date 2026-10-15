import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, say, startTask, toConversation } from './support'

/*
 * Allow everything (ADR-036), as the person meets it: a new project always
 * asks before deploying, so a lead's `make deploy` waits as a call whose
 * card says why it has no "always allow", and offers allowing everything on
 * the task. Taken, the call goes ahead, the task says Unrestricted beside
 * its menu, where its switch is on, and on its board card, and its next
 * deploy asks nothing. The project's own switch is on its rules screen, over
 * the sentences it quietens. The lead is the fake agent, which asks to run
 * what follows `run ` and runs nothing.
 */

const openRules = async (page: Page) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page
    .getByRole('dialog', { name: /’s settings$/ })
    .getByRole('button', { name: /^Rules/ })
    .click()
}

const shots = process.env.ALTHAR_SHOTS

test('allows everything on a task from a call its project always asks about, and says so wherever the task shows', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await startTask(page, 'Ship the fix')
    const card = page.getByRole('article', { name: 'Ship the fix' }).last()
    await expect(card.getByText('Ready', { exact: true })).toBeVisible()
    await card.getByRole('button', { name: /Open task/ }).click()
    await toConversation(page)

    // Deploying always asks, whatever else would answer: the card says so, with the ways out.
    await say(page, 'run make deploy')
    await expect(page.getByText('Needs your permission')).toBeVisible()
    await expect(page.getByRole('radio', { name: /Yes, and always allow/ })).toHaveCount(0)
    await expect(page.getByText(/meridian always asks you about this, so there’s no “always allow”/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Change it in Rules' })).toBeVisible()
    // The word beside the menu is followed by what it means, for a screen reader.
    const unrestricted = page.getByText(/^Unrestricted\b/)
    await expect(unrestricted).toHaveCount(0)
    await page.waitForTimeout(400)
    if (shots) await page.screenshot({ path: join(shots, 'app-held-card.png') })

    // Allowing everything on the task lets the call waiting through, and the header says so.
    await page.getByRole('button', { name: 'Allow everything on this task' }).click()
    await expect(page.getByText('chosen=allow_once')).toHaveCount(1)
    await expect(page.getByText('Needs your permission')).toHaveCount(0)
    await expect(unrestricted).toBeVisible()
    // The next deploy asks nothing.
    await say(page, 'run make deploy')
    await expect(page.getByText('chosen=allow_once')).toHaveCount(2)
    await expect(page.getByText('Needs your permission')).toHaveCount(0)
    await page.waitForTimeout(400)
    if (shots) await page.screenshot({ path: join(shots, 'app-unrestricted-task.png') })

    // Its switch is on in its menu.
    await page.getByRole('button', { name: 'More for this task' }).click()
    await expect(page.getByRole('menuitemcheckbox', { name: /Allow everything on this task/ })).toHaveAttribute('aria-checked', 'true')
    await page.waitForTimeout(400)
    if (shots) await page.screenshot({ path: join(shots, 'app-task-menu.png') })
    await page.keyboard.press('Escape')

    // Its card on the board says so too.
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await page.getByRole('radio', { name: /^Board/ }).click()
    const work = page.getByRole('region', { name: 'The project’s work' })
    await expect(work.getByRole('article').filter({ hasText: 'Ship the fix' }).getByText('Unrestricted')).toBeVisible()
    await page.waitForTimeout(400)
    if (shots) await page.screenshot({ path: join(shots, 'app-board-unrestricted.png') })

    // The project's switch, over the sentences it quietens; Never isn't one of them.
    await openRules(page)
    const allowAll = page.getByRole('switch', { name: 'Allow everything' })
    await expect(allowAll).not.toBeChecked()
    await expect(page.getByText('Off while everything is allowed.')).toHaveCount(0)
    await allowAll.click()
    await expect(allowAll).toBeChecked()
    await expect(page.getByText('Off while everything is allowed.')).toHaveCount(3)
    // Never isn't quietened: it still holds.
    await expect(page.getByRole('listitem', { name: 'Never' }).getByText('Off while everything is allowed.')).toHaveCount(0)
    await page.waitForTimeout(400)
    if (shots) await page.screenshot({ path: join(shots, 'app-rules-allow-everything.png') })
  } finally {
    await electronApp.close()
  }
})
