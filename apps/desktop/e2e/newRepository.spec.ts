import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { chooseFolder, launch, openFirstProject, still } from './support'

/*
 * A project that starts from nothing: named, given a new repository in a
 * folder the person chose, named after it, and made only as the project is,
 * a git repository on main with a first commit its tasks branch from.
 */

test('starts a project from nothing, with a new repository made as the project is', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const meridian = repository(home, 'meridian')
  const code = join(home, 'code')
  mkdirSync(code)
  const { electronApp, page } = await launch(home)
  const tabs = page.getByRole('navigation', { name: 'Projects' })
  try {
    await openFirstProject(electronApp, page, meridian)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()

    await tabs.getByRole('button', { name: 'New project' }).click()
    const name = page.getByRole('textbox', { name: 'Name' })
    await expect(name).toBeFocused()
    await name.fill('Northwind Ops')
    await still(page)
    await page.screenshot({ path: 'test-results/new-repository-offered.png' })

    // Where it goes, by the picker: placed there, named after the project, and nothing made yet.
    await chooseFolder(electronApp, code)
    await page.getByRole('button', { name: 'New repository…' }).click()
    const folders = page.getByRole('list', { name: 'Its folders' })
    await expect(folders.getByText('new repository')).toBeVisible()
    await expect(folders.getByText('northwind-ops', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New repository…' })).toHaveCount(0)
    expect(existsSync(join(code, 'northwind-ops'))).toBe(false)
    await still(page)
    await page.screenshot({ path: 'test-results/new-repository-placed.png' })

    // Made with the project: a repository on main, with a first commit.
    await page.getByRole('button', { name: /^Create Northwind Ops/ }).click()
    await expect(page.getByRole('heading', { name: 'Northwind Ops', level: 1 })).toBeVisible()
    await expect(tabs.getByRole('button', { name: /^Northwind Ops/ })).toHaveAttribute('aria-current', 'page')
    const made = join(code, 'northwind-ops')
    expect(execFileSync('git', ['branch', '--show-current'], { cwd: made, encoding: 'utf8' }).trim()).toBe('main')
    expect(execFileSync('git', ['log', '--format=%s'], { cwd: made, encoding: 'utf8' }).trim()).toBe('Initial commit')
    await still(page)
    await page.screenshot({ path: 'test-results/new-repository-made.png' })
  } finally {
    await electronApp.close()
  }
})
