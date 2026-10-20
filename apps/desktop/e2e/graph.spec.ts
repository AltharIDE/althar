import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { connectGitHub, launch, openFirstProject, say, toConversation } from './support'

/*
 * A task's Graph face (ADR-054), in a real window with the fake agents and
 * the fake GitHub: a planned task's review finds something, its lead settles
 * it, the review passes and its draft pull request opens; its graph has a
 * lane for each agent and the steps in the order they ran. A card opens its
 * report, a round's marker goes to what started it in the conversation, and
 * a follow-up shows as a second round. The screenshots it takes are
 * this change's own evidence (test-results/graph-*.png).
 */

test('a task’s steps as a graph: a lane for each agent, a card’s report, and a follow-up as a second round', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const remote = join(home, 'api.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote])
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.test/meridian/api.git'], { cwd: repo })
  execFileSync('git', ['push', '-q', remote, 'main'], { cwd: repo })
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_REMOTE: remote })
  try {
    await (await electronApp.browserWindow(page)).evaluate((window) => window.setSize(1440, 900))
    await openFirstProject(electronApp, page, repo)
    await connectGitHub(page)

    // Planned with a review that finds something: implemented, reviewed, settled, reviewed again, its draft opened.
    await say(page, 'Add a retry to the checkout call. [coordinator:plan] [lead:finish] [lead:edit] [review:findings]')
    await page.getByRole('button', { name: 'Start now' }).click({ timeout: 20_000 })
    await expect(page.getByText('PR #1')).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: /Open task/ }).click()

    // Its Graph face, from the header's switch: the lead's lane, the reviewer's, Althar's; five steps in the order they ran.
    await expect(page.getByRole('radiogroup', { name: 'Face' }).getByRole('radio', { name: /Graph/ })).toBeVisible()
    await page.keyboard.press('g')
    const graph = page.getByRole('region', { name: 'The task’s steps' })
    await expect(graph).toBeVisible()
    const steps = graph.getByRole('list').first().getByRole('listitem')
    await expect(steps).toHaveCount(5)
    await expect(steps.nth(1)).toContainText('Review 1')
    await expect(steps.nth(1)).toContainText('1 finding')
    await expect(steps.nth(4)).toContainText('Draft #1')
    await page.mouse.move(1400, 880)
    await graph.screenshot({ path: 'test-results/graph-planned.png', animations: 'disabled', scale: 'css' })

    // A card opens its step's report beside it: the reviewer's finding, and the way to it in the conversation.
    await graph.getByRole('button', { name: /Review 1/ }).click()
    const report = page.getByRole('dialog', { name: 'Review 1' })
    await expect(report).toBeVisible()
    await expect(report.getByRole('button', { name: 'Show in the conversation' })).toBeVisible()
    await page.screenshot({ path: 'test-results/graph-report.png', animations: 'disabled', scale: 'css' })
    await page.keyboard.press('Escape')
    await expect(report).toHaveCount(0)

    // The round's marker goes to what started it: the request the conversation opens with.
    await graph.getByRole('button', { name: /You asked/ }).click()
    await expect(page.getByRole('radiogroup', { name: 'Face' }).getByRole('radio', { name: /Conversation/ })).toBeChecked()

    // The person asks for more: a second round, its follow-up in the lead's lane, its marker saying they followed up.
    await toConversation(page)
    await say(page, 'Also log each retry. [lead:finish]')
    // From the switch: the composer has focus, and a face's letter there is only a letter.
    await page.getByRole('radiogroup', { name: 'Face' }).getByRole('radio', { name: /Graph/ }).click()
    await expect(graph.getByRole('button', { name: /You followed up/ })).toBeVisible({ timeout: 10_000 })
    await expect(graph.getByRole('button', { name: /^Follow-up/ })).toBeVisible()
    await page.mouse.move(1400, 880)
    await graph.screenshot({ path: 'test-results/graph-follow-up.png', animations: 'disabled', scale: 'css' })
  } finally {
    await electronApp.close()
  }
})
