import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, projectSettings } from './support'

/*
 * A project's Settings › Running with a long list, in a real window: dozens
 * of labs and prototypes added from package.json, the list searched and cut
 * to its first few, light and dark; Where its work goes goes to the Tasks
 * where that is set; and Ask the coordinator leaves Settings for the
 * coordinator's conversation, its request in the composer after what the
 * person had written there, unsent. The screenshots are this change's own
 * evidence (test-results/running-*.png).
 */

const LABS = [
  'thread',
  'preset-offer',
  'scratch',
  'new-project',
  'drafting',
  'search',
  'errand',
  'graph',
  'ship',
  'blockers',
  'homes',
  'import',
]
const PROTOTYPES = ['task-setup', 'handoff', 'clear-chat', 'capable', 'browser', 'many-repos', 'settings', 'small-change', 'branch-card']

for (const theme of ['light', 'dark'] as const)
  test(`keeps a long list of what runs manageable, and asks the coordinator in its composer, unsent (${theme})`, async () => {
    const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
    mkdirSync(join(home, 'profile'), { recursive: true })
    writeFileSync(join(home, 'profile', 'desktop.json'), JSON.stringify({ appearance: theme }))
    const repo = repository(home)
    const scripts: Record<string, string> = { dev: 'vite', storybook: 'storybook dev', test: 'vitest' }
    for (const lab of LABS) scripts[`lab:${lab}`] = `vite --config lab/${lab}/vite.config.ts`
    for (const prototype of PROTOTYPES) scripts[`prototype:${prototype}`] = `vite --config prototypes/${prototype}/vite.config.mjs`
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'meridian', private: true, scripts }, null, 2))
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 't@althar.test',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 't@althar.test',
    }
    execFileSync('git', ['add', '.'], { cwd: repo, env })
    execFileSync('git', ['commit', '-q', '-m', 'Scripts'], { cwd: repo, env })
    const { electronApp, page } = await launch(home, {}, { scheme: 'system' })
    try {
      await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 860))
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await openFirstProject(electronApp, page, repo)
      await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
      // Something the person had begun to write to the coordinator.
      const composer = page.getByRole('textbox', { name: 'Tell the coordinator something' })
      await composer.click()
      await composer.fill('The login page looks off on Safari.')

      // All of its scripts, added from Settings › Running.
      await projectSettings(page, 'Running')
      await page.getByRole('button', { name: 'Add something to run' }).click()
      const add = page.getByRole('dialog', { name: 'Add something to run' })
      await add.getByRole('radio', { name: 'From package.json' }).click()
      const boxes = add.getByRole('checkbox')
      await expect(boxes.first()).toBeVisible()
      for (const box of await boxes.all()) if (!(await box.isChecked())) await box.check()
      await add.getByRole('button', { name: /^Add/ }).click()
      await expect(add).toBeHidden()

      // Its first few, with a search and Show all; light, then dark.
      const list = page.getByRole('main')
      await expect(list.getByRole('button', { name: /^Show all \d+$/ })).toBeVisible()
      await expect(list.getByRole('button', { name: /^Drag to move/ })).toHaveCount(8)
      await page.mouse.move(1270, 850)
      await page.screenshot({ path: `test-results/running-long-${theme}.png`, scale: 'css', animations: 'disabled' })
      await list.getByRole('searchbox').fill('handoff')
      await expect(list.getByRole('button', { name: /^Drag to move/ })).toHaveCount(0)
      await expect(list.getByText('npm run prototype:handoff')).toBeVisible()
      await page.screenshot({ path: `test-results/running-search-${theme}.png`, scale: 'css', animations: 'disabled' })
      await list.getByRole('searchbox').fill('')

      // Where its work goes: Change goes to the Tasks, where that is set.
      const where = list.getByText('Worktrees', { exact: true })
      await where.scrollIntoViewIfNeeded()
      await page.screenshot({ path: `test-results/running-where-${theme}.png`, scale: 'css', animations: 'disabled' })
      await list.getByRole('button', { name: 'Change' }).click()
      await expect(page.getByRole('region', { name: 'Where tasks start' })).toBeVisible()

      // Ask the coordinator: the conversation, at once, its request after what the person had written, unsent, the caret there.
      await projectSettings(page, 'Running')
      await page.getByRole('button', { name: 'Add something to run' }).click()
      await add.getByRole('radio', { name: 'Ask the coordinator' }).click()
      await expect(add.getByRole('button', { name: 'Ask the coordinator' })).not.toHaveAttribute('aria-busy', 'true')
      await add.getByRole('button', { name: 'Ask the coordinator' }).click()
      await expect(composer).toBeVisible()
      await expect(composer).toHaveValue(/^The login page looks off on Safari\.\nAnd please work out what this project runs/)
      await expect(composer).toBeFocused()
      await page.screenshot({ path: `test-results/running-ask-${theme}.png`, scale: 'css', animations: 'disabled' })
    } finally {
      await electronApp.close()
    }
  })
