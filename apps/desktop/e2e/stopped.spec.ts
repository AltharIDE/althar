import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, startTask } from './support'

/*
 * A task whose lead was stopped, in a real window: it leaves Running, which
 * counts only the work an agent is on, for Needs you, where its card says what
 * stopped it and offers Carry on; carried on, it is in Running again. The lead
 * is the scripted fake, which works until it is stopped (`[lead:wait]`). The
 * screenshots are this change's own evidence (test-results/stopped-*.png).
 */

test('a stopped task waits in Needs you with Carry on, and goes back to Running once carried on', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(home))
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await startTask(page, 'Keep the session alive', '[lead:wait]')
    await page.getByRole('button', { name: /Open task/ }).click()
    await expect(page.getByText('Implementing', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'More for this task' }).click()
    await page.getByRole('menuitem', { name: /Stop the task/ }).click()
    await expect(page.getByText('Stopped', { exact: true }).first()).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await page.getByRole('radio', { name: /^Board/ }).click()
    const work = page.getByRole('region', { name: 'The project’s work' })
    const yours = work.getByRole('region', { name: 'Needs you' })
    const running = work.getByRole('region', { name: 'Running' })
    await expect(yours.getByText('Keep the session alive')).toBeVisible()
    await expect(yours.getByText('Stopped when you interrupted it')).toBeVisible()
    await expect(running.getByText('Keep the session alive')).toHaveCount(0)
    await work.screenshot({ path: 'test-results/stopped-needs-you.png', scale: 'css' })

    await yours.getByRole('button', { name: 'Carry on' }).click()
    await expect(running.getByText('Keep the session alive')).toBeVisible({ timeout: 30_000 })
    await expect(yours.getByText('Keep the session alive')).toHaveCount(0)
    await work.screenshot({ path: 'test-results/stopped-carried-on.png', scale: 'css' })
  } finally {
    await electronApp.close()
  }
})
