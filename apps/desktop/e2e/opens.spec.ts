import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, planTask, say } from './support'

/*
 * Where a task opens from the board: a change that is ready opens on its
 * outputs, where it is accepted; a quick task that wrote files (a
 * prototype) has nothing to accept, so it opens on its conversation.
 */

test('opens a change on its outputs and a quick task on its conversation', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(projects))
    await page.getByRole('radio', { name: 'Home' }).click()
    const work = page.getByRole('region', { name: 'The project’s work' })

    await planTask(page, 'Retry webhook deliveries with backoff', '[lead:finish] [lead:edit]')
    await page.getByRole('button', { name: 'Start now' }).last().click()
    await expect(work.getByText('Ready to accept')).toBeVisible({ timeout: 30_000 })

    await say(page, 'Sketch a status page prototype [coordinator:start] [lead:finish] [lead:edit]')
    await expect(work.getByText('Finished', { exact: true })).toBeVisible({ timeout: 30_000 })

    await work.getByRole('button', { name: 'Sketch a status page prototype' }).click()
    await expect(page.getByRole('heading', { name: 'Sketch a status page prototype', level: 1 })).toBeVisible()
    await expect(page.getByRole('radio', { name: /Conversation/ })).toHaveAttribute('aria-checked', 'true')
    await page.screenshot({ path: 'test-results/opens-prototype.png', animations: 'disabled' })
    await page.getByRole('button', { name: 'Back to meridian' }).click()

    await work.getByRole('button', { name: 'Retry webhook deliveries with backoff' }).click()
    await expect(page.getByRole('heading', { name: 'Retry webhook deliveries with backoff', level: 1 })).toBeVisible()
    await expect(page.getByRole('radio', { name: /Outputs/ })).toHaveAttribute('aria-checked', 'true')
    await page.screenshot({ path: 'test-results/opens-change.png', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})
