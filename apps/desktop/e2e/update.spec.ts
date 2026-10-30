import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { expect, test } from '@playwright/test'

import { launch, still } from './support'

/*
 * An update whose migration can't run on the person's data: a profile made
 * by the version before, then the app again with a migration that always
 * fails (ALTHAR_FAIL_MIGRATION, a test hook). The window says so instead of
 * opening, the copy from before is in the profile's backups, Report this
 * opens Report a problem over it, and both the store and the copy are still
 * at the migration the version before left.
 */

/** The migration a database is at, read with SQLite alone, as nothing of Althar's would change it. */
const migrationOf = (path: string) => {
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    const checked = database.prepare('PRAGMA integrity_check').get()
    const latest = database.prepare('SELECT max(migration_id) AS at FROM schema_migrations').get()
    return { checked: checked?.integrity_check, at: latest?.at }
  } finally {
    database.close()
  }
}

test('an update that can’t move the data keeps a copy from before, leaves the data as it was, and says so', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-update-'))
  const profile = join(home, 'profile')

  const before = await launch(home)
  await expect(before.page.getByText('Claude Code').first()).toBeVisible()
  await before.electronApp.close()
  const was = migrationOf(join(profile, 'althar.sqlite'))
  expect(was).toEqual({ checked: 'ok', at: expect.any(Number) })

  const { electronApp, page } = await launch(home, { ALTHAR_FAIL_MIGRATION: '1' })
  let copy = ''
  try {
    await expect(page.getByRole('heading', { name: 'This update couldn’t move your data', level: 1 })).toBeVisible()
    if (process.platform !== 'darwin') await expect(page.getByRole('button', { name: 'Close the window' })).toHaveCount(1)
    await expect(page.getByRole('alert')).toContainText('Your data is safe. Althar made a copy of it before the update.')
    const copies = readdirSync(join(profile, 'backups'))
    expect(copies).toEqual([
      expect.stringMatching(new RegExp(`^althar-${String(was.at).padStart(4, '0')}-\\d{4}-\\d{2}-\\d{2}-\\d{6}\\.sqlite$`)),
    ])
    copy = join(profile, 'backups', copies[0] ?? '')
    await expect(page.getByRole('region', { name: 'Copy from before the update' })).toContainText(copies[0] ?? '')
    await expect(page.getByRole('region', { name: 'What stopped it' })).toContainText('no such table: no_such_table')
    await still(page)
    await page.screenshot({ path: 'test-results/update-stopped.png' })

    // Report this opens Report a problem over the page, about the update, with no runtime to ask: main says what it can itself.
    await page.getByRole('button', { name: 'Report this' }).click()
    const report = page.getByRole('dialog', { name: 'Report a problem' })
    await expect(report).toBeVisible()
    await expect(report).toContainText('About an update that couldn’t move your data.')
    await report.getByRole('button', { name: 'See what’s sent' }).click()
    await expect(report.getByText('Install id')).toBeVisible()
    await page.screenshot({ path: 'test-results/update-stopped-report.png', animations: 'disabled' })
    await report.getByRole('button', { name: 'Cancel' }).click()
    await expect(report).toBeHidden()
    await expect(page.getByRole('heading', { name: 'This update couldn’t move your data', level: 1 })).toBeVisible()

    // Main shows the copy in the file manager, by the path only it holds.
    await electronApp.evaluate(({ shell }) => {
      const shown: Array<string> = []
      Object.assign(globalThis, { shown })
      shell.showItemInFolder = (path) => void shown.push(path)
    })
    await page.getByRole('button', { name: /^Show in / }).click()
    await expect.poll(() => electronApp.evaluate(() => (globalThis as unknown as { shown: Array<string> }).shown)).toEqual([copy])
  } finally {
    await electronApp.close()
  }

  // The store and the copy are both at the migration the version before left, and whole.
  expect(migrationOf(join(profile, 'althar.sqlite'))).toEqual(was)
  expect(migrationOf(copy)).toEqual(was)
})
