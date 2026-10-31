import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, planTask, projectSettings, say, shown, startTask, still, toConversation } from './support'

/*
 * Allow everything (ADR-043), as the person meets it: a new project always
 * asks before deploying, so a lead's deploys, run at once as parallel tool
 * calls, wait as a stack whose card says why it has no "always allow", and
 * offers allowing everything on the task. Taken, the whole stack goes
 * ahead, its switch is on in its menu, and its next deploy asks nothing. The project's
 * own switch is in its rules, over the sentences it quietens: turned
 * on while another task's stack waits, that stack goes ahead too. The lead is the fake agent,
 * which asks to run what follows `run ` (each of what follows `run each `,
 * at once) and runs nothing.
 */

/** The project's rules, a section of its settings. */
const openRules = (page: Page) => projectSettings(page, 'Rules')

/** Opens a task from the project's conversation once its first turn is done, on its conversation. */
const openReady = async (page: Page, title: string) => {
  const card = page.getByRole('article', { name: title }).last()
  await expect(card.getByText('Ready', { exact: true })).toBeVisible()
  await card.getByRole('button', { name: /Open task/ }).click()
  await toConversation(page)
}

const shots = process.env.ALTHAR_SHOTS

const shoot = async (page: Page, name: string) => {
  await still(page)
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
    await expect(page.getByText('meridian always asks about this.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Change it in Rules' })).toBeVisible()
    await shoot(page, 'app-burst-waiting.png')

    // Allowing everything on the task lets the whole stack through at once.
    await page.getByRole('button', { name: 'Allow everything on this task' }).click()
    await expect(page.getByText('chosen=allow_once,allow_once,allow_once')).toBeVisible()
    await expect(page.getByText('Needs your permission')).toHaveCount(0)
    // The next deploy asks nothing.
    await say(page, 'run make deploy')
    await expect(page.getByText('chosen=allow_once', { exact: true })).toHaveCount(1)
    await expect(page.getByText('Needs your permission')).toHaveCount(0)
    await shoot(page, 'app-allowed-task.png')

    // Its switch is on in its menu.
    await page.getByRole('button', { name: 'More for this task' }).click()
    await expect(page.getByRole('menuitemcheckbox', { name: /Allow everything on this task/ })).toHaveAttribute('aria-checked', 'true')
    await shoot(page, 'app-task-menu.png')
    await page.keyboard.press('Escape')

    // Its card on the board.
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await page.getByRole('radio', { name: /^Board/ }).click()
    const work = page.getByRole('region', { name: 'The project’s work' })
    const cardOf = (title: string) => work.getByRole('article').filter({ hasText: title })
    await expect(cardOf('Ship the fix')).toBeVisible()
    await shoot(page, 'app-board-allowed.png')

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
    await page.getByRole('radio', { name: /^Board/ }).click()

    // Turned on, the other task's stack went ahead: it waits on no one.
    await expect(cardOf('Tag the release').getByText(/make deploy|npm run deploy/)).toHaveCount(0)
    // A task planned now is up next.
    await page.getByRole('radio', { name: /^Conversation/ }).click()
    await planTask(page, 'Rotate the keys')
    await expect(page.getByRole('button', { name: 'Start now' }).last()).toBeVisible()
    await page.getByRole('radio', { name: /^Board/ }).click()
    await expect(cardOf('Rotate the keys')).toBeVisible()
    await shoot(page, 'app-board-cleared.png')

    // Its own screen shows what went ahead.
    await cardOf('Tag the release').getByRole('button', { name: 'Tag the release' }).click()
    await toConversation(page)
    await expect(page.getByText('chosen=allow_once,allow_once', { exact: true })).toBeVisible()
    await expect(shown(page, 'Needs your permission')).toHaveCount(0)
    await shoot(page, 'app-project-allowed-task.png')
  } finally {
    await electronApp.close()
  }
})
