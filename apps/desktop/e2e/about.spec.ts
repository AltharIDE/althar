import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { author, repository } from '../tests/repository'
import { launch, openFirstProject, say, showPanes, sizeWindow, still } from './support'

/*
 * About Althar in the built app: its head under Early access with the ways out, storage as tiles, and the two
 * switches side by side, light and dark and at a narrow window. Then the way to free space, with a finished task's
 * folder there to free: Free up space lands on the task folders' row under Work on this computer, below the fold
 * at first, brought into view and lit for a moment, with Clean up focused; Clean up from the keyboard, and back on
 * About the task folders' tile is measured anew, smaller. Each shot is kept in test-results/about.
 */

const THIS_COMPUTER = process.platform === 'darwin' ? 'this Mac' : process.platform === 'win32' ? 'this PC' : 'this computer'
const TITLE = 'Sketch a status page prototype'
const ROW = 'Remove finished tasks’ folders'

const shoot = async (page: Page, name: string, settle = true) => {
  if (settle) await still(page)
  await page.screenshot({ path: `test-results/about/${name}.png`, scale: 'css' })
}

test('draws About Althar, and Free up space lands on the task folders, lit and focused, and the tile drops after', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  // What an install builds stays out of git, so a finished task's folder holding it can go.
  writeFileSync(join(repo, '.gitignore'), 'node_modules\n')
  execFileSync('git', ['add', '.'], { cwd: repo, env: { ...process.env, ...author } })
  execFileSync('git', ['commit', '-q', '-m', 'Ignore installs'], { cwd: repo, env: { ...process.env, ...author } })
  const worktrees = join(home, 'worktrees')
  /** The finished task's folder: the one repository worktree under the project's. */
  const folder = () => {
    const project = readdirSync(worktrees).find((name) => !name.startsWith('.'))
    const task = project === undefined ? undefined : readdirSync(join(worktrees, project)).find((name) => !name.startsWith('.'))
    return project === undefined || task === undefined ? null : join(worktrees, project, task, 'meridian')
  }
  const { electronApp, page } = await launch(home)
  const nav = () => page.getByRole('navigation', { name: 'Settings' })
  const section = async (name: RegExp) => {
    await page.keyboard.press('ControlOrMeta+Shift+Comma')
    await nav().getByRole('button', { name }).click()
  }
  const main = page.getByRole('main')
  const tasksTile = main.getByRole('listitem').filter({ hasText: 'Task folders' })
  try {
    await sizeWindow(electronApp, page, 1180, 760)
    await openFirstProject(electronApp, page, repo)
    await showPanes(page, { conversation: true, board: true })

    // Only when the person cleans up, so nothing goes by itself while the test runs.
    await section(/^Work on/)
    await main.getByRole('combobox', { name: ROW }).click()
    await page.getByRole('option', { name: 'Only when I clean up' }).click()
    await expect(main.getByRole('combobox', { name: ROW })).toHaveText(/Only when I clean up/)
    const tabs = page.getByRole('navigation', { name: 'Projects' })
    await tabs.getByRole('button', { name: 'Close Settings' }).click()
    await tabs.getByRole('button', { name: /^meridian/ }).click()

    // A quick task that finishes, settled with Done; what its install built takes 48 MB of its folder.
    const work = page.getByRole('region', { name: 'The project’s work' })
    await say(page, `${TITLE} [coordinator:start] [lead:finish] [lead:edit]`)
    await expect(work.getByText('Finished', { exact: true })).toBeVisible()
    await work.getByRole('button', { name: TITLE }).click()
    const header = page.getByRole('banner', { name: TITLE })
    await header.getByRole('button', { name: 'Done' }).click()
    await expect(header.getByText('Done', { exact: true })).toBeVisible()
    const kept = folder()
    expect(kept).not.toBeNull()
    mkdirSync(join(kept ?? '', 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(kept ?? '', 'node_modules', 'pkg', 'built.node'), Buffer.alloc(48 * 1024 ** 2, 3))

    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await section(/^About Althar/)
      await expect(main.getByText('Early access')).toBeVisible()
      await expect(main.getByRole('link', { name: /What’s new/ })).toHaveAttribute('href', 'https://althar.ai/changelog')
      await expect(main.getByRole('switch', { name: 'Usage data' })).toBeVisible()
      await expect(tasksTile).toContainText(/4\d MB/)
      await expect(tasksTile.getByText(/^\d+%$/)).toBeVisible()
      await shoot(page, `about-${scheme}`)
    }

    // A shorter window, kept from here: opened as usual, Work on this computer has Clean up below the fold.
    await page.emulateMedia({ colorScheme: 'light' })
    await sizeWindow(electronApp, page, 1180, 560)
    const clean = main.getByRole('button', { name: 'Clean up' })
    await nav()
      .getByRole('button', { name: /^Work on/ })
      .click()
    await expect(clean).toBeAttached()
    await still(page)
    await expect(clean).not.toBeInViewport()

    // Free up space, from the keyboard, at the same size: the row comes into view, lit, with Clean up focused.
    await nav()
      .getByRole('button', { name: /^About Althar/ })
      .click()
    await main.getByRole('button', { name: 'Free up space' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: `Work on ${THIS_COMPUTER}`, level: 1 })).toBeVisible()
    await expect(clean).toBeFocused()
    await expect(clean).toBeInViewport()
    const lit = page.locator('[class*="glow"]')
    await expect(lit).toHaveCount(1)
    await expect(lit).toContainText(ROW)
    await shoot(page, 'free-up-lit', false)
    await expect(lit).toHaveCount(0)
    await shoot(page, 'free-up-settled')

    // Clean up, from the keyboard; back on About the task folders are measured anew, the built 48 MB gone.
    await page.keyboard.press('Enter')
    await expect(main.getByText(/^Freed \d+ MB just now$/)).toBeVisible()
    await nav()
      .getByRole('button', { name: /^About Althar/ })
      .click()
    await expect(tasksTile).not.toContainText(/4\d MB/)
    await expect(tasksTile).toContainText(/\d+(\.\d)? (B|KB|MB)/)
    await shoot(page, 'about-after-clean-up')

    await sizeWindow(electronApp, page, 800, 800)
    await shoot(page, 'about-800')
  } finally {
    await electronApp.close()
  }
})
