import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { connectGitHub, launch, openFirstProject, say, shown, toConversation } from './support'

/*
 * A task's Graph face (ADR-054), in a real window with the fake agents and
 * the fake GitHub: a planned task's review finds something, its lead settles
 * it, the review passes and its draft pull request opens; its graph has a
 * lane for each agent and the steps in the order they ran. The review that
 * found something opens in the code, its finding under its line, from its
 * card and from the conversation; one that passed opens its report. A round's marker goes to what started it in the conversation, and
 * a Ship shows as a second round (a task is a conversation plus parts): the
 * person talked with its lead, a turn and not a round, then shipped what it
 * committed. A report goes to its place in the conversation. The screenshots
 * it takes are this change's own evidence (test-results/graph-*.png).
 */

test('a task’s steps as a graph: a lane for each agent, a card’s report, and a Ship as a second round', async () => {
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
    await page.getByRole('button', { name: 'Start now' }).click()
    await expect(page.getByText('PR #1')).toBeVisible()
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

    // A review that found something opens in the code: its finding under its line, settled by the lead.
    await graph.getByRole('button', { name: /Review 1/ }).click()
    const changes = page.getByRole('dialog', { name: 'Changes' })
    await expect(changes).toBeVisible()
    const note = changes.locator('article[aria-current="true"]')
    await expect(note).toContainText('The heading is wrong.')
    await expect(note).toContainText('Fixed')
    await expect(changes.getByText('1 fixed')).toBeVisible()
    await expect(changes.getByRole('navigation', { name: 'Changed files' }).getByRole('button').first()).toContainText('README.md')
    await page.screenshot({ path: 'test-results/graph-findings.png', animations: 'disabled', scale: 'css' })
    await page.keyboard.press('Escape')
    await expect(changes).toHaveCount(0)

    // In the conversation, the review is a line; opened, its finding is a line, opening it there too.
    await toConversation(page)
    await page.getByRole('button', { name: /^Review.*1 finding/ }).click()
    await page.getByRole('button', { name: /The heading is wrong\./ }).click()
    await expect(changes.locator('article[aria-current="true"]')).toContainText('The heading is wrong.')
    await page.screenshot({ path: 'test-results/graph-findings-from-conversation.png', animations: 'disabled', scale: 'css' })
    await page.keyboard.press('Escape')
    await page.getByRole('radiogroup', { name: 'Face' }).getByRole('radio', { name: /Graph/ }).click()

    // A review that passed opens its report beside it, and the way to it in the conversation.
    await graph.getByRole('button', { name: /Review 2/ }).click()
    const report = page.getByRole('dialog', { name: 'Review 2' })
    await expect(report).toBeVisible()
    await expect(report.getByRole('button', { name: 'Show in the conversation' })).toBeVisible()
    await page.screenshot({ path: 'test-results/graph-report.png', animations: 'disabled', scale: 'css' })
    // Its way to the conversation: the review's line there, in view, focused and opened.
    await report.getByRole('button', { name: 'Show in the conversation' }).click()
    await expect(page.getByRole('radiogroup', { name: 'Face' }).getByRole('radio', { name: /Conversation/ })).toBeChecked()
    const reviewed = page.locator('[data-item]:focus')
    await expect(reviewed).toBeInViewport()
    await expect(reviewed).toContainText('Passed')
    await expect(reviewed).toHaveAttribute('data-state', 'open')
    await page.getByRole('radiogroup', { name: 'Face' }).getByRole('radio', { name: /Graph/ }).click()

    // The round's marker goes to what started it: the request the conversation opens with.
    await graph.getByRole('button', { name: /You asked/ }).click()
    await expect(page.getByRole('radiogroup', { name: 'Face' }).getByRole('radio', { name: /Conversation/ })).toBeChecked()

    // The person asks for more: a turn, not a round, so the graph has none for it; what its lead commits waits for Ship.
    await toConversation(page)
    await say(page, 'Also log each retry. tidy pls [lead:commit]')
    const header = page.locator('header[aria-label="Add a retry to the checkout call"]')
    await expect(header.getByRole('button', { name: 'Ship', exact: true })).toBeVisible()

    // Shipped from the header: a second round, the person's Ship its marker, its review in the reviewer's lane and the push after.
    await header.getByRole('button', { name: 'Ship', exact: true }).click()
    await page.getByRole('radiogroup', { name: 'Face' }).getByRole('radio', { name: /Graph/ }).click()
    await expect(graph.getByRole('button', { name: /You shipped/ })).toBeVisible()
    await expect(shown(page, 'Ready to accept', { exact: true })).toBeVisible()
    await page.mouse.move(1400, 880)
    await graph.screenshot({ path: 'test-results/graph-shipped.png', animations: 'disabled', scale: 'css' })
  } finally {
    await electronApp.close()
  }
})
