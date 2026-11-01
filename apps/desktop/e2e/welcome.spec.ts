import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, still } from './support'

/*
 * The first run, as someone new to Althar has it: the welcome's tour, a
 * page for each of what Althar does, then the agents, the first project of a
 * repository found where people keep code, where its code is and a tracker,
 * and the project opened, its empty conversation asking for the code host
 * and a tracker not connected. Opened again, the window goes to the home.
 * Each step is shot at 1×, light, and the tour's last page and the agents
 * dark too, into the repository's test-results.
 */

const SHOTS = '../../test-results/welcome'

/** The welcome's card, shot at 1× once it is still. */
const shoot = async (page: Page, name: string) => {
  await still(page)
  await page
    .getByRole('region')
    .filter({ has: page.getByRole('heading', { level: 1 }) })
    .first()
    .screenshot({ path: `${SHOTS}/${name}.png`, scale: 'css' })
}

/** The same, in the dark appearance, then back. */
const shootDark = async (page: Page, name: string) => {
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark'
  })
  await shoot(page, name)
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light'
  })
}

test('walks a first run from the tour to the project, which asks for its code host and a tracker, and goes to the home after', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  repository(projects)
  mkdirSync(SHOTS, { recursive: true })
  // Every service Althar connects, as a person's own install offers them.
  let { electronApp, page } = await launch(home, { ALTHAR_FAKE_CONNECTORS: 'demo' })
  try {
    // The tour: four pages, each a scene of the real components, walked with Next.
    const pages = [
      ['ask', 'Tell the coordinator what you want'],
      ['build', 'Agents from different makers'],
      ['decide', 'Only the calls come to you'],
      ['review', 'Reviewed before you see it'],
    ] as const
    for (const [name, title] of pages) {
      await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible()
      // The scene plays out before it is shot.
      await page.waitForTimeout(name === 'decide' ? 13_000 : 10_000)
      await shoot(page, `1-tour-${name}`)
      if (name === 'review') await shootDark(page, '1-tour-review-dark')
      await page.getByRole('button', { name: name === 'review' ? 'Set up Althar' : 'Next' }).click()
    }

    // The agents on this computer, and those Althar can fetch; one ready is enough.
    await expect(page.getByRole('heading', { name: 'Your agents', level: 1 })).toBeVisible()
    await expect(page.getByRole('switch', { name: 'Crash reports' })).toBeVisible()
    await shoot(page, '2-agents')
    await shootDark(page, '2-agents-dark')
    await page.getByRole('button', { name: /^Continue/ }).click()

    // The first project, of the repository found.
    const found = page.getByRole('list', { name: 'Repositories for the project' })
    await found.getByRole('checkbox', { name: /meridian/ }).click()
    await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue('meridian')
    await shoot(page, '3-project')
    await page.getByRole('button', { name: /Make the project/ }).click()

    // Made, the welcome stays: where its code is, then a tracker, each can wait.
    await expect(page.getByRole('heading', { name: 'Pull requests', level: 1 })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Code hosts' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toHaveCount(0)
    await shoot(page, '4-code')
    await page.getByRole('button', { name: 'Not now' }).click()
    await expect(page.getByRole('list', { name: 'Trackers' })).toBeVisible()
    await shoot(page, '5-issues')
    await page.getByRole('button', { name: 'Open meridian' }).click()

    // The project, ready for its first message, its conversation asking for what the welcome didn't connect.
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    const card = page.getByRole('region', { name: 'Before the first pull request' })
    await expect(card).toBeVisible()
    await still(page)
    await card.screenshot({ path: `${SHOTS}/6-project-card.png`, scale: 'css' })
    await page.screenshot({ path: `${SHOTS}/6-project.png`, scale: 'css' })
  } finally {
    await electronApp.close()
  }

  // Opened again: the home, and no welcome.
  ;({ electronApp, page } = await launch(home, { ALTHAR_FAKE_CONNECTORS: 'demo' }))
  try {
    await expect(page.getByRole('complementary', { name: 'Projects' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Your agents', level: 1 })).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})
