import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, say, toConversation } from './support'

/*
 * What an agent hands back, in a real window with the fake agent
 * (`hands-back`, `streams`): a command's output in its tool call, streaming
 * while it runs; a screenshot, served from the artifact store and opened in
 * the lightbox; the document it wrote, read from the task's worktree and
 * opened beside the thread; a file it pointed at; a table in what it said;
 * and Copy.
 */

test('shows what the lead hands back: output, a screenshot, a document, a file and a table', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(projects))
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await page.getByRole('button', { name: 'New task' }).click()
    await page.getByLabel('What should change').fill('Check the refunds page')
    await page.getByLabel('Anything the lead should know').fill('[lead:finish]')
    await page.getByRole('button', { name: /^Review:/ }).click()
    await page.getByRole('button', { name: 'No review' }).click()
    await page.getByRole('button', { name: 'Start the task' }).click()
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Open task/ }).click()
    await toConversation(page)
    await expect(page.getByText('Did the task.')).toBeVisible()

    // A command whose output streams until it is stopped: open in its tool call as it comes.
    await say(page, 'streams')
    await page.getByRole('button', { name: /^Working for/ }).click()
    await expect(page.getByText(/ready in \d+ ms/).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /^Working for/ })).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('button', { name: /^Running npm run dev/ })).toHaveAttribute('aria-expanded', 'true')
    // Once the fold has opened.
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'test-results/handed-streaming.png' })
    await page.getByRole('button', { name: 'Interrupt the lead', exact: true }).click()
    await expect(page.getByRole('button', { name: /^Working for/ })).toHaveCount(0)

    await say(page, 'hands-back')
    // The table in what it said, the kit's own.
    await expect(page.getByRole('columnheader', { name: 'Budget' }).last()).toBeVisible()
    // The screenshot, from the artifact store at its address, drawn.
    const shots = page.getByRole('list', { name: 'Screenshots' }).last()
    await expect(shots.getByRole('listitem')).toHaveCount(1)
    const shot = shots.getByRole('img')
    await expect.poll(() => shot.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(480)
    expect(await shot.getAttribute('src')).toMatch(/^althar-picture:\/\/shot\/[0-9a-f]{64}\?w=1120$/)
    // The document it wrote, read from the worktree, and the file it pointed at.
    const notes = page.getByRole('article', { name: 'notes.md' })
    await expect(notes.getByText('Refunds share the partner budget.')).toBeVisible()
    await expect(page.getByRole('article', { name: 'report.csv' })).toBeVisible()
    await page.screenshot({ path: 'test-results/handed-back.png', fullPage: true })

    // The screenshot opens full size, and Escape gives focus back.
    await shots.getByRole('button', { name: /full size/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('img')).toBeVisible()
    await expect.poll(() => dialog.getByRole('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(480)
    // Once it has faded in.
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'test-results/handed-lightbox.png' })
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    // The document opens beside the thread, from its preview, by keyboard as by pointer.
    await notes.getByRole('button', { name: 'Read in the panel' }).focus()
    await page.keyboard.press('Enter')
    const panel = page.getByRole('complementary', { name: 'notes.md' })
    await expect(panel.getByRole('columnheader', { name: 'Budget' })).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'test-results/handed-panel.png' })
    await panel.getByRole('button', { name: /Close the panel/ }).click()
    await expect(panel).toHaveCount(0)

    // Each command's output, in its tool call: what passed, and what failed with its exit.
    await page
      .getByRole('button', { name: /^Worked for/ })
      .last()
      .click()
    await page.getByRole('button', { name: /Ran npm test/ }).click()
    await expect(page.getByText(/52 passed/)).toBeVisible()
    await page.getByRole('button', { name: /Run npm run lint/ }).click()
    await expect(page.getByText(/Unexpected any/)).toBeVisible()
    await expect(page.getByText('exit 1')).toBeVisible()
    await page.screenshot({ path: 'test-results/handed-output.png', fullPage: true })

    // Copy, on what it said: the window may write to the clipboard, and only that.
    const turn = page.getByRole('article').filter({ hasText: 'Here is what I found.' }).last()
    await turn.hover()
    await turn.getByRole('button', { name: 'Copy' }).last().click()
    await expect(turn.getByRole('button', { name: 'Copied' })).toBeVisible()
    const copied = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
    expect(copied).toContain('Here is what I found.')
  } finally {
    await electronApp.close()
  }
})
