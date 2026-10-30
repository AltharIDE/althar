import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { chooseFolder, launch, openFirstProject, startTask } from './support'

/*
 * The home, once there are projects: what waits on you, what is in progress, and what
 * the loop did, across projects, with the projects beside it; settings for
 * the agents and connections.
 */

/** A title as long as the coordinator drafts them (60 characters at most), which the home's rows end in an ellipsis. */
const LONG = 'Show other players walking around with their names over them'

test('comes back to what runs and what waits across projects, with the projects beside it', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const meridian = repository(home, 'meridian')
  const halyard = repository(home, 'halyard')
  const { electronApp, page } = await launch(home)
  const tabs = page.getByRole('navigation', { name: 'Projects' })
  try {
    // A task that keeps working in one project.
    await openFirstProject(electronApp, page, meridian)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await startTask(page, LONG, '[lead:wait]')
    await expect(page.getByText('Running', { exact: true }).first()).toBeVisible()
    await tabs.getByRole('button', { name: /^Home/ }).click()

    // The home has it running in its project, at the side, and nothing in the middle asks for you; meridian's mark stands there instead.
    const projects = page.getByRole('complementary', { name: 'Projects' })
    await expect(projects.getByRole('button', { name: /^meridian.*1 task in progress/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Nothing needs you' })).toBeVisible()
    await expect(page.getByText('1 task moving in 1 project.')).toBeVisible()

    // Another project, made in a tab of its own from the home, with a task that is soon ready.
    await page.getByRole('complementary', { name: 'Projects' }).getByRole('button', { name: 'New project' }).click()
    await page.getByRole('textbox', { name: 'Name' }).fill('halyard')
    await chooseFolder(electronApp, halyard)
    await page.getByRole('button', { name: 'Choose a folder…' }).click()
    await expect(page.getByRole('list', { name: 'Its folders' }).getByText('halyard', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /^Create halyard/ }).click()
    await expect(page.getByRole('heading', { name: 'halyard', level: 1 })).toBeVisible()
    await startTask(page, 'Name the limits better', '[lead:finish] [lead:edit]')
    await expect(page.getByText('Ready', { exact: true }).first()).toBeVisible()
    await tabs.getByRole('button', { name: /^Home/ }).click()

    // Ready to accept is what needs you, under its project's name; what the lead did is under the line of what happened since you looked.
    await expect(page.getByRole('heading', { name: 'halyard', level: 3 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Name the limits better', level: 4 })).toBeVisible()
    await page.getByRole('button', { name: /since you looked/ }).click()
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
    await expect(page.getByRole('heading', { name: 'Name the limits better', level: 4 })).toHaveCount(0)

    // How hard the computer works shows at the end of the bar, as the runtime reads it; its peek says what each piece of work uses.
    const meter = page.getByRole('button', { name: /^CPU \d+%, MEM \d+%$/ })
    await expect(meter).toBeVisible()
    await meter.click()
    const load = page.getByRole('dialog', { name: /’s load$/ })
    await expect(load.getByText(/^\d+(\.\d)? GB of \d+(\.\d)? GB$/)).toBeVisible()
    await page.screenshot({ path: 'test-results/load.png', animations: 'disabled' })
    await page.keyboard.press('Escape')
    await expect(meter).toBeFocused()

    // Althar's quick settings are a panel from the gear at the bar's end, on every screen, with what is changed often. The
    // meter is turned off for every window from its card, and kept so; then back on.
    await page.keyboard.press('ControlOrMeta+Comma')
    const quick = page.getByRole('dialog', { name: 'Quick settings' })
    const showLoad = quick.getByRole('switch', { name: 'CPU and memory' })
    await expect(showLoad).toHaveAttribute('aria-checked', 'true')
    await page.screenshot({ path: 'test-results/settings-quick.png', animations: 'disabled' })
    await showLoad.click()
    await expect(meter).toHaveCount(0)
    await expect.poll(() => readFileSync(join(home, 'profile', 'desktop.json'), 'utf8')).toContain('"showLoad": false')
    await showLoad.click()
    await expect(meter).toBeVisible()

    // All settings is a tab of its own, beside the home's, in sections: the agents and their accounts, the code hosts,
    // reviews and Althar as co-author, the app's icon and where Althar shows, kept in the profile.
    await quick.getByRole('button', { name: /^All settings/ }).click()
    await expect(quick).toHaveCount(0)
    await expect(tabs.getByRole('button', { name: /^Settings/ })).toHaveAttribute('aria-current', 'page')
    const section = (name: string) => page.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name }).click()
    await expect(page.getByRole('list', { name: 'Claude Code accounts' })).toBeVisible()
    await page.screenshot({ path: 'test-results/settings-agents.png', animations: 'disabled' })
    // The icon is the Dock's, so where there is no Dock (Linux, as CI runs) there is none to choose.
    await section('Appearance')
    if (process.platform === 'darwin') {
      const icons = page.getByRole('radiogroup', { name: 'App icon' })
      await expect(icons.getByRole('radio', { name: 'Cobalt', exact: true })).toBeChecked()
      await icons.getByRole('radio', { name: 'Ink' }).click()
      await expect(icons.getByRole('radio', { name: 'Ink' })).toBeChecked()
      await expect.poll(() => readFileSync(join(home, 'profile', 'desktop.json'), 'utf8')).toContain('"icon": "ink"')
      await page.screenshot({ path: 'test-results/settings-icon.png', animations: 'disabled' })
    } else {
      await expect(page.getByRole('radiogroup', { name: 'App icon' })).toHaveCount(0)
    }
    // While the person is in another app, Althar shows round the notch, on a Mac that has one, or in the menu bar or the
    // system tray. Only with a notch is there a choice; elsewhere its section says where. The edge is a page of its own, with
    // what needs you and what runs.
    const edgePage = (place: string) => electronApp.windows().find((window) => window.url().includes(`place=${place}`))
    const edge = await page.evaluate(() => window.althar.edge())
    if (edge?.notch === true) {
      await expect.poll(() => edgePage('island') !== undefined).toBe(true)
      const island = edgePage('island')
      if (island !== undefined) await expect(island.getByRole('region', { name: 'Althar' })).toHaveCount(1)
      const places = page.getByRole('radiogroup', { name: 'In other apps' })
      await expect(places.getByRole('radio', { name: /Round the notch/ })).toBeChecked()
      await places.getByRole('radio', { name: /In the menu bar/ }).click()
      await expect.poll(() => readFileSync(join(home, 'profile', 'desktop.json'), 'utf8')).toContain('"edge": "menu"')
      // While Althar is in front, its mark leaves the menu bar: the person goes to another app to see it there, and comes back.
      const inAnotherApp = (away: boolean) =>
        electronApp.evaluate(({ app, BrowserWindow }, away) => {
          const kept = globalThis as { focused?: () => Electron.BrowserWindow | null }
          kept.focused ??= BrowserWindow.getFocusedWindow.bind(BrowserWindow)
          BrowserWindow.getFocusedWindow = away ? () => null : kept.focused
          app.emit(away ? 'browser-window-blur' : 'browser-window-focus')
        }, away)
      await inAnotherApp(true)
      await expect.poll(() => edgePage('island') === undefined && edgePage('menu') !== undefined).toBe(true)
      await inAnotherApp(false)
    } else {
      // Nothing to choose: where it is, in words.
      await expect(page.getByRole('radiogroup', { name: 'In other apps' })).toHaveCount(0)
      await expect(page.getByText(/^(In the menu bar|In the system tray|Only in Althar’s window)$/)).toBeVisible()
    }
    // Althar as co-author, beside posting the team's reviews; turned off, it asks once, large, why it would stay.
    await section('Reviews and pull requests')
    const credit = page.getByRole('switch', { name: 'Althar as co-author' })
    await expect(credit).toHaveAttribute('aria-checked', 'true')
    await credit.click()
    await expect(page.getByText('Althar is free, and we have no marketing budget.')).toBeVisible()
    await page.screenshot({ path: 'test-results/settings-co-author-off.png', animations: 'disabled' })
    await page.getByRole('button', { name: 'Put Althar back on your commits' }).click()
    await expect(credit).toHaveAttribute('aria-checked', 'true')
    // The code hosts beside the trackers: Connect walks GitHub's way in, in place of them, and its way back returns to them.
    await section('Code hosts and trackers')
    await page.getByRole('list', { name: 'Code hosts' }).getByRole('button', { name: 'Connect' }).click()
    await expect(page.getByRole('group', { name: 'Ways to connect GitHub' })).toBeVisible()
    await page.screenshot({ path: 'test-results/settings-connect.png', animations: 'disabled' })
    await page.getByRole('button', { name: 'Back to code hosts and trackers' }).click()
    await expect(page.getByRole('list', { name: 'Code hosts' })).toBeVisible()
    // Closed, the tab after it has the window: meridian's. The home's is a press away.
    await tabs.getByRole('button', { name: 'Close Settings' }).click()
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await tabs.getByRole('button', { name: /^Home/ }).click()
    await expect(projects.getByRole('button', { name: /meridian/ })).toBeVisible()

    // ⌘2 (Ctrl+2 elsewhere) opens the first project's tab, ⌘1 the home's.
    await page.keyboard.press('ControlOrMeta+2')
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+1')
    await expect(projects.getByRole('button', { name: /meridian/ })).toBeVisible()
  } finally {
    await electronApp.close()
  }
})
