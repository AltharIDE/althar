import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { deviceWords } from '@althar/ui/device'
import { repository } from '../tests/repository'
import { launch, openFirstProject, still } from './support'

/*
 * Every agent Althar runs, as the window shows them all: Claude Code and
 * Codex scripted, on this computer, and the rest of the registry as it is,
 * none of them here (ALTHAR_FAKE_EVERY_AGENT). The first screen gives those
 * on this computer their rows and the rest a tile each under them; Settings
 * has a tab for each, on this computer first, and says for one that isn't
 * how to have it.
 */

const here = deviceWords(process.platform).this

test('shows every agent: those on this computer first, the rest to download or install', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_EVERY_AGENT: '1' })
  try {
    // The first screen: the two on this computer in rows, the other eight in tiles, those Althar can fetch first.
    const rows = page.getByRole('list', { name: `Agents on ${here}` })
    await expect(rows.getByRole('listitem').filter({ hasText: 'Claude Code' }).first()).toBeVisible()
    const away = page.getByRole('list', { name: `Agents not on ${here}` })
    await expect(away.getByRole('listitem')).toHaveCount(8)
    await expect(away.getByRole('listitem').first()).toContainText('OpenCode')
    await expect(away.getByRole('button', { name: /^Download GitHub Copilot, / })).toBeVisible()
    await expect(away.getByRole('button', { name: 'How to install Junie' })).toBeVisible()
    await still(page)
    await page.screenshot({ path: 'test-results/agents-start.png', animations: 'disabled' })

    // Settings, once there is a project: a tab for each, those on this computer first.
    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+Shift+Comma')
    await page.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'Agents' }).click()
    const tabs = page.getByRole('tablist', { name: 'Agents' })
    await expect(tabs.getByRole('tab')).toHaveCount(10)
    await expect(tabs.getByRole('tab').first()).toHaveAccessibleName(/^Claude Code/)
    await expect(tabs.getByRole('tab').nth(1)).toHaveAccessibleName(/^Codex/)
    // The rest, after them and quieter, say they aren't here.
    await expect(tabs.getByRole('tab', { name: new RegExp(`^Junie ?, not on ${here}$`) })).toBeVisible()
    await expect(tabs.getByRole('tab', { name: /^Codex/ })).not.toHaveAccessibleName(/not on/)
    const settings = page.getByRole('main')
    await expect(settings.getByRole('heading', { name: 'Claude Code', level: 2 })).toBeVisible()
    await page.screenshot({ path: 'test-results/agents-settings-claude-code.png', animations: 'disabled' })

    // One Althar can fetch: its size and where from, and the download.
    await tabs.getByRole('tab', { name: 'Google Antigravity' }).click()
    await expect(settings.getByText(/Althar can fetch Google Antigravity 1\.3\.0 from Google/)).toBeVisible()
    await expect(settings.getByRole('button', { name: 'Download Google Antigravity' })).toBeVisible()
    // Nothing yet of the models it may use: it says once it is here.
    await expect(settings.getByText('Models', { exact: true })).toHaveCount(0)
    await expect(settings.getByText('It hasn’t said what it offers yet.')).toHaveCount(0)
    await page.screenshot({ path: 'test-results/agents-settings-antigravity.png', animations: 'disabled' })

    // One only its own installer puts here: its maker's page on installing it.
    await tabs.getByRole('tab', { name: 'Junie' }).click()
    await expect(settings.getByRole('heading', { name: 'Junie', level: 2 })).toBeVisible()
    await expect(settings.getByRole('button', { name: 'Install it yourself' })).toBeVisible()
    await page.screenshot({ path: 'test-results/agents-settings-junie.png', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})
