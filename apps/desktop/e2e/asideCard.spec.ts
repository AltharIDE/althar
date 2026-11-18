import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, say, startTask, still } from './support'

/*
 * An aside the coordinator starts, in its thread, in a real window with the
 * fake agent: its own card, beside a task's, says it is an aside on Scratch
 * with its result and no steps, and opens over the coordinator's
 * conversation. The screenshots are this change's evidence
 * (test-results/aside-card-*.png).
 */

test('an aside the coordinator starts has its own card in its thread, beside a task’s, and opens in place', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(projects))
    const thread = page.getByRole('region', { name: 'Conversation', exact: true }).filter({ visible: true })

    // A task, with its steps, and then an aside.
    await startTask(page, 'Backfill idempotency keys on old refunds', '[lead:slowly] [lead:finish] [lead:edit]')
    await say(page, 'What does the release script do with tags? [coordinator:start] [lead:finish]')

    const task = thread.getByRole('article').filter({ hasText: 'Backfill idempotency keys on old refunds' }).last()
    const aside = thread.getByRole('article').filter({ hasText: 'Aside on Scratch' }).last()
    await expect(task.getByRole('button', { name: /Open task/ })).toBeVisible()
    await expect(aside).toContainText('What does the release script do with tags')
    await expect(aside.getByText('Implement')).toHaveCount(0)
    await expect(aside.getByText(/^Ready$/)).toBeVisible()
    // Its answer is its lead's report, not what its lead said after reporting it.
    await expect(aside).toContainText('Did the task.')
    await expect(aside).not.toContainText('Althar has your summary')

    // The task's card at the top of the view, so both are in the picture.
    await page.setViewportSize({ width: 1100, height: 900 })
    await task.evaluate((card) => card.scrollIntoView({ block: 'start' }))
    await still(page)
    const top = await task.boundingBox()
    const bottom = await aside.boundingBox()
    if (top !== null && bottom !== null)
      await page.screenshot({
        path: 'test-results/aside-card-in-thread.png',
        clip: { x: top.x - 16, y: top.y - 16, width: top.width + 32, height: bottom.y + bottom.height - top.y + 32 },
        scale: 'css',
        animations: 'disabled',
      })

    // Its way in opens it where its pill does, over the coordinator's conversation, not as a task's screen.
    await aside.getByRole('button', { name: /Open aside|Answer/ }).click()
    const pills = page.getByRole('tablist', { name: 'Conversations' }).filter({ visible: true })
    await expect(pills.getByRole('tab', { name: /What does the release script do with tags/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('heading', { name: /What does the release script do with tags/, level: 1 })).toHaveCount(0)
    await still(page)
    await page.screenshot({ path: 'test-results/aside-card-opened.png', scale: 'css', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})
