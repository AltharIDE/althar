import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject } from './support'

/*
 * An agent's question (DEV-13), as the person meets it: a task's lead asks
 * which database to use, and its step waits on the person. The question is
 * on the home, calm: what it asks, and Answer. Althar's runtime goes down
 * and comes back in the middle, and the question is still there. Answer
 * takes the person to it in the task, where it is answered from the
 * keyboard; the lead is started again with the answer and carries its step
 * on. The lead is the fake agent, which asks for `[lead:ask]` and
 * reports its step for `[lead:finish]`.
 */

const shots = process.env.ALTHAR_SHOTS

test('asks the person a question on the home, keeps it across a restart, and carries on with the answer', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()

    // A task whose lead asks first.
    await page.getByRole('button', { name: 'New task' }).click()
    await page.getByLabel('What should change').fill('Cache the rates')
    await page.getByLabel('Anything the lead should know').fill('[lead:ask] [lead:finish]')
    await page.getByRole('button', { name: /^Review:/ }).click()
    await page.getByRole('button', { name: 'No review' }).click()
    await page.getByRole('button', { name: 'Start the task' }).click()

    // On the home, the question waits on the person, calm: what it asks, why, and Answer. Its options are where it is answered.
    await page.getByRole('navigation', { name: 'Projects' }).getByRole('button', { name: /^Home/ }).click()
    const needs = page.getByRole('region', { name: /needs? you/ })
    const asked = needs.getByRole('article', { name: 'Which database should the cache use?' })
    await expect(asked).toBeVisible({ timeout: 20_000 })
    await expect(asked.getByText('Question', { exact: true })).toBeVisible()
    await expect(asked.getByText('Postgres')).toHaveCount(0)
    // Under it, why it asks: what the lead said just before.
    await expect(asked.getByText('The rates change hourly, so a cache would save most of the calls to the provider.')).toBeVisible()
    if (shots) {
      // Once the list has come in.
      await page.waitForTimeout(800)
      await page.screenshot({ path: join(shots, 'app-home-question.png') })
    }

    // The runtime goes down in the middle, and comes back: the question still waits.
    const runtimePid = () =>
      electronApp.evaluate(
        ({ app }) => app.getAppMetrics().find((metric) => metric.type === 'Utility' && metric.name === 'Althar runtime')?.pid ?? null,
      )
    const killed = await runtimePid()
    expect(killed).not.toBeNull()
    await page.evaluate(() => Object.assign(window, { beforeCrash: true }))
    await electronApp.evaluate((_electron, pid) => process.kill(pid, 'SIGKILL'), killed ?? 0)
    await expect.poll(runtimePid, { timeout: 20_000 }).not.toBe(killed)
    await expect.poll(() => page.evaluate(() => 'beforeCrash' in window).catch(() => true), { timeout: 20_000 }).toBe(false)
    await expect(asked).toBeVisible({ timeout: 20_000 })
    await expect(needs.getByText('Stuck', { exact: true })).toHaveCount(0)

    // Answer takes the person to the question, its first choice in hand: a key picks, and Enter answers. The lead starts
    // again with the answer, and carries its step on.
    await asked.getByRole('button', { name: 'Answer' }).click()
    await expect(page.getByText('Needs your answer')).toBeVisible()
    await expect(page.getByText('Needs you', { exact: true })).toBeVisible()
    await expect(page.getByRole('radio', { name: 'Postgres' })).toBeFocused()
    await expect(page.getByRole('radio', { name: 'SQLite' })).toHaveAccessibleDescription(/One file beside the service/)
    if (shots) await page.screenshot({ path: join(shots, 'app-thread-question.png') })
    await page.keyboard.press('2')
    await expect(page.getByRole('radio', { name: 'SQLite' })).toBeChecked()
    await page.keyboard.press('Enter')
    await expect(page.getByText('Ready for you', { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Needs your answer')).toHaveCount(0)
    if (shots) await page.screenshot({ path: join(shots, 'app-thread-question-answered.png') })
    // What the lead was told folds with the work that led to its step's result.
    await page.getByRole('button', { name: /^Worked for/ }).click()
    await expect(page.getByText('told=Which database should the cache use? SQLite')).toBeVisible()
  } finally {
    await electronApp.close()
  }
})
