import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { chooseFolder, launch } from './support'

/*
 * The home, once there are projects: what waits on you, what is in progress, and what
 * the loop did, across projects, with the projects beside it; settings for
 * the agents and connections.
 */

/** A title as long as people write them, which the home's rows end in an ellipsis. */
const LONG = 'Help me add a new feature to the world where I can show other players walking around, with their names over them'

/** Plans a task in the open project with no review, as the person would, and starts it. */
const startTask = async (page: Page, title: string, lead: string) => {
  await page.getByRole('button', { name: 'New task' }).click()
  await page.getByLabel('What should change').fill(title)
  await page.getByLabel('Anything the lead should know').fill(lead)
  await page.getByRole('button', { name: /^Review:/ }).click()
  await page.getByRole('button', { name: 'No review' }).click()
  await page.getByRole('button', { name: 'Start the task' }).click()
}

test('comes back to what runs and what waits across projects, with the projects beside it', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const meridian = repository(home, 'meridian')
  const halyard = repository(home, 'halyard')
  const { electronApp, page } = await launch(home)
  const tabs = page.getByRole('navigation', { name: 'Projects' })
  try {
    // A task that keeps working in one project.
    await chooseFolder(electronApp, meridian)
    await page.getByRole('button', { name: /Open a folder/ }).click()
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await startTask(page, LONG, '[lead:wait]')
    await expect(page.getByText('Running', { exact: true }).first()).toBeVisible()
    await tabs.getByRole('button', { name: /^Home/ }).click()

    // The home has it running, and the project beside it.
    const projects = page.getByRole('complementary', { name: 'Projects' })
    await expect(projects.getByRole('button', { name: /meridian/ })).toBeVisible()
    await expect(page.getByRole('region', { name: /In progress/ }).getByRole('button', { name: LONG })).toBeVisible()

    // Another project, opened from the home, with a task that is soon ready.
    await chooseFolder(electronApp, halyard)
    await page.getByRole('button', { name: 'Open a folder' }).click()
    await expect(page.getByRole('heading', { name: 'halyard', level: 1 })).toBeVisible()
    await startTask(page, 'Name the limits better', '[lead:finish] [lead:edit]')
    await expect(page.getByText('Ready', { exact: true }).first()).toBeVisible()
    await tabs.getByRole('button', { name: /^Home/ }).click()

    // Ready to accept is what needs you; what the lead did shows since you looked.
    await expect(page.getByRole('heading', { name: 'Name the limits better', level: 3 })).toBeVisible()
    await expect(page.getByText('Implement finished')).toBeVisible()
    await expect(projects.getByRole('button', { name: /halyard/ })).toBeVisible()
    await page.screenshot({ path: 'test-results/home.png' })

    // Review opens the task itself, which leaves the home.
    await page.getByRole('button', { name: 'Review' }).click()
    await expect(page.getByRole('button', { name: 'Merge into main' })).toBeVisible()
    await expect(projects).toHaveCount(0)
    await page.screenshot({ path: 'test-results/home-task.png' })
    await page.getByRole('button', { name: 'Merge into main' }).click()
    // Back at the home, what was accepted no longer waits on you.
    await tabs.getByRole('button', { name: /^Home/ }).click()
    await expect(page.getByRole('heading', { name: 'Name the limits better', level: 3 })).toHaveCount(0)

    // Settings is a panel from the bar: the agents and their accounts, the code hosts, the app's icon and where Althar shows, kept in the profile.
    await page.keyboard.press('Meta+,')
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await expect(settings.getByText('Claude Code')).toBeVisible()
    await page.screenshot({ path: 'test-results/settings.png', animations: 'disabled' })
    await settings.getByRole('button', { name: /^Agents/ }).click()
    await expect(settings.getByRole('list', { name: 'Claude Code accounts' })).toBeVisible()
    await page.screenshot({ path: 'test-results/settings-agents.png', animations: 'disabled' })
    await settings.getByRole('button', { name: 'Back to all settings' }).click()
    // The icon is the Dock's, so where there is no Dock (Linux, as CI runs) there is none to choose.
    if (process.platform === 'darwin') {
      await settings.getByRole('button', { name: /^App icon/ }).click()
      const icons = settings.getByRole('radiogroup', { name: 'App icon' })
      await expect(icons.getByRole('radio', { name: 'Cobalt', exact: true })).toBeChecked()
      await icons.getByRole('radio', { name: 'Ink' }).click()
      await expect(icons.getByRole('radio', { name: 'Ink' })).toBeChecked()
      await expect.poll(() => readFileSync(join(home, 'profile', 'desktop.json'), 'utf8')).toContain('"icon": "ink"')
      await page.screenshot({ path: 'test-results/settings-icon.png', animations: 'disabled' })
      // Escape steps back to all of them, then closes the panel.
      await page.keyboard.press('Escape')
      await expect(settings.getByRole('button', { name: /^App icon/ })).toBeVisible()
    } else {
      await expect(settings.getByRole('button', { name: /^App icon/ })).toHaveCount(0)
    }
    // While the person is in another app, Althar shows round the notch, on a Mac that has one, or in the menu bar.
    // Only with a notch is there a choice; the edge is a page of its own, with what needs you and what runs.
    const edgePage = (place: string) => electronApp.windows().find((window) => window.url().includes(`place=${place}`))
    const edge = await page.evaluate(() => window.althar.edge())
    if (edge?.notch === true) {
      await expect.poll(() => edgePage('island') !== undefined).toBe(true)
      const island = edgePage('island')
      if (island !== undefined) await expect(island.getByRole('region', { name: 'Althar' })).toHaveCount(1)
      await settings.getByRole('button', { name: /^While you’re in another app/ }).click()
      const places = settings.getByRole('radiogroup', { name: 'While you’re in another app' })
      await expect(places.getByRole('radio', { name: /Round the notch/ })).toBeChecked()
      await places.getByRole('radio', { name: /In the menu bar/ }).click()
      await expect.poll(() => readFileSync(join(home, 'profile', 'desktop.json'), 'utf8')).toContain('"edge": "menu"')
      await expect.poll(() => edgePage('island') === undefined && edgePage('menu') !== undefined).toBe(true)
      await page.keyboard.press('Escape')
    } else {
      await expect(settings.getByRole('button', { name: /^While you’re in another app/ })).toHaveCount(0)
    }
    await page.keyboard.press('Escape')
    await expect(settings).toHaveCount(0)
    await expect(projects.getByRole('button', { name: /meridian/ })).toBeVisible()

    // ⌘2 opens the first project's tab, ⌘1 the home's.
    await page.keyboard.press('Meta+2')
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await page.keyboard.press('Meta+1')
    await expect(projects.getByRole('button', { name: /meridian/ })).toBeVisible()
  } finally {
    await electronApp.close()
  }
})
