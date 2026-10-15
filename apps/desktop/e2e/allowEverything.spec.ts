import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, planTask, say, startTask, toConversation } from './support'

/*
 * Allow everything (ADR-043), as the person meets it: a new project always
 * asks before deploying, so a lead's deploys, run at once as parallel tool
 * calls, wait as a stack whose card says why it has no "always allow", and
 * offers allowing everything on the task. Taken, the whole stack goes
 * ahead, the task says Unrestricted beside its menu, where its switch is on,
 * and on its board card, and its next deploy asks nothing. The project's
 * own switch is on its rules screen, over the sentences it quietens: turned
 * on while another task's stack waits, that stack goes ahead too, and every
 * task says Unrestricted, up next included. The lead is the fake agent,
 * which asks to run what follows `run ` (each of what follows `run each `,
 * at once) and runs nothing.
 */

const openRules = async (page: Page) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page
    .getByRole('dialog', { name: /’s settings$/ })
    .getByRole('button', { name: /^Rules/ })
    .click()
}

/** Opens a task from the project's conversation once its first turn is done, on its conversation. */
const openReady = async (page: Page, title: string) => {
  const card = page.getByRole('article', { name: title }).last()
  await expect(card.getByText('Ready', { exact: true })).toBeVisible()
  await card.getByRole('button', { name: /Open task/ }).click()
  await toConversation(page)
}

const shots = process.env.ALTHAR_SHOTS

const shoot = async (page: Page, name: string) => {
  await page.waitForTimeout(400)
  if (shots) await page.screenshot({ path: join(shots, name) })
}

test('allows everything on a task or a project, clearing what waits, and says so wherever a task shows', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await startTask(page, 'Ship the fix')
    await openReady(page, 'Ship the fix')

    // Three deploys at once: each always asks, whatever else would answer, and they wait as one stack. Its card says why, with the ways out.
    await say(page, 'run each make deploy; npm run deploy; ./deploy.sh')
    await expect(page.getByRole('button', { name: 'Allow all 3' })).toBeVisible()
    await expect(page.getByRole('radio', { name: /Yes, and always allow/ })).toHaveCount(0)
    await expect(page.getByText(/meridian always asks you about this, so there’s no “always allow”/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Change it in Rules' })).toBeVisible()
    // The word beside the menu is followed by what it means, for a screen reader.
    const unrestricted = page.getByText(/^Unrestricted\b/)
    await expect(unrestricted).toHaveCount(0)
    await shoot(page, 'app-burst-waiting.png')

    // Allowing everything on the task lets the whole stack through at once, and the header says so.
    await page.getByRole('button', { name: 'Allow everything on this task' }).click()
    await expect(page.getByText('chosen=allow_once,allow_once,allow_once')).toBeVisible()
    await expect(page.getByText('Needs your permission')).toHaveCount(0)
    await expect(unrestricted).toBeVisible()
    // The next deploy asks nothing.
    await say(page, 'run make deploy')
    await expect(page.getByText('chosen=allow_once', { exact: true })).toHaveCount(1)
    await expect(page.getByText('Needs your permission')).toHaveCount(0)
    await shoot(page, 'app-unrestricted-task.png')

    // Its switch is on in its menu.
    await page.getByRole('button', { name: 'More for this task' }).click()
    await expect(page.getByRole('menuitemcheckbox', { name: /Allow everything on this task/ })).toHaveAttribute('aria-checked', 'true')
    await shoot(page, 'app-task-menu.png')
    await page.keyboard.press('Escape')

    // Its card on the board says so too.
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await page.getByRole('radio', { name: /^Board/ }).click()
    const work = page.getByRole('region', { name: 'The project’s work' })
    const cardOf = (title: string) => work.getByRole('article').filter({ hasText: title })
    await expect(cardOf('Ship the fix').getByText('Unrestricted')).toBeVisible()
    await shoot(page, 'app-board-unrestricted.png')

    // Another task's deploys wait on the person, as a stack of its own: on the board, it needs you, and asks as ever.
    await page.getByRole('radio', { name: /^Conversation/ }).click()
    await startTask(page, 'Tag the release')
    await openReady(page, 'Tag the release')
    await say(page, 'run each make deploy; npm run deploy')
    await expect(page.getByRole('button', { name: 'Allow all 2' })).toBeVisible()
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await page.getByRole('radio', { name: /^Board/ }).click()
    // The card shows its oldest call: the agent asked for both at once, so either may be it.
    await expect(
      cardOf('Tag the release')
        .getByText(/make deploy|npm run deploy/)
        .first(),
    ).toBeVisible()
    await expect(cardOf('Tag the release').getByText('Unrestricted')).toHaveCount(0)
    await shoot(page, 'app-board-waiting.png')

    // The project's switch, over the sentences it quietens; Never isn't one of them.
    await openRules(page)
    const allowAll = page.getByRole('switch', { name: 'Allow everything' })
    await expect(allowAll).not.toBeChecked()
    await expect(page.getByText('Off while everything is allowed.')).toHaveCount(0)
    await allowAll.click()
    await expect(allowAll).toBeChecked()
    await expect(page.getByText('Off while everything is allowed.')).toHaveCount(3)
    await expect(page.getByRole('listitem', { name: 'Never' }).getByText('Off while everything is allowed.')).toHaveCount(0)
    await shoot(page, 'app-rules-allow-everything.png')
    await page.keyboard.press('Escape')

    // Turned on, the other task's stack went ahead: it waits on no one, and like every task in the project it says Unrestricted.
    await expect(cardOf('Tag the release').getByText('Unrestricted')).toBeVisible()
    await expect(cardOf('Tag the release').getByText(/make deploy|npm run deploy/)).toHaveCount(0)
    // A task planned now starts unrestricted, and says so up next.
    await page.getByRole('radio', { name: /^Conversation/ }).click()
    await planTask(page, 'Rotate the keys')
    await expect(page.getByRole('button', { name: 'Start now' }).last()).toBeVisible()
    await page.getByRole('radio', { name: /^Board/ }).click()
    await expect(cardOf('Rotate the keys').getByText('Unrestricted')).toBeVisible()
    await shoot(page, 'app-board-cleared.png')

    // Its own screen says so, beside its menu, over what went ahead.
    await cardOf('Tag the release').getByRole('button', { name: 'Tag the release' }).click()
    await toConversation(page)
    await expect(page.getByText('chosen=allow_once,allow_once')).toBeVisible()
    await expect(page.getByText('Needs your permission')).toHaveCount(0)
    await expect(unrestricted).toBeVisible()
    await shoot(page, 'app-project-unrestricted-task.png')
  } finally {
    await electronApp.close()
  }
})
