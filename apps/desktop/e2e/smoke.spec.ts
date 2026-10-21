import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject } from './support'

/*
 * The least of the app that has to work on every system: it starts, shows
 * the first screen, and makes a project of a git repository. CI runs this
 * one on Windows, where nothing else of the suite runs yet.
 */

test('starts on the first screen and makes a project of a repository', async () => {
  // A space in the path, as in a Windows user's own folder.
  const home = mkdtempSync(join(tmpdir(), 'althar e2e '))
  const { electronApp, page } = await launch(home)
  try {
    await expect(page.getByRole('button', { name: /Add a folder/ })).toBeVisible()
    await openFirstProject(electronApp, page, repository(home))
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
  } finally {
    await electronApp.close()
  }
})
