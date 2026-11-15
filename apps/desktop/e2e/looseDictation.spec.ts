import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { chooseFolder, launch, openFirstProject, still } from './support'

/*
 * Dictating from anywhere, in the built app: on the home, with no composer on
 * screen, the shortcut offers the speech model the first time, then listens,
 * and the pill at the window's foot says it isn't placed yet. The same key
 * stops it; the person chooses another project, and what they said waits in
 * its coordinator's composer, not sent. Chromium's fake microphone and the
 * speech process's stand-in model (ALTHAR_FAKE_SPEECH) stand in for a voice.
 */

test('starts away from any composer, and is placed in another project', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const meridian = repository(home, 'meridian')
  const halyard = repository(home, 'halyard')
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_SPEECH: '1' })
  const tabs = page.getByRole('navigation', { name: 'Projects' })
  try {
    await openFirstProject(electronApp, page, meridian)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    // Another project, in a tab of its own.
    await page.keyboard.press('ControlOrMeta+n')
    await page.getByRole('textbox', { name: 'Name' }).fill('halyard')
    await chooseFolder(electronApp, halyard)
    await page.getByRole('button', { name: 'Choose a folder…' }).click()
    await page.getByRole('button', { name: /^Create halyard/ }).click()
    await expect(page.getByRole('heading', { name: 'halyard', level: 1 })).toBeVisible()

    // The home has no composer: the shortcut is the window's, and the first time offers the speech model.
    await tabs.getByRole('button', { name: /^Home/ }).click()
    await expect(page.getByRole('textbox', { name: /^Tell .* something/ })).toHaveCount(0)
    await page.keyboard.press('ControlOrMeta+Shift+KeyD')
    const tray = page.getByRole('group', { name: 'Dictation' })
    await expect(tray.getByText(/^Dictation needs a speech model on this/)).toBeVisible()
    await tray.getByRole('button', { name: 'Download' }).click()

    // Listening, not placed anywhere yet, and it follows the person.
    const listening = page.getByRole('group', { name: 'Not placed yet' })
    await expect(listening).toBeVisible()
    await expect(tray).toBeHidden()
    await expect(listening).toContainText('Also check the webhook retry path')
    await page.screenshot({ path: 'test-results/loose-dictation-listening.png', animations: 'disabled', scale: 'css' })
    await page.keyboard.press('ControlOrMeta+Shift+KeyD')

    // Written down, and chosen where it goes: halyard, not the project it was said near.
    const written = page.getByRole('region', { name: 'Not placed yet' })
    await expect(written.getByRole('textbox', { name: 'What you said' })).toHaveValue('Also check the webhook retry path.')
    await still(page)
    await page.screenshot({ path: 'test-results/loose-dictation-written.png', animations: 'disabled', scale: 'css' })
    await written.getByRole('button', { name: 'Place it in…' }).click()
    const search = page.getByRole('dialog', { name: 'Search' })
    // The projects to choose from, and nothing to ask or start.
    await expect(search.getByRole('option', { name: /^halyard/ })).toBeVisible()
    await expect(search.getByRole('option', { name: /^meridian/ })).toBeVisible()
    await still(page)
    await page.screenshot({ path: 'test-results/loose-dictation-place.png', animations: 'disabled', scale: 'css' })
    await search.getByRole('combobox').fill('halyard')
    await expect(search.getByRole('option', { name: /^halyard/ }).first()).toBeVisible()
    await expect(search.getByRole('option', { name: /^Ask the coordinator/ })).toHaveCount(0)
    await search.getByRole('combobox').press('Enter')

    // In halyard's coordinator composer, written and not sent; nothing is carried on.
    await expect(page.getByRole('heading', { name: 'halyard', level: 1 })).toBeVisible()
    const box = page.getByRole('textbox', { name: /^Tell .* something/ })
    await expect(box).toHaveValue('Also check the webhook retry path.')
    await expect(page.getByRole('region', { name: 'Not placed yet' })).toHaveCount(0)
    await still(page)
    await page.screenshot({ path: 'test-results/loose-dictation-placed.png', animations: 'disabled', scale: 'css' })

    // The composer's microphone says the same shortcut.
    await page.getByRole('button', { name: 'Dictate', exact: true }).hover()
    const tip = page.getByRole('tooltip')
    await expect(tip).toContainText(/(⌘⇧|Ctrl\+Shift\+)D/)
    await page.screenshot({
      path: 'test-results/loose-dictation-tooltip.png',
      animations: 'disabled',
      scale: 'css',
      clip: { x: 640, y: 680, width: 330, height: 160 },
    })
  } finally {
    await electronApp.close()
  }
})
